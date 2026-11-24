/** Durable launcher selection for a session's opt-in REA connection. */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Exact launcher sampled for one session; credentials must stay outside these fields. */
export interface ReaExperimentSelection {
  /** Executable started without shell interpolation. */
  command: string
  /** Arguments passed directly to the executable. */
  args: string[]
  /** Per-tool-call and resource-request timeout in milliseconds. */
  toolCallTimeoutMs: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records the REA launcher selected before the session's first request.
     * Log-only; absence keeps restored sessions outside the experiment.
     */
    'rea-experiment/selected': ReaExperimentSelection
  }
}

const selectionSchema: z.ZodType<ReaExperimentSelection> = z.object({
  command: z.string().regex(/^[^\0]*[^\0\s][^\0]*$/u),
  args: z.array(z.string().regex(/^[^\0]*$/u)),
  toolCallTimeoutMs: z.number().int().min(1).max(MAX_TIMER_DELAY_MS),
}).strict()

/** Host-only projection retaining the first durable REA launcher selection. */
export const reaExperimentProjectionDefinition = {
  key: 'reaExperiment',
  stateVersion: 1,
  stateSchema: selectionSchema.nullable(),
  init: () => null,
  apply: (selection, event) => event.type === 'rea-experiment/selected'
    ? selection ?? selectionSchema.parse(event.data)
    : selection,
} satisfies ProjectionDefinition<'reaExperiment', ReaExperimentSelection | null>
