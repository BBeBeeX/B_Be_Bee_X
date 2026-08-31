/**
 * URN — the stable identity of a catalogue entity.
 *
 *     BBeBee:<providerInstance>:<kind>:<id>
 *            │                  │       └── provider-local, opaque, may contain ':'
 *            │                  └────────── track | album | artist | playlist | genre
 *            └───────────────────────────── the *instance*, not the plugin
 *
 * Keying on the instance rather than the plugin is what lets a user configure
 * two Navidrome servers without their ids colliding.
 *
 * See docs/07-data-model.md §1.
 */

export const URN_SCHEME = 'BBeBee' as const

export type UrnKind = 'track' | 'album' | 'artist' | 'playlist' | 'genre'

const URN_KINDS: readonly UrnKind[] = ['track', 'album', 'artist', 'playlist', 'genre']

export interface Urn {
  instanceId: string
  kind: UrnKind
  id: string
}

export class UrnError extends Error {
  override readonly name = 'UrnError'
  constructor(
    readonly value: string,
    reason: string,
  ) {
    super(`invalid urn ${JSON.stringify(value)}: ${reason}`)
  }
}

export function isUrnKind(value: string): value is UrnKind {
  return (URN_KINDS as readonly string[]).includes(value)
}

/**
 * Parse a URN.
 *
 * Splits on the first three colons only — everything after the third belongs
 * to the provider-local id, which is allowed to contain colons because some
 * backends use them in their own identifiers.
 */
export function parseUrn(urn: string): Urn {
  const parts = splitN(urn, ':', 4)
  if (parts.length !== 4) throw new UrnError(urn, 'expected 4 segments')

  const [scheme, instanceId, kind, id] = parts as [string, string, string, string]
  if (scheme !== URN_SCHEME) throw new UrnError(urn, `expected scheme "${URN_SCHEME}"`)
  if (!instanceId) throw new UrnError(urn, 'empty instance id')
  if (!isUrnKind(kind)) throw new UrnError(urn, `unknown kind "${kind}"`)
  if (!id) throw new UrnError(urn, 'empty id')

  return { instanceId, kind, id }
}

/** Parse without throwing. Returns `undefined` on any malformed input. */
export function tryParseUrn(urn: string): Urn | undefined {
  try {
    return parseUrn(urn)
  } catch {
    return undefined
  }
}

export function formatUrn(urn: Urn): string {
  if (!urn.instanceId) throw new UrnError('<object>', 'empty instance id')
  if (urn.instanceId.includes(':')) throw new UrnError(urn.instanceId, 'instance id may not contain ":"')
  if (!urn.id) throw new UrnError('<object>', 'empty id')
  return `${URN_SCHEME}:${urn.instanceId}:${urn.kind}:${urn.id}`
}

/** The owning provider instance, without validating the rest. */
export function instanceOf(urn: string): string {
  return parseUrn(urn).instanceId
}

export function kindOf(urn: string): UrnKind {
  return parseUrn(urn).kind
}

export function isUrn(value: string): boolean {
  return tryParseUrn(value) !== undefined
}

/**
 * Canonical ordering for a `track_links` row, which stores each pair once
 * under a `CHECK (urn_a < urn_b)` constraint.
 */
export function orderUrnPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

/** `String.prototype.split` with a limit that keeps the remainder, unlike the built-in. */
function splitN(value: string, sep: string, limit: number): string[] {
  const out: string[] = []
  let rest = value
  while (out.length < limit - 1) {
    const i = rest.indexOf(sep)
    if (i === -1) break
    out.push(rest.slice(0, i))
    rest = rest.slice(i + sep.length)
  }
  out.push(rest)
  return out
}
