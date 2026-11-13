/** One page compositor for editing, reading previews, and PNG export. */

import type { ComicBubble, ComicImage, ComicPage, ComicPanel } from '@deepseek-ai/dsh-comic-production/types'

/** Page geometry and active artwork, independent of lettering changes. */
export interface ComicArtwork {
  readonly width: number
  readonly height: number
  readonly panels: readonly (Pick<ComicPanel, 'x' | 'y' | 'width' | 'height'> & { readonly images: readonly ComicImage[] })[]
}

/**
 * Collect active image references in panel and layer order.
 * @param page - Page containing committed or draft placement and layer choices.
 * @returns The data that determines the page's artwork composite.
 */
export function pageArtwork(page: ComicPage): ComicArtwork {
  return {
    width: page.width, height: page.height,
    panels: page.panels.map(({ x, y, width, height, layers }) => ({
      x, y, width, height,
      images: layers.flatMap((layer) => {
        const image = layer.visible ? layer.versions.find(version => version.id === layer.imageId) : undefined
        return image === undefined ? [] : [image]
      }),
    })),
  }
}

const segments = new Intl.Segmenter(undefined, { granularity: 'word' })
const noLineStart = /^[，。；：！？、）》」』】〕〉”’]/u

function textLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = ''
    for (const { segment } of segments.segment(paragraph)) {
      const pieces = ctx.measureText(segment).width > width ? Array.from(segment) : [segment]
      for (const piece of pieces) {
        if (line && !noLineStart.test(piece) && ctx.measureText(line + piece).width > width) {
          lines.push(line.trimEnd())
          line = ''
        }
        if (line || piece.trim()) line += piece
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

function drawBubble(ctx: CanvasRenderingContext2D, bubble: ComicBubble): boolean {
  const { x, y, width, height } = bubble
  const padding = Math.min(20, width / 10, height / 8)
  const radius = Math.min(30, width / 5, height / 3)
  const fontSize = bubble.fontSize ?? Math.min(30, Math.max(12, Math.round(height / 3)))
  const lineHeight = fontSize * 1.26
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 2
  if (bubble.tailX !== undefined && bubble.tailY !== undefined) {
    const tailRoot = x + width / 2
    const tailSide = bubble.tailY < y + height / 2 ? y : y + height
    const inset = Math.min(10, height / 4) * (tailSide === y ? 1 : -1)
    ctx.beginPath()
    ctx.moveTo(tailRoot - radius / 2, tailSide + inset)
    ctx.lineTo(bubble.tailX, bubble.tailY)
    ctx.lineTo(tailRoot + radius / 2, tailSide + inset)
    ctx.fill()
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fill()
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.rect(x + padding, y + padding, width - padding * 2, height - padding * 2)
  ctx.clip()
  ctx.fillStyle = '#111'
  ctx.font = `${fontSize}px system-ui, "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = textLines(ctx, bubble.text, width - padding * 2)
  const textHeight = lines.length * lineHeight
  const top = Math.max(y + padding, y + (height - textHeight) / 2)
  lines.forEach((line, index) =>{  ctx.fillText(line, x + width / 2, top + (index + 0.5) * lineHeight) })
  const overflows = bubble.text.length > 0 && (textHeight > height - padding * 2
    || lines.some(line => ctx.measureText(line).width > width - padding * 2))
  ctx.restore()
  return overflows
}

/**
 * Draw one page and its lettering at the stored pixel size.
 * @param canvas - Target bitmap used by the preview or PNG export.
 * @param page - Page whose lettering is placed over its artwork.
 * @param artwork - Composite for the same geometry and active layer versions, when available.
 * @returns Whether any bubble contains clipped dialogue.
 */
export function drawComicPage(
  canvas: HTMLCanvasElement,
  page: ComicPage,
  artwork: HTMLCanvasElement | undefined,
): boolean {
  if (canvas.width !== page.width) canvas.width = page.width
  if (canvas.height !== page.height) canvas.height = page.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('A 2D canvas is unavailable.')
  if (artwork === undefined) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, page.width, page.height)
  } else ctx.drawImage(artwork, 0, 0)
  let overflows = false
  for (const [index, panel] of page.panels.entries()) {
    const { x, y, width, height } = panel
    ctx.save()
    // Later panels cover artwork and lettering in earlier overlapping panels.
    for (const later of page.panels.slice(index + 1)) {
      if (later.x > x + width || later.y > y + height || later.x + later.width < x || later.y + later.height < y) continue
      ctx.beginPath()
      ctx.rect(0, 0, page.width, page.height)
      ctx.rect(later.x, later.y, later.width, later.height)
      ctx.clip('evenodd')
    }
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 3
    ctx.strokeRect(x, y, width, height)
    ctx.beginPath()
    ctx.rect(x, y, width, height)
    ctx.clip()
    ctx.translate(x, y)
    for (const bubble of panel.bubbles) {
      if (drawBubble(ctx, bubble)) overflows = true
    }
    ctx.restore()
  }
  return overflows
}

/**
 * Composite artwork sequentially, keeping at most one decoded original alive.
 * @param page - Placement and visible source images for one page.
 * @param readImage - Read an authorized original PNG by its reference.
 * @param signal - Cancellation for page changes, unload, and export.
 * @returns The page-sized canvas with its artwork painted in layer order.
 */
export async function renderArtwork(
  page: ComicArtwork,
  readImage: (image: ComicImage) => Promise<Blob>,
  signal: AbortSignal,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = page.width
  canvas.height = page.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('A 2D canvas is unavailable.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, page.width, page.height)
  for (const { x, y, width, height, images } of page.panels) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, width, height)
    ctx.clip()
    ctx.fillRect(x, y, width, height)
    for (const image of images) {
      signal.throwIfAborted()
      const blob = await readImage(image)
      signal.throwIfAborted()
      const bitmap = await createImageBitmap(blob)
      try {
        signal.throwIfAborted()
        const scale = Math.max(width / bitmap.width, height / bitmap.height)
        const drawnWidth = bitmap.width * scale
        const drawnHeight = bitmap.height * scale
        ctx.drawImage(bitmap, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight)
      } finally {
        bitmap.close()
      }
    }
    ctx.restore()
  }
  return canvas
}

/**
 * Encode the canvas without resampling its backing bitmap.
 * @param canvas - Completed page at the requested export dimensions.
 * @returns The encoded PNG, or a rejection if encoding fails.
 */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>{  canvas.toBlob((blob) => {
    if (blob === null) reject(new Error('The page could not be encoded as PNG.'))
    else resolve(blob)
  }, 'image/png') })
}
