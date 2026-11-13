/** Validate the browser file before passing declarative settings to the Host validator. */
import { isJsonValue } from '@deepseek-ai/dsh-util-values'
import type { PortableCapabilityManifest } from '@deepseek-ai/dsh-capability-manager/types'

/**
 * Parse a versioned JSON capability file without interpreting provider configuration.
 * @param text - selected local file text.
 * @returns the validated document; individual provider settings remain Host-validated.
 */
export function parseCapabilityFile(text: string): PortableCapabilityManifest {
  const value: unknown = JSON.parse(text)
  if (!isJsonValue(value) || typeof value !== 'object' || value === null || !('format' in value)
    || value.format !== 'dsh-capabilities' || !('version' in value) || value.version !== 1
    || !('capabilities' in value) || !Array.isArray(value.capabilities)
    || !value.capabilities.every((item: unknown) => typeof item === 'object' && item !== null
      && 'id' in item && typeof item.id === 'string' && item.id.length > 0
      && 'engineId' in item && typeof item.engineId === 'string' && item.engineId.length > 0
      && (!('version' in item) || typeof item.version === 'string'))) {
    throw new Error('Invalid dsh-capabilities version 1 JSON document.')
  }
  return value as PortableCapabilityManifest
}
