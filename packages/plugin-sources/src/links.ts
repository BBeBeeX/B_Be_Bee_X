/**
 * Recognising the same recording across sources — docs/06 §11.
 *
 * The same song on a Navidrome, on a Jellyfin, and on disk is **three
 * entities with three URNs**, related by rows in `track_links`. Merging them
 * into one row would be simpler and wrong: they have different bitrates,
 * different availability, and one of them works on a plane.
 *
 * ⚠️ The confidence column is the whole design. Anything below 1.00 is a
 * *hint* — used to offer a fallback, shown as "also available on…" — and never
 * used to silently merge library entries, because live versions, remasters and
 * radio edits share titles, artists and near-identical durations. Merging on a
 * bad guess makes a library wrong in a way that is very hard to diagnose, and
 * the user has no way to know it happened.
 */

import { orderUrnPair } from '@BBeBee/protocol'
import type { DbService, ExternalIds, LinkMethod, Track, TrackLink } from '@BBeBee/protocol'

/*
 * `LinkMethod` and `TrackLink` live in the protocol, not here: they are the
 * shape `ctx.sources.linksFor` returns, so a caller reading a link should not
 * have to import this package to name what it got.
 */

/** Below this a link is a hint, never a merge. See the file header. */
export const MERGE_CONFIDENCE = 1

/** Namespaces that identify a *recording*, so a match is exact. */
const EXACT: { namespace: keyof ExternalIds; method: LinkMethod }[] = [
  { namespace: 'isrc', method: 'isrc' },
  { namespace: 'mbid', method: 'mbid' },
]

/**
 * Store the identifiers a provider reported.
 *
 * `upc` and the rest are kept too even though nothing matches on them yet:
 * they cost one row, they came from the backend for free, and re-fetching a
 * whole catalogue later to obtain them would not be free at all.
 */
export async function writeExternalIds(
  tx: DbService,
  urn: string,
  ids: ExternalIds | undefined,
): Promise<void> {
  if (!ids) return
  for (const [namespace, value] of Object.entries(ids)) {
    if (typeof value !== 'string' || !value.trim()) continue
    await tx.exec(
      `INSERT INTO external_ids (urn, namespace, value) VALUES (?, ?, ?)
       ON CONFLICT(urn, namespace, value) DO NOTHING`,
      [urn, namespace, normalise(namespace, value)],
    )
  }
}

/**
 * Link the given tracks to anything already in the catalogue that they match.
 *
 * Runs after a cache write, over just the URNs that were written — not over
 * the whole library. A full re-match on every search would be quadratic in a
 * table that reaches six figures.
 */
export async function linkTracks(db: DbService, urns: readonly string[]): Promise<number> {
  if (urns.length === 0) return 0
  let written = 0

  await db.transaction(async (tx) => {
    for (const { namespace, method } of EXACT) {
      /*
       * One query per namespace rather than per track: `idx_external_lookup`
       * is on (namespace, value), so this is a single index scan over the
       * shared values instead of N lookups.
       */
      const holes = urns.map(() => '?').join(',')
      const rows = await tx.query<{ urn: string; other: string }>(
        `SELECT mine.urn AS urn, theirs.urn AS other
           FROM external_ids mine
           JOIN external_ids theirs
             ON theirs.namespace = mine.namespace
            AND theirs.value = mine.value
            AND theirs.urn <> mine.urn
          WHERE mine.namespace = ? AND mine.urn IN (${holes})`,
        [namespace, ...urns],
      )
      for (const row of rows) {
        if (await upsertLink(tx, row.urn, row.other, 1, method)) written++
      }
    }
  })
  return written
}

/**
 * Record a link, keeping the best evidence.
 *
 * ⚠️ `manual` is never overwritten by automation. A user who said "these are
 * the same" has more information than any matcher, and an automated pass that
 * demoted their answer would be undoing work they cannot see was undone.
 */
async function upsertLink(
  tx: DbService,
  a: string,
  b: string,
  confidence: number,
  method: LinkMethod,
): Promise<boolean> {
  const [urnA, urnB] = orderUrnPair(a, b)
  const result = await tx.exec(
    `INSERT INTO track_links (urn_a, urn_b, confidence, method, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(urn_a, urn_b) DO UPDATE SET
       confidence = CASE WHEN track_links.method = 'manual' THEN track_links.confidence
                         ELSE MAX(track_links.confidence, excluded.confidence) END,
       method     = CASE WHEN track_links.method = 'manual' THEN 'manual'
                         WHEN excluded.confidence > track_links.confidence THEN excluded.method
                         ELSE track_links.method END`,
    [urnA, urnB, confidence, method, Date.now()],
  )
  return result.changes > 0
}

/** Everything linked to `urn`, best evidence first. */
export async function linksFor(db: DbService, urn: string): Promise<TrackLink[]> {
  const rows = await db.query<{ other: string; confidence: number; method: string }>(
    `SELECT urn_b AS other, confidence, method FROM track_links WHERE urn_a = ?
     UNION ALL
     SELECT urn_a AS other, confidence, method FROM track_links WHERE urn_b = ?
     ORDER BY confidence DESC`,
    [urn, urn],
  )
  return rows.map((row) => ({
    urn: row.other,
    confidence: row.confidence,
    method: row.method as LinkMethod,
  }))
}

/** The user said so. Never overwritten by automation. */
export async function linkManually(db: DbService, a: string, b: string): Promise<void> {
  await db.transaction((tx) => upsertLink(tx, a, b, 1, 'manual').then(() => undefined))
}

export async function unlink(db: DbService, a: string, b: string): Promise<void> {
  const [urnA, urnB] = orderUrnPair(a, b)
  await db.exec('DELETE FROM track_links WHERE urn_a = ? AND urn_b = ?', [urnA, urnB])
}

/**
 * Canonical form for an identifier.
 *
 * ISRCs are written `GB-AYE-75-00001` as often as `GBAYE7500001`, and the two
 * spellings of one code must not become two rows that never match each other.
 */
function normalise(namespace: string, value: string): string {
  const trimmed = value.trim()
  if (namespace === 'isrc') return trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (namespace === 'upc') return trimmed.replace(/\D/g, '')
  return trimmed.toLowerCase()
}

/** A `Track`'s ids, for the caller that has the track rather than the ids. */
export function idsOf(track: Track): ExternalIds | undefined {
  return track.externalIds
}
