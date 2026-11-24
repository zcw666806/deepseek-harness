/** Deployment limits resolved once by the video-production owner. */
import type { Config } from './types.ts'

/** Required resolved fields consumed by project and export operations. */
export type ResolvedConfig = Required<Config>

/**
 * Resolve the owner's complete deployment policy before an operation begins.
 * @param input - validated deployment configuration.
 * @returns explicit operation limits.
 */
export function resolveConfig(input: Config): ResolvedConfig {
  return {
    maxShots: input.maxShots ?? 64,
    maxAssets: input.maxAssets ?? 64,
    maxVersionsPerShot: input.maxVersionsPerShot ?? 20,
    maxExports: input.maxExports ?? 20,
    maxCaptionsPerShot: input.maxCaptionsPerShot ?? 64,
    maxProjectBytes: input.maxProjectBytes ?? 1024 * 1024,
    ffmpegPath: input.ffmpegPath ?? 'ffmpeg',
    ffprobePath: input.ffprobePath ?? 'ffprobe',
    subtitleFontPath: input.subtitleFontPath ?? '',
    exportTimeoutMs: input.exportTimeoutMs ?? 300000,
    generationTimeoutMs: input.generationTimeoutMs ?? 300000,
    exportWidth: input.exportWidth ?? 1280,
    exportHeight: input.exportHeight ?? 720,
    exportFrameRate: input.exportFrameRate ?? 24,
    maxExportBytes: input.maxExportBytes ?? 512 * 1024 * 1024,
    processGraceMs: input.processGraceMs ?? 2000,
    maxProcessOutputBytes: input.maxProcessOutputBytes ?? 16384,
    maxProjectPackageBytes: input.maxProjectPackageBytes ?? 768 * 1024 * 1024,
    maxProjectPackageManifestBytes: input.maxProjectPackageManifestBytes ?? 4 * 1024 * 1024,
    maxProjectTransfers: input.maxProjectTransfers ?? 4,
    projectTransferTimeoutMs: input.projectTransferTimeoutMs ?? 30 * 60 * 1000,
  }
}
