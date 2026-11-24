/** Minimal Host capability reports used by the settings tests. */
import type { CapabilityId, CapabilityView } from '@deepseek-ai/dsh-capability-manager/types'
import { allowAllAccess, contextMenuHook, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { vi } from 'vitest'

/** Standard props for a settings section rendered outside the slot runtime. */
export function settingsRuntimeProps(): PropsRuntime<'settings.section'> {
  return {
    ...allowAllAccess,
    close: vi.fn(),
    useContextMenu: contextMenuHook(),
    usePanelInfo: select => select({ activePanelId: null }),
    useResource: () => { throw new Error('Unexpected resource read in settings') },
    useSessionRetainInfo: () => undefined,
    useSessions: select => select({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
    useSessionStatus: select => select(new Map()),
    useWorkspaces: select => select(workspaceSnapshot()),
  }
}

export const ID = 'video-engine' as CapabilityId
export const capability: CapabilityView = {
  id: ID, title: 'Local video engine', description: 'Configured CPU engine', category: 'video', engineId: 'comfyui',
  version: '0.43.0', kind: 'local', status: 'missing', actions: ['check', 'prepare'],
  requirements: [{ id: 'runtime', title: 'Private runtime', status: 'missing', message: 'Prepare the reviewed runtime.' }],
}
