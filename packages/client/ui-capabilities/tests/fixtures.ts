/** Minimal Host capability reports used by the settings tests. */
import type { CapabilityId, CapabilityView } from '@deepseek-ai/dsh-capability-manager/types'
export const ID = 'video-engine' as CapabilityId
export const capability: CapabilityView = {
  id: ID, title: 'Local video engine', description: 'Configured CPU engine', category: 'video', engineId: 'comfyui',
  version: '0.43.0', kind: 'local', status: 'missing', actions: ['check', 'prepare'],
  requirements: [{ id: 'runtime', title: 'Private runtime', status: 'missing', message: 'Prepare the reviewed runtime.' }],
}
