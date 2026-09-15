/**
 * Smart-playlist compilation: a rule tree to **parameterised SQL only**.
 *
 * The rule tree is untrusted input — it comes from the database, from a UI, and
 * one day from an imported playlist. So there are exactly two things this file
 * may never do: interpolate a field name that is not in the allowlist below,
 * and interpolate a value at all. Field names map through `FIELDS`; values are
 * always bound.
 *
 * The compiled fragment assumes the aliases `SMART_PLAYLIST_FROM` introduces
 * (`t`, `al`, `st`, `pa`), and is deliberately pure: no database, no clock of
 * its own (`now` is passed), so the whole mapping is testable as a table.
 *
 * See docs/07 §4.6 and docs/09 §6.
 */

import { SmartQueryError } from '@BBeBee/protocol'
import type { SmartField, SmartPlaylist, SmartRule, SqlValue, StreamQuality } from '@BBeBee/protocol'

/** The joins every compiled expression is written against. */
export const SMART_PLAYLIST_FROM = `
  FROM tracks t
  LEFT JOIN albums al ON al.urn = t.album_urn
  LEFT JOIN track_stats st ON st.urn = t.urn
  LEFT JOIN track_artists ta0 ON ta0.track_urn = t.urn AND ta0.ordinal = 0
  LEFT JOIN artists pa ON pa.urn = ta0.artist_urn`

export interface CompiledSmart {
  /** A boolean fragment without the `WHERE` keyword. Never empty. */
  where: string
  params: SqlValue[]
  /** ORDER BY expression, without direction. Absent means the caller's default. */
  orderBy?: string
  desc: boolean
  /** Only when the rule asked for one; absent means "everything". */
  limit?: number
}

type FieldKind = 'text' | 'number' | 'date' | 'boolean' | 'tier'

interface FieldSpec {
  expr: string
  kind: FieldKind
}

/**
 * The field allowlist.
 *
 * `Object.hasOwn` gates every lookup, so a field named `toString` is a
 * `SmartQueryError` rather than an inherited function interpolated into SQL.
 * `quality` compares the *best available binding's tier* by rank, because
 * tier names do not sort correctly as strings (`hi-res` < `high`).
 */
const FIELDS: Record<SmartField, FieldSpec> = {
  title: { expr: 't.title', kind: 'text' },
  artist: { expr: "COALESCE(pa.name, '')", kind: 'text' },
  album: { expr: "COALESCE(al.title, '')", kind: 'text' },
  genre: {
    expr: `COALESCE((SELECT GROUP_CONCAT(g.name, char(31))
                     FROM track_genres tg JOIN genres g ON g.id = tg.genre_id
                    WHERE tg.track_urn = t.urn), '')`,
    kind: 'text',
  },
  year: { expr: 'COALESCE(t.year, 0)', kind: 'number' },
  bpm: { expr: 'COALESCE(t.bpm, 0)', kind: 'number' },
  durationMs: { expr: 'COALESCE(t.duration_ms, 0)', kind: 'number' },
  playCount: { expr: 'COALESCE(st.play_count, 0)', kind: 'number' },
  skipCount: { expr: 'COALESCE(st.skip_count, 0)', kind: 'number' },
  lastPlayedAt: { expr: 'COALESCE(st.last_played_at, 0)', kind: 'date' },
  addedAt: { expr: 'COALESCE(t.fetched_at, 0)', kind: 'date' },
  rating: { expr: 'COALESCE(st.rating, 0)', kind: 'number' },
  loved: { expr: 'COALESCE(st.loved, 0)', kind: 'boolean' },
  hasBinding: {
    expr: 'CASE WHEN EXISTS (SELECT 1 FROM media_bindings mb WHERE mb.track_urn = t.urn) THEN 1 ELSE 0 END',
    kind: 'boolean',
  },
  sourceId: { expr: 't.source_id', kind: 'text' },
  quality: {
    expr: `COALESCE((SELECT MAX(CASE mb.quality
                       WHEN 'low' THEN 0 WHEN 'normal' THEN 1 WHEN 'high' THEN 2
                       WHEN 'lossless' THEN 3 WHEN 'hi-res' THEN 4 ELSE 0 END)
                     FROM media_bindings mb WHERE mb.track_urn = t.urn), 0)`,
    kind: 'tier',
  },
}

const TIER_RANK: Record<StreamQuality, number> = {
  low: 0,
  normal: 1,
  high: 2,
  lossless: 3,
  'hi-res': 4,
}

const MS_PER_DAY = 86_400_000

/**
 * Compile a whole smart playlist.
 *
 * `now` is a parameter so `inLast` is deterministic in tests; the only caller
 * in production passes `Date.now()`.
 */
