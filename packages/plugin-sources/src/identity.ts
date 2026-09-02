/**
 * Source identity, and the document → row transform.
 *
 * A source is keyed by its `sourceUrl`, exactly as a legado book source is,
 * and addressed by a **derived** id: slugified host plus four hex of a hash.
 * Derived rather than random so that re-importing the same document produces
 * the same id — which is what makes re-import an *update* that keeps every URN,
 * cached row, cookie jar and playlist reference (docs/06 §1.2, §9).
 */

import { SourceFormatError } from '@BBeBee/protocol'
import type { SourceDocument, SourceRecord, SourceType } from '@BBeBee/protocol'

const SOURCE_TYPES: readonly SourceType[] = ['music', 'podcast', 'radio']

/** FNV-1a. Not cryptographic — this identifies, it does not authenticate. */
export function hash32(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Derive the source id.
 *
 * The host makes it readable in a log line and in a URN; the hash suffix keeps
 * two paths on one host distinct. It never contains ':' — that would make
 * every URN in the namespace unparseable.
 */
export function sourceIdFor(sourceUrl: string): string {
  const slug = hostSlug(sourceUrl)
  return `${slug}-${hash32(sourceUrl).slice(0, 4)}`
}

function hostSlug(sourceUrl: string): string {
  let host: string
  try {
    host = new URL(sourceUrl).hostname || sourceUrl
  } catch {
    host = sourceUrl
  }
  const slug = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'source'
}

/**
 * The hosts a source may talk to.
 *
 * `sourceUrl`'s own host, plus whatever the document declares. Resolved once
 * at import so the import screen can show the user a plain list of hostnames —
 * a sentence they can actually judge (docs/06 §8).
 */
export function allowedHostsFor(doc: SourceDocument): string[] {
  const hosts = new Set<string>()
  const own = hostOf(doc.sourceUrl)
  if (own) hosts.add(own)
  for (const entry of doc.allowedHosts ?? []) {
    const host = hostOf(entry) ?? entry.trim().toLowerCase()
    if (host) hosts.add(host)
  }
  return [...hosts].sort()
}

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

/**
 * Validate a parsed document.
 *
 * Collects every issue rather than the first: the import screen lists them all,
 * and fixing one at a time is miserable. `ruleStream` is the only required rule
 * block, because a source that cannot produce a playable URL is not a music
 * source (docs/06 §1.3).
 */
export function validateDocument(value: unknown, index = 0): SourceDocument {
  const issues: { path: string; message: string }[] = []
  const at = (path: string, message: string) => issues.push({ path, message })

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceFormatError(`entry ${index} is not an object`, [
      { path: `[${index}]`, message: 'expected a JSON object' },
    ])
  }
  const doc = value as Record<string, unknown>

  if (typeof doc.sourceUrl !== 'string' || !doc.sourceUrl.trim()) {
    at('sourceUrl', 'required, and must be the backend base URL')
  }
  if (typeof doc.sourceName !== 'string' || !doc.sourceName.trim()) {
    at('sourceName', 'required')
  }
  if (doc.sourceType !== undefined && !SOURCE_TYPES.includes(doc.sourceType as SourceType)) {
    at('sourceType', `must be one of ${SOURCE_TYPES.join(', ')}`)
  }
  if (doc.allowedHosts !== undefined && !isStringArray(doc.allowedHosts)) {
    at('allowedHosts', 'must be an array of hostnames')
  }

  const stream = doc.ruleStream
  if (stream === undefined) {
    at('ruleStream', 'required — a source that cannot produce a URL cannot play anything')
  } else if (stream === null || typeof stream !== 'object') {
    at('ruleStream', 'must be an object')
  } else if (typeof (stream as Record<string, unknown>).url !== 'string') {
    at('ruleStream.url', 'required')
  }

  if (issues.length) {
    const name = typeof doc.sourceName === 'string' ? doc.sourceName : `entry ${index}`
    throw new SourceFormatError(`${name} is not a valid source document`, issues)
  }
  return doc as unknown as SourceDocument
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * Parse an imported string into documents.
 *
 * Tolerates what people actually paste: leading whitespace, a wrapping
 * markdown code fence, and either one object or an array of them.
 */
export function parseSourceInput(input: string): unknown[] {
  const text = stripFence(input).trim()
  if (!text) throw new SourceFormatError('nothing to import', [])

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new SourceFormatError('not valid JSON', [
      { path: '', message: cause instanceof Error ? cause.message : String(cause) },
    ])
  }
  return Array.isArray(parsed) ? parsed : [parsed]
}

function stripFence(input: string): string {
  const fenced = /^\s*```(?:json|jsonc)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(input)
  return fenced?.[1] ?? input
}

/**
 * Fields the app maintains, stripped on export.
 *
 * Sharing a source must not leak how fast *your* network is or when *you* last
 * used it. Credentials are not on this list because they are never in the
 * document to begin with — they live in `ctx.secrets` and `source_vars`, which
 * is what makes export safe by construction rather than by remembering
 * (docs/06 §5, docs/07 §4.1).
 */
const APP_MAINTAINED = ['lastUpdated', 'respondTime', 'weight'] as const

export function exportableDocument(doc: SourceDocument): SourceDocument {
  const out = { ...doc } as unknown as Record<string, unknown>
  for (const key of APP_MAINTAINED) delete out[key]
  return out as unknown as SourceDocument
}

/** Which top-level fields differ. Drives the import diff the user is shown. */
export function changedFields(before: SourceDocument, after: SourceDocument): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const key of keys) {
    if ((APP_MAINTAINED as readonly string[]).includes(key)) continue
    const a = (before as unknown as Record<string, unknown>)[key]
    const b = (after as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(key)
  }
  return changed.sort()
}

/** Build a record from a document. `now` is injected so tests are not clocks. */
export function recordFor(
  doc: SourceDocument,
  opts: {
    docJson: string
    now: number
    importedAt?: number
    sortOrder?: number
    group?: string
    originUri?: string
    locallyModified?: boolean
  },
): SourceRecord {
  const group = opts.group ?? doc.sourceGroup
  return {
    id: sourceIdFor(doc.sourceUrl),
    sourceUrl: doc.sourceUrl,
    name: doc.sourceName,
    ...(group ? { group } : {}),
    type: doc.sourceType ?? 'music',
    doc,
    docJson: opts.docJson,
    docHash: hash32(opts.docJson),
    enabled: doc.enabled !== false,
    sortOrder: opts.sortOrder ?? doc.sortOrder ?? 0,
    allowedHosts: allowedHostsFor(doc),
    locallyModified: opts.locallyModified ?? false,
    ...(opts.originUri ? { originUri: opts.originUri } : {}),
    importedAt: opts.importedAt ?? opts.now,
    updatedAt: opts.now,
    failCount: 0,
  }
}
