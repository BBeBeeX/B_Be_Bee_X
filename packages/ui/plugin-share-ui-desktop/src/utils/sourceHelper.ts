import { tryParseUrn } from '@BBeBee/protocol'

/**
 * Checks whether a track, playlist, or album originates from a local device source
 * rather than a remote cloud provider.
 */
export function isLocalSource(target?: { urn?: string; source?: string } | null): boolean {
  if (!target) return false

  if (target.source === 'local') return true

  if (target.urn) {
    const urn = target.urn
    if (
      urn.startsWith('local:') ||
      urn.startsWith('source:local:') ||
      urn.startsWith('file:') ||
      urn.startsWith('bbebee-file:')
    ) {
      return true
    }

    const parsed = tryParseUrn(urn)
    if (parsed && parsed.sourceId === 'local') {
      return true
    }
  }

  return false
}
