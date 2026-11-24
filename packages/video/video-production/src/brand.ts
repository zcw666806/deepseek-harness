/** Constructors for opaque video-production identities. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { VideoAssetId as Asset, VideoProjectId as Project, VideoProjectTransferId as Transfer, VideoShotId as Shot, VideoVersionId as Version } from './types.ts'

/**
 * Brand one stable reference-asset identity.
 * @param value - raw asset identity.
 * @returns the branded identity.
 */
export function VideoAssetId(value: string): Asset { return brandString<Asset>(value) }
/**
 * Brand one Session-owned project identity.
 * @param value - raw project identity.
 * @returns the branded identity.
 */
export function VideoProjectId(value: string): Project { return brandString<Project>(value) }
/**
 * Brand one stable storyboard-shot identity.
 * @param value - raw shot identity.
 * @returns the branded identity.
 */
export function VideoShotId(value: string): Shot { return brandString<Shot>(value) }
/**
 * Brand one generation or export attempt identity.
 * @param value - raw version identity.
 * @returns the branded identity.
 */
export function VideoVersionId(value: string): Version { return brandString<Version>(value) }
/**
 * Brand one ephemeral package-transfer identity.
 * @param value - raw transfer identity.
 * @returns the branded identity.
 */
export function VideoProjectTransferId(value: string): Transfer { return brandString<Transfer>(value) }
