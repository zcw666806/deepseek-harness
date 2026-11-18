/** Binds the comic creation workbench to its Session and the selected project. */

import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ComicProjectId } from '@deepseek-ai/dsh-comic-production/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ComicWorkbench, type ComicWorkbenchApi } from './ComicWorkbench.tsx'
import type { NS } from './locales.ts'

/** Project selected from a Chat result, scoped to its source Session. */
export interface ComicProjectRequest {
  readonly sessionId: SessionId
  readonly projectId: ComicProjectId
}

/** Workbench operations and one pending project navigation. */
export interface ComicStudioInjected {
  readonly api: ComicWorkbenchApi
  readonly hooks: { readonly projectRequest: HostObservable<ComicProjectRequest | null> }
  readonly completeProjectRequest: (request: ComicProjectRequest) => void
}

type ComicStudioProps = PropsRuntime<'studio', 'comic'> & PropsLocale<typeof NS> & InjectFace<ComicStudioInjected>

/**
 * Render the current Session's editor for existing comic projects.
 * @param props - editor operations, navigation, and localized labels.
 * @returns The comic creation studio.
 */
export function ComicStudio({ api, sessionId, t, useProjectRequest, completeProjectRequest }: ComicStudioProps) {
  const projectRequest = useProjectRequest(request => request?.sessionId === sessionId ? request : null)
  return <ComicWorkbench api={api} t={t} projectRequest={projectRequest} completeProjectRequest={completeProjectRequest} />
}
