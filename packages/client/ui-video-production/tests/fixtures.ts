/** Small persisted project fixtures for the workspace's browser tests. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AttachmentId, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { VideoProject, VideoProjectId, VideoShotId, VideoVersionId } from '@deepseek-ai/dsh-video-production/types'

export const SESSION = 'video-session' as SessionId
export const SHOT_A = 'shot-a' as VideoShotId
export const SHOT_B = 'shot-b' as VideoShotId
export const VERSION_A = 'version-a' as VideoVersionId
export const VIDEO: VideoAttachmentRef = {
  attachmentId: 'video-a' as AttachmentId, mediaType: 'video/mp4', bytes: 4, durationSeconds: 3,
}

export function project(): VideoProject {
  return {
    id: 'project-a' as VideoProjectId, sessionId: SESSION, revision: 1, title: 'A day by the sea', assets: [], exports: [],
    shots: [
      {
        id: SHOT_A, title: 'Arrival', prompt: 'A traveler arrives at the coast.', duration: 3,
        aspectRatio: '16:9', resolution: '480p', assetIds: [], position: { x: 32, y: 32 },
        selectedVersionId: VERSION_A,
        versions: [{
          id: VERSION_A, status: 'completed', prompt: 'A traveler arrives at the coast.', attachment: VIDEO,
          duration: 3, aspectRatio: '16:9', resolution: '480p', referenceImages: [],
        }],
      },
      {
        id: SHOT_B, title: 'Waves', prompt: 'Waves wash over the shore.', duration: 6,
        aspectRatio: '16:9', resolution: '720p', assetIds: [], position: { x: 380, y: 32 }, versions: [],
      },
    ],
  }
}