export function compileSmartQuery(query: SmartPlaylist, now = Date.now()): CompiledSmart {
  if (!query || typeof query !== 'object') {
    throw new SmartQueryError('smart playlist must be an object', '')
  }
  const { sql, params } = compileRule(query.rules, now, 'rules')

  const compiled: CompiledSmart = { where: sql, params, desc: query.desc === true }
  if (query.orderBy !== undefined) {
    compiled.orderBy = field(query.orderBy, 'orderBy').expr
  }
  if (query.limit !== undefined) {
    if (
      typeof query.limit !== 'number' ||
      !Number.isFinite(query.limit) ||
      !Number.isInteger(query.limit) ||
      query.limit <= 0
    ) {
      throw new SmartQueryError('limit must be a positive integer', 'limit')
    }
    compiled.limit = query.limit
  }
  return compiled
}

/** Compile one node. `path` is what makes an error actionable. */
export function compileRule(rule: SmartRule, now = Date.now(), path = 'rules'): {
  sql: string
  params: SqlValue[]
} {
  if (!rule || typeof rule !== 'object') {
    throw new SmartQueryError('rule must be an object', path)
  }

  if ('op' in rule) {
    if (rule.op === 'not') {
      const inner = compileRule(rule.rule, now, `${path}.rule`)
      return { sql: `NOT (${inner.sql})`, params: inner.params }
    }
    if (rule.op !== 'and' && rule.op !== 'or') {
      throw new SmartQueryError(`unknown operator ${JSON.stringify(rule.op)}`, path)
    }
    if (!Array.isArray(rule.rules) || rule.rules.length === 0) {
      // An empty group is a half-finished rule, not "no filter": compiling it
      // to a constant hides the mistake behind a playlist that looks fine.
      throw new SmartQueryError(`${rule.op} group has no rules`, path)
    }
    const parts: string[] = []
    const params: SqlValue[] = []
    rule.rules.forEach((child, index) => {
      const compiled = compileRule(child, now, `${path}.rules[${index}]`)
      parts.push(compiled.sql)
      params.push(...compiled.params)
    })
    return { sql: `(${parts.join(rule.op === 'and' ? ' AND ' : ' OR ')})`, params }
  }

  const spec = field(rule.field, path)
  return compare(rule, spec, now, path)
}

function field(name: unknown, path: string): FieldSpec {
  if (typeof name !== 'string' || !Object.hasOwn(FIELDS, name)) {
    throw new SmartQueryError(`unknown field ${JSON.stringify(name)}`, path)
  }
  return FIELDS[name as SmartField]
}

function compare(
  rule: Extract<SmartRule, { field: SmartField }>,
  spec: FieldSpec,
  now: number,
  path: string,
): { sql: string; params: SqlValue[] } {
  const { cmp } = rule
  if (cmp === 'inLast') {
    if (spec.kind !== 'date') {
      throw new SmartQueryError(`inLast does not apply to ${rule.field}`, path)
    }
    const days = numberValue(rule.value, path)
    if (days <= 0) throw new SmartQueryError('inLast needs a positive number of days', path)
    return { sql: `${spec.expr} >= ?`, params: [now - days * MS_PER_DAY] }
  }

  if (cmp === 'contains' || cmp === 'startsWith') {
    if (spec.kind !== 'text') {
      throw new SmartQueryError(`${cmp} does not apply to ${rule.field}`, path)
    }
    const text = String(rule.value ?? '')
    const pattern = cmp === 'contains' ? `%${escapeLike(text)}%` : `${escapeLike(text)}%`
    return { sql: `${spec.expr} LIKE ? ESCAPE '\\'`, params: [pattern] }
  }

  const value = coerce(rule.value, spec, rule.field, path)
  switch (cmp) {
    case 'eq':
      return { sql: `${spec.expr} = ?`, params: [value] }
    case 'neq':
      // `NOT (expr = ?)`, never `expr <> ?`: a nullable column would make
      // `<>` drop NULL rows rather than keep them.
      return { sql: `NOT (${spec.expr} = ?)`, params: [value] }
    case 'gt':
      return { sql: `${spec.expr} > ?`, params: [value] }
    case 'lt':
      return { sql: `${spec.expr} < ?`, params: [value] }
    default:
      throw new SmartQueryError(`unknown comparator ${JSON.stringify(cmp)}`, path)
  }
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SmartQueryError(`expected a number, got ${JSON.stringify(value)}`, path)
  }
  return value
}

function coerce(value: unknown, spec: FieldSpec, name: string, path: string): SqlValue {
  if (spec.kind === 'boolean') {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value === 1 || value === 0) return value
    throw new SmartQueryError(`loved/hasBinding expects a boolean, got ${JSON.stringify(value)}`, path)
  }
  if (spec.kind === 'tier') {
    if (typeof value !== 'string' || !Object.hasOwn(TIER_RANK, value)) {
      throw new SmartQueryError(`unknown quality tier ${JSON.stringify(value)}`, path)
    }
    return TIER_RANK[value as StreamQuality]
  }
  if (value === null || value === undefined) {
    throw new SmartQueryError(`${name} needs a value`, path)
  }
  if (typeof value === 'boolean' || (typeof value === 'object')) {
    throw new SmartQueryError(`${name} does not compare against ${JSON.stringify(value)}`, path)
  }
  return value as SqlValue
}

/** Escape the LIKE metacharacters, so a `%` in a title is a `%`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}
