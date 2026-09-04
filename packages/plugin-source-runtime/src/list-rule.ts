/**
 * Evaluating a `ListRule` against a fetched document.
 *
 * `trackList` selects the repeating element; every other field is evaluated
 * against *one* of them, with `{{item}}` in scope. That two-stage shape is the
 * whole reason the language distinguishes nodes from text: the first step has
 * to keep the objects.
 *
 * A row missing a *required* field is dropped rather than imported half-built,
 * and the drop is counted — a search that silently returns three of twenty
 * results looks like a thin backend rather than a broken rule.
 */

import { RuleError } from '@BBeBee/protocol'
import type { ListRule, Track } from '@BBeBee/protocol'
import {
  RuleSyntaxError,
  evaluateNodes,
  evaluateParsed,
  parseRule,
  type RuleContext,
  type RuleSite,
} from '@BBeBee/source-rules'
import type { ParsedRule, TemplateScope } from '@BBeBee/source-rules'

export interface ListRowsResult {
  rows: Record<string, unknown>[]
  /** Elements dropped for want of a required field. Surfaced, never hidden. */
  dropped: number
  /** Elements sharing a `trackId` with an earlier one. Also surfaced. */
  duplicates: number
}

export interface ListRuleContext {
  document: unknown
  scope: TemplateScope
  sourceId: string
  block: string
}

/** Fields every row must have, whatever else the document declares. */
const REQUIRED: (keyof ListRule)[] = ['trackId', 'title']

/**
 * Run a list rule.
 *
 * Returns plain records rather than `Track`s: the caller knows which URN
 * namespace they belong to and what the raw payload should be stored as, and
 * this layer deliberately does not.
 */
export function evaluateListRule(rule: ListRule, ctx: ListRuleContext): ListRowsResult {
  const site = (field: string) => ({ block: ctx.block, field, sourceId: ctx.sourceId })

  const elements = evaluateNodes(rule.trackList, {
    document: ctx.document,
    scope: ctx.scope,
    site: site('trackList'),
    vars: new Map(),
  })

  /*
   * Parse each field rule once, not once per row.
   *
   * The inner loop ran `evaluate(fieldRule, …)` — which re-parses — for every
   * field of every element, so a 50-row page with 8 fields parsed the same 8
   * strings 400 times. `evaluateParsed` existed for exactly this and had no
   * callers.
   *
   * It also moves a malformed rule's error out of the row loop: it is raised
   * once, before any row is built, instead of identically on each of them.
   */
  const fields: { field: string; parsed: ParsedRule }[] = []
  for (const [field, fieldRule] of Object.entries(rule)) {
    if (field === 'trackList' || typeof fieldRule !== 'string' || !fieldRule) continue
    fields.push({ field, parsed: parseFieldRule(fieldRule, site(field)) })
  }

  const rows: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let dropped = 0
  let duplicates = 0

  for (const element of elements) {
    // Each element is its own little document: a field rule selects *within*
    // it, and `{{item}}` names it for templates.
    const rowCtx: RuleContext = {
      document: element,
      scope: { ...ctx.scope, item: element as Record<string, unknown> },
      site: site('trackList'),
      vars: new Map(),
    }

    const row: Record<string, unknown> = { raw: element }
    let usable = true

    for (const { field, parsed } of fields) {
      const values = evaluateParsed(parsed, { ...rowCtx, site: site(field) })
      const value = values[0]

      /*
       * Whitespace is absence, not a value.
       *
       * `"  "` passed the empty check, so a `trackId` rule that matched an
       * empty cell produced the URN `BBeBee:<source>:track:  ` — a key that
       * looks like an id, collides with every other blank one on the page,
       * and cannot be typed back. A title of `"  "` is no better.
       */
      if (value === undefined || String(value).trim() === '') {
        if ((REQUIRED as string[]).includes(field)) usable = false
        continue
      }
      // Trimmed because a URN segment cannot carry leading or trailing space
      // and a backend's padding is not part of anybody's identifier.
      row[field] = field === 'trackId' ? String(value).trim() : value
    }

    if (!usable) {
      dropped++
      continue
    }
    // Two rows carrying one `trackId` become one URN, and the second silently
    // overwrites the first in the catalogue. A backend repeating an id in a
    // page is a backend bug, but losing a row to it quietly is ours.
    const id = String(row.trackId)
    if (seen.has(id)) {
      duplicates++
      continue
    }
    seen.add(id)
    rows.push(row)
  }

  return { rows, dropped, duplicates }
}

/**
 * A row as a `Track`.
 *
 * Coercion is explicit and total: `durationMs` accepts `213`, `"3:33"` and
 * `"213.4s"` and rejects everything else, rather than writing `NaN` into the
 * catalogue where it would surface much later as a scrubber that does not
 * move (docs/06 §3.6).
 */
export function rowToTrack(
  row: Record<string, unknown>,
  sourceId: string,
  block: string,
): Track {
  const id = String(row.trackId)
  const artist = typeof row.artist === 'string' ? row.artist : undefined

  const track: Track = {
    urn: `BBeBee:${sourceId}:track:${id}`,
    title: String(row.title),
    artists: artist
      ? [{ urn: `BBeBee:${sourceId}:artist:${slug(artist)}`, name: artist, role: 'main', ordinal: 0 }]
      : [],
    available: true,
  }

  const durationMs = coerceDuration(row.durationMs, sourceId, block)
  if (durationMs !== undefined) track.durationMs = durationMs
  if (typeof row.album === 'string') track.albumTitle = row.album
  if (typeof row.albumId === 'string') track.albumUrn = `BBeBee:${sourceId}:album:${row.albumId}`
  if (typeof row.artwork === 'string') track.artwork = { id: row.artwork, sourceUrl: row.artwork }
  return track
}

/**
 * Parse one field rule, failing inside the taxonomy.
 *
 * `parseRule` throws `RuleSyntaxError`, which is not a `SourceError` — so a
 * malformed field rule escaped past every handler that branches on `code`
 * and surfaced as "something went wrong" rather than as the field it is in.
 */
function parseFieldRule(rule: string, site: RuleSite): ParsedRule {
  try {
    return parseRule(rule)
  } catch (error) {
    if (error instanceof RuleSyntaxError) {
      throw new RuleError(error.message, { block: site.block, field: site.field }, site.sourceId, {
        cause: error,
      })
    }
    throw error
  }
}

/** `213` · `"213"` · `"3:33"` · `"213.4s"` → milliseconds, or a `RuleError`. */
export function coerceDuration(
  value: unknown,
  sourceId: string,
  block: string,
): number | undefined {
  if (value === undefined || value === '') return undefined

  const text = String(value).trim()
  if (/^\d+$/.test(text)) return Number(text)

  // `m:ss` or `h:mm:ss`, which HTML documents use routinely.
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text)
  if (clock) {
    const hours = Number(clock[1] ?? 0)
    return ((hours * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000
  }

  const seconds = /^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/i.exec(text)
  if (seconds) return Math.round(Number(seconds[1]) * 1000)

  throw new RuleError(
    `durationMs rule produced ${JSON.stringify(text)}, which is not a duration`,
    { block, field: 'durationMs' },
    sourceId,
  )
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
}
