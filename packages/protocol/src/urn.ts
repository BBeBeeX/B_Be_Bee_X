/**
 * URN — the stable identity of a catalogue entity.
 *
 *     BBeBee:<sourceId>:<kind>:<id>
 *            │          │       └── source-local, opaque, may contain ':'
 *            │          └────────── track | album | artist | playlist | genre
 *            └───────────────────── the *source*, derived from its sourceUrl
 *
 * Keying on the source is what lets a user import two Navidrome servers
 * without their ids colliding — and it is why the scheme survived music
 * sources becoming imported strings rather than plugin packages: the segment
 * always meant "whichever namespace owns this id", never "which package
 * produced it".
 *
 * See docs/07-data-model.md §1 and docs/06-music-sources.md §1.2.
 */

export const URN_SCHEME = 'BBeBee' as const

export type UrnKind = 'track' | 'album' | 'artist' | 'playlist' | 'genre'

const URN_KINDS: readonly UrnKind[] = ['track', 'album', 'artist', 'playlist', 'genre']

export interface Urn {
  sourceId: string
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
 * to the source-local id, which is allowed to contain colons because some
 * backends use them in their own identifiers.
 */
export function parseUrn(urn: string): Urn {
  const parts = splitN(urn, ':', 4)
  if (parts.length !== 4) throw new UrnError(urn, 'expected 4 segments')

  const [scheme, sourceId, kind, id] = parts as [string, string, string, string]
  if (scheme !== URN_SCHEME) throw new UrnError(urn, `expected scheme "${URN_SCHEME}"`)
  if (!sourceId) throw new UrnError(urn, 'empty source id')
  // Symmetrical with `formatUrn`: whatever cannot be written must not parse,
  // or a URN that round-trips through storage stops round-tripping through
  // code, and the mismatch surfaces far from whatever produced it.
  if (/\s/.test(sourceId)) throw new UrnError(urn, 'source id may not contain whitespace')
  if (!isUrnKind(kind)) throw new UrnError(urn, `unknown kind "${kind}"`)
  if (!id) throw new UrnError(urn, 'empty id')

  return { sourceId, kind, id }
}

/** Parse without throwing. Returns `undefined` on any malformed input. */
export function tryParseUrn(urn: string): Urn | undefined {
  try {
    return parseUrn(urn)
  } catch {
    return undefined
  }
}

/**
 * Build a URN.
 *
 * Validates everything `parseUrn` would reject, so a malformed URN cannot be
 * *written*. Without this the failure surfaces much later, as a row whose
 * `urn` primary key no consumer can parse — and by then the write that made it
 * is long gone from the logs.
 */
export function formatUrn(urn: Urn): string {
  if (!urn.sourceId) throw new UrnError('<object>', 'empty source id')
  if (urn.sourceId.includes(':')) throw new UrnError(urn.sourceId, 'source id may not contain ":"')
  if (/\s/.test(urn.sourceId)) throw new UrnError(urn.sourceId, 'source id may not contain whitespace')
  if (!isUrnKind(urn.kind)) throw new UrnError(String(urn.kind), `unknown kind "${String(urn.kind)}"`)
  if (!urn.id) throw new UrnError('<object>', 'empty id')
  return `${URN_SCHEME}:${urn.sourceId}:${urn.kind}:${urn.id}`
}

/** The owning source, without validating the rest. */
export function sourceOf(urn: string): string {
  return parseUrn(urn).sourceId
}

export function kindOf(urn: string): UrnKind {
  return parseUrn(urn).kind
}

export function isUrn(value: string): boolean {
  return tryParseUrn(value) !== undefined
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
