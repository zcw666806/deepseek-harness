/** Contribute the current host renderer prerequisites to the shared capability center. */
import type { Context } from '@deepseek-ai/cordis'
import { CapabilityId } from '@deepseek-ai/dsh-capability-manager'
import type {} from '@deepseek-ai/dsh-capability-manager'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { ResolvedConfig } from './config.ts'

/**
 * Inspect configured renderers without exposing their machine paths in portable settings.
 * @param ctx - Owner of the renderer service and optional capability registration.
 * @param config - Validated renderer paths and managed-process bounds.
 */
export function installExportCapability(ctx: Context, config: ResolvedConfig): void {
  ctx.inject(['capabilities'], (owner) => {
    const unregister = owner.capabilities.register({
      descriptor: { id: CapabilityId('media.ffmpeg'), title: 'FFmpeg', description: 'Video normalization and film export', category: 'video', engineId: 'ffmpeg', kind: 'local' },
      async inspect(signal) {
        const subprocess = ctx.get('subprocess')
        if (subprocess === undefined) return { status: 'unavailable', requirements: [{ id: 'processes', title: 'Local process provider', status: 'missing' }] }
        const requirements = []
        for (const [id, path] of [['ffmpeg', config.ffmpegPath], ['ffprobe', config.ffprobePath]] as const) {
          try {
            const executable = await subprocess.resolveExecutable(path, undefined, signal)
            const handle = subprocess.spawn({
              argv: [executable, '-version'], cwd: process.cwd(), signal, graceMs: config.processGraceMs, env: { FFREPORT: undefined },
              stdio: { stdin: 'ignore', stdout: { maxBytes: config.maxProcessOutputBytes }, stderr: { maxBytes: config.maxProcessOutputBytes } },
            })
            try {
              const result = await handle.done
              signal.throwIfAborted()
              requirements.push({ id, title: id, status: result.exitCode === 0 && result.signal === null ? 'available' as const : 'unsupported' as const })
            } finally { handle.terminate(); await handle.waitForExit() }
          } catch {
            signal.throwIfAborted()
            requirements.push({ id, title: id, status: 'missing' as const })
          }
        }
        return { status: requirements.every(item => item.status === 'available') ? 'ready' : 'missing', requirements }
      },
    })
    owner.effect(() => unregister, 'film renderer capability')
  })
}
