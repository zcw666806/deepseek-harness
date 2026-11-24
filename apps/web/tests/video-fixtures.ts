/** Synthetic browser media used by real Web video workflows. */
import type { Page } from 'playwright'

/**
 * Encode a playable synthetic fixture without a model API or external renderer.
 * @param page - owned Chromium page.
 * @returns recorded WebM bytes.
 */
export async function browserVideo(page: Page): Promise<Buffer> {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const paint = canvas.getContext('2d')
    if (paint === null) throw new Error('Test video requires a 2D canvas.')
    const stream = canvas.captureStream(12)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    const chunks: Blob[] = []
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => { chunks.push(event.data) })
      recorder.addEventListener('stop', () => { resolve(new Blob(chunks, { type: 'video/webm' })) }, { once: true })
      recorder.addEventListener('error', () => { reject(new Error('Browser fixture recording failed.')) }, { once: true })
    })
    try {
      recorder.start()
      for (let frame = 0; frame < 18; frame++) {
        paint.fillStyle = '#172331'
        paint.fillRect(0, 0, canvas.width, canvas.height)
        paint.fillStyle = '#74d6c6'
        paint.fillRect(72 + frame * 5, 90, 90, 90)
        paint.fillStyle = '#ffffff'
        paint.font = '28px sans-serif'
        paint.fillText('VIDEO WORKSPACE · TEST CLIP', 64, 264)
        await new Promise<number>((resolve) => { requestAnimationFrame(resolve) })
      }
      recorder.stop()
      const bytes = new Uint8Array(await (await finished).arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    } finally {
      if (recorder.state !== 'inactive') recorder.stop()
      for (const track of stream.getTracks()) track.stop()
    }
  })
  return Buffer.from(encoded, 'base64')
}

/**
 * Draw a synthetic reference without claiming generated character media.
 * @param page - owned Chromium page.
 * @param kind - geometric reference variant.
 * @returns PNG fixture bytes.
 */
export async function browserReference(page: Page, kind: 'character' | 'scene'): Promise<Buffer> {
  const encoded = await page.evaluate((variant) => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 180
    const paint = canvas.getContext('2d')
    if (paint === null) throw new Error('Reference fixture requires a canvas context.')
    const backdrop = paint.createLinearGradient(0, 0, 240, 180)
    backdrop.addColorStop(0, variant === 'character' ? '#263b52' : '#567864')
    backdrop.addColorStop(1, variant === 'character' ? '#b3a99a' : '#d2d3a4')
    paint.fillStyle = backdrop
    paint.fillRect(0, 0, 240, 180)
    if (variant === 'character') {
      paint.fillStyle = '#f0d2b0'
      paint.beginPath()
      paint.arc(120, 53, 23, 0, Math.PI * 2)
      paint.fill()
      paint.fillStyle = '#263c45'
      paint.fillRect(86, 80, 68, 76)
      paint.fillStyle = '#182833'
      paint.fillRect(91, 150, 24, 30)
      paint.fillRect(125, 150, 24, 30)
    } else {
      paint.fillStyle = '#d6c29d'
      paint.beginPath()
      paint.moveTo(100, 90)
      paint.lineTo(145, 90)
      paint.lineTo(220, 180)
      paint.lineTo(22, 180)
      paint.fill()
      for (const x of [25, 67, 177, 216]) {
        paint.fillStyle = '#526751'
        paint.fillRect(x, 35, 7, 93)
        paint.fillStyle = '#79946b'
        paint.beginPath()
        paint.arc(x + 3, 35, 27, 0, Math.PI * 2)
        paint.fill()
      }
    }
    paint.fillStyle = '#ffffff'
    paint.font = '10px sans-serif'
    paint.fillText('REFERENCE · TEST FIXTURE', 12, 172)
    return canvas.toDataURL('image/png').split(',')[1]!
  }, kind)
  return Buffer.from(encoded, 'base64')
}
