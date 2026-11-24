/** Resolve and read a bounded storyboard from an existing Session workspace. */
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'

function pathFailure(message: string): never {
  throw new RemoteError('video-production/invalid', message, { reason: 'storyboard-path' })
}

function isWithin(root: string, path: string): boolean {
  const difference = relative(root, path)
  return difference !== '' && difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
}

/**
 * Read the Session's workspace storyboard without admitting external targets or unbounded content.
 * @param cwd - persisted absolute Session workspace directory.
 * @param path - expected `storyboard.md` file, relative to the workspace or already absolute.
 * @param maxBytes - existing project byte limit, also used as the input bound.
 * @param signal - cancellation before opening and between bounded reads.
 * @returns Valid UTF-8 content of the regular storyboard file.
 */
export async function readWorkspaceStoryboard(cwd: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const workspace = resolve(cwd)
  const candidate = resolve(workspace, path)
  if (path.includes('\u0000') || basename(candidate) !== 'storyboard.md' || !isWithin(workspace, candidate)) {
    pathFailure('Select a storyboard.md file in the Session workspace.')
  }
  try {
    const root = await realpath(workspace)
    const target = await realpath(candidate)
    if (!isWithin(root, target) || basename(target) !== 'storyboard.md') {
      pathFailure('The storyboard must resolve to a file in the Session workspace.')
    }
    const before = await lstat(target, { bigint: true })
    if (!before.isFile()) pathFailure('The storyboard must be a regular file.')
    signal?.throwIfAborted()
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const opened = await file.stat({ bigint: true })
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
        || !isWithin(root, await realpath(target))) {
        pathFailure('The storyboard changed location before it could be read.')
      }
      if (opened.size > BigInt(maxBytes)) {
        throw new RemoteError('video-production/invalid', 'The storyboard exceeds the project byte limit.', { reason: 'storyboard-read' })
      }
      const content = Buffer.allocUnsafe(Number(opened.size))
      let offset = 0
      while (offset < content.length) {
        signal?.throwIfAborted()
        const { bytesRead } = await file.read(content, offset, content.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      const settled = await file.stat({ bigint: true })
      if (offset !== content.length || settled.size !== opened.size
        || settled.mtimeNs !== opened.mtimeNs || settled.ctimeNs !== opened.ctimeNs) {
        throw new RemoteError('video-production/invalid', 'The storyboard changed while it was being read.', { reason: 'storyboard-read' })
      }
      signal?.throwIfAborted()
      return new TextDecoder('utf-8', { fatal: true }).decode(content.subarray(0, offset))
    } finally {
      await file.close()
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (remoteErrorOf(error) !== undefined) throw error
    throw new RemoteError('video-production/invalid', 'The storyboard could not be read as UTF-8 Markdown.', { reason: 'storyboard-read' }, { cause: error })
  }
}
