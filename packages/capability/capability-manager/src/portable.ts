/** Shared parser for declarative capability inventories carried by project transfers. */
import { z } from 'zod'
import { CapabilityId } from './brand.ts'
import type { PortableCapabilityManifest } from './types.ts'

const schema: z.ZodType<PortableCapabilityManifest> = z.object({
  format: z.literal('dsh-capabilities'), version: z.literal(1),
  capabilities: z.array(z.object({
    id: z.string().min(1).max(256).refine(value => value.trim().length > 0).transform(CapabilityId),
    engineId: z.string().min(1), version: z.string().min(1).optional(), configuration: z.json().optional(),
  }).strict().transform(({ version, configuration, ...required }) => ({
    ...required, ...version === undefined ? {} : { version }, ...configuration === undefined ? {} : { configuration },
  }))),
}).strict().refine(value => new Set(value.capabilities.map(item => item.id)).size === value.capabilities.length,
  'Capability manifest repeats an identity.')

/**
 * Validate a complete untrusted manifest without preparing or invoking a provider.
 * @param value - JSON read from a transfer package or management request.
 * @returns Strict versioned inventory with unique identities; callers own complete transfer byte and provider-count limits.
 */
export function parsePortableCapabilityManifest(value: unknown): PortableCapabilityManifest {
  return schema.parse(value)
}
