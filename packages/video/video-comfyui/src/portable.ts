/** Declarative workflow migration without transport credentials or machine-bound inputs. */
import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resolveConfig, resolveWorkflows } from './config.ts'
import type { Config, ComfyWorkflow, ScalarBinding } from './types.ts'

function sanitized(workflow: ComfyWorkflow): ComfyWorkflow {
  const template = structuredClone(workflow.template) as Record<string, { inputs: Record<string, JsonValue>; _meta?: JsonValue }>
  const clear = (binding: ScalarBinding): void => {
    const node = template[binding.node]
    if (node !== undefined) node.inputs[binding.input] = ''
  }
  clear(workflow.prompt)
  clear(workflow.outputPrefix)
  for (const reference of workflow.references) clear(reference)
  for (const node of Object.values(template)) delete node._meta
  const visit = (value: unknown, key = ''): void => {
    const normalized = key.replace(/[-_\s.]/g, '')
    if (/apikey|authorization|password|secret|credential/i.test(normalized)
      || /(?:api|access|refresh|bearer|auth|session|client|hf|huggingface)token/i.test(normalized)
      || /^(?:token|auth|bearer|idtoken|identitytoken)$/i.test(normalized)) {
      throw new Error('Workflow credentials cannot be included in a portable configuration.')
    }
    if (typeof value === 'string') {
      if (value.split(/[\\/]/).includes('..')) throw new Error('Workflow parent-directory references require a target-machine binding.')
      if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|[a-zA-Z][a-zA-Z\d+.-]*:\/\/)/.test(value)) throw new Error('Workflow machine paths and URLs must be rebound on the target machine.')
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key)
    } else if (typeof value === 'object' && value !== null) {
      for (const [field, item] of Object.entries(value)) visit(item, field)
    }
  }
  visit(template)
  return { ...workflow, template }
}

/**
 * Export validated workflow templates while clearing operation inputs and excluding host transport settings.
 * @param config - Current operator settings.
 * @returns Versioned data containing no endpoint, headers, executable, or environment paths.
 */
export function exportWorkflows(config: Config): JsonValue {
  const bounds = resolveConfig({ ...config, enabled: false })
  const workflows = resolveWorkflows(config.workflows ?? [], bounds.maxJsonBytes)
  // Validation accepts finite JSON only; serialization detaches readonly workflow types from their host configuration.
  const portable = workflows.map(({ revision: _revision, ...workflow }) => sanitized(workflow))
  return JSON.parse(JSON.stringify({ version: 1, workflows: portable })) as JsonValue
}

/**
 * Validate portable workflow data against this machine's transport settings before persisting it disabled.
 * @param value - Untrusted capability configuration from a migration package.
 * @param machine - Existing local endpoint, credentials, limits and runtime binding.
 * @returns Validated workflow data; no runtime starts and no original machine setting is replaced.
 */
export function restoreWorkflows(value: JsonValue, machine: Config): readonly ComfyWorkflow[] {
  const parsed = z.object({ version: z.literal(1), workflows: z.array(z.unknown()) }).strict().parse(value)
  const workflows = parsed.workflows as ComfyWorkflow[]
  const bounds = resolveConfig({ ...machine, enabled: false })
  return resolveWorkflows(workflows, bounds.maxJsonBytes).map(({ revision: _revision, ...workflow }) => sanitized(workflow))
}
