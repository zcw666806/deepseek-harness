/** Full-resolution PNG admission and byte-exact manuscript storage. */
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import sharp from 'sharp'
import { failure } from './failure.ts'
import type { ComicImage, ComicImageChunk, ComicImageId } from './types.ts'

/** Original encoded bytes and the metadata obtained from their decoded image. */
export interface PreparedImage {
  readonly ref: ComicImage
  readonly data: Buffer
}

function digest(data: Uint8Array): ComicImageId {
  return brandString<ComicImageId>(createHash('sha256').update(data).digest('hex'))
}

/**
 * Verify a complete, bounded PNG before publishing any image reference.
 * @param encoded - canonical base64 of the original PNG.
 * @param maxBytes - permitted encoded-file size in raw bytes.
 * @param maxPixels - permitted decoded image area.
 * @returns original bytes and decoded metadata, with no resize or recompression.
 */
export async function prepareImage(encoded: string, maxBytes: number, maxPixels: number): Promise<PreparedImage> {
  if (encoded.length === 0 || encoded.length > Math.ceil(maxBytes / 3) * 4) {
    failure('image-too-large', 'The original PNG exceeds the configured image limit or is empty.')
  }
  const data = Buffer.from(encoded, 'base64')
  if (data.length > maxBytes || data.toString('base64') !== encoded) {
    failure('image-invalid', 'Artwork must be a bounded PNG encoded in canonical base64.')
  }
  let width: number
  let height: number
  try {
    const image = sharp(data, { limitInputPixels: maxPixels, failOn: 'warning' })
    const metadata = await image.metadata()
    if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 || (metadata.orientation ?? 1) !== 1
      || metadata.width > 8192 || metadata.height > 8192) throw new Error('PNG format or dimensions are unsupported.')
    await image.stats()
    width = metadata.width
    height = metadata.height
  } catch {
    failure('image-invalid', 'Artwork must be a decodable PNG within the configured pixel limit.')
  }
  return { data, ref: { id: digest(data), width, height, bytes: data.length } }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Host-local store for immutable original PNGs. Project service authorizes each reference. */
export class ComicImages {
  /** @param root - private object directory under the Harness home. */
  constructor(private readonly root: string) {}

  /** Prepare the directory before accepting writes. */
  async start(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await syncDirectory(dirname(this.root))
    await syncDirectory(dirname(dirname(this.root)))
  }

  /**
   * Publish one complete object without replacing an existing content identity.
   * @param image - validated original PNG.
   * @returns completion after the file and publication directory are synced.
   */
  async put(image: PreparedImage): Promise<void> {
    const target = join(this.root, image.ref.id)
    const temp = join(this.root, `${randomUUID()}.tmp`)
    const handle = await open(temp, 'wx', 0o600)
    try {
      try {
        await handle.writeFile(image.data)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await link(temp, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await this.read(image.ref)
      }
      await syncDirectory(this.root)
    } finally {
      await unlink(temp)
    }
  }

  /**
   * Read an original and verify its recorded content hash before exporting it.
   * @param ref - an authorized project reference.
   * @returns the original PNG bytes.
   */
  async read(ref: ComicImage): Promise<Buffer> {
    const bytes = await this.slice(ref, 0, ref.bytes)
    if (digest(bytes) !== ref.id) failure('image-damaged', 'A stored original PNG fails its integrity check.')
    return bytes
  }

  /**
   * Read one slice of an admitted, immutable original.
   * @param ref - an authorized project reference.
   * @param offset - zero-based position no greater than the original length.
   * @param length - maximum number of requested raw bytes.
   * @returns the base64 slice and exact progress.
   */
  async readChunk(ref: ComicImage, offset: number, length: number): Promise<ComicImageChunk> {
    const bytes = await this.slice(ref, offset, length)
    const nextOffset = offset + bytes.length
    return { data: bytes.toString('base64'), offset, nextOffset, done: nextOffset === ref.bytes }
  }

  private async slice(ref: ComicImage, offset: number, length: number): Promise<Buffer> {
    const handle = await open(join(this.root, ref.id), 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== ref.bytes) failure('image-damaged', 'A stored original PNG has an unexpected length.')
      const buffer = Buffer.alloc(Math.min(length, ref.bytes - offset))
      let progress = 0
      while (progress < buffer.length) {
        const { bytesRead } = await handle.read(buffer, progress, buffer.length - progress, offset + progress)
        if (bytesRead === 0) failure('image-damaged', 'A stored original PNG ended unexpectedly.')
        progress += bytesRead
      }
      return buffer
    } finally {
      await handle.close()
    }
  }
}
