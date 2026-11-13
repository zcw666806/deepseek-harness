/** Deterministic external video responses for the recorded headless turn. */
export const name = 'video-api-fixture'

/**
 * Intercept only the scenario video endpoint inside its isolated subprocess.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Owning plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== 'https://video.snapshot.invalid') return original(input, init)
      const headers = new Headers(init?.headers)
      if (headers.get('authorization') !== 'Bearer snapshot-video-key') {
        throw new Error('Video fixture received an unexpected credential')
      }
      if (url.pathname === '/v1/videos/generations' && init?.method === 'POST') {
        const request = JSON.parse(String(init.body))
        if (request.model !== 'snapshot-video-target' || request.prompt !== 'A cat playing piano') {
          throw new Error('Video fixture received an unexpected generation request')
        }
        return Response.json({ request_id: 'snapshot-video' })
      }
      if (url.pathname === '/v1/videos/snapshot-video') {
        return Response.json({ status: 'done', video: { url: '/v1/videos/snapshot-video/content', duration: 6 } })
      }
      if (url.pathname === '/v1/videos/snapshot-video/content') {
        return new Response('snapshot-video-bytes', { headers: { 'content-type': 'video/mp4' } })
      }
      throw new Error(`Unexpected video fixture URL: ${url}`)
    }
    return () => { globalThis.fetch = original }
  })
}
