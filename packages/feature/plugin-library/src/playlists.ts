/**
 * Playlist storage: the `playlists` and `playlist_items` tables.
 *
 * A stored playlist is an ordered list of tracks; a **smart** playlist is a
 * rule tree in `smart_query_json`, resolved at read time and read-only through
 * the item verbs. Both live here so one service owns the table and a reorder
 * cannot disagree with a read about what a position means (docs/07 §4.6).
 *
 * Everything a mutation changes is written in one transaction: the item rows,
 * the fractional index between them, and the playlist's `track_count`,
 * `duration_ms`, `revision` and `updated_at`. A cache column that disagrees
 * with its rows is worse than no cache column.
 */

import { between, LibraryError, parseUrn, sequence } from '@BBeBee/protocol'
import type {
  ArtworkRef,
  DbService,
  PageRequest,
  Paged,
  Playlist,
  PlaylistDetail,
  PlaylistItem,
  SmartPlaylist,
} from '@BBeBee/protocol'
import { compileSmartQuery, SMART_PLAYLIST_FROM } from './smart.js'
import { limitOf, offsetOf, paged, DEFAULT_LIMIT } from './paging.js'
import { newId } from './ids.js'

/** Rows as SQLite returns them. */
interface PlaylistRow {
  urn: string
  name: string
  description: string | null
  artwork_id: string | null
  artwork_source_url: string | null
  blurhash: string | null
  dominant_color: string | null
  owner: string | null
  is_public: number
  is_smart: number
  smart_query_json: string | null
  track_count: number | null
  duration_ms: number | null
  created_at?: number | null
  updated_at: number
}

interface ItemRow {
  id: string
  track_urn: string
  position: string
  added_at: number
  added_by: string | null
  note: string | null
}

const PLAYLIST_COLUMNS = `
  p.urn, p.name, p.description, p.artwork_id, p.owner, p.is_public,
  p.is_smart, p.smart_query_json, p.track_count, p.duration_ms, p.created_at, p.updated_at,
  aw.source_url AS artwork_source_url, aw.blurhash, aw.dominant_color`

const PLAYLIST_JOINS = 'LEFT JOIN artworks aw ON aw.id = p.artwork_id'

function artworkOf(row: PlaylistRow): ArtworkRef | undefined {
  if (!row.artwork_id) return undefined
  return {
    id: row.artwork_id,
    sourceUrl: row.artwork_source_url ?? undefined,
    blurhash: row.blurhash ?? undefined,
    dominantColor: row.dominant_color ?? undefined,
  }
}

export class Playlists {
  constructor(private readonly db: DbService) {}

  /* ── reads ─────────────────────────────────────────────────────────── */

  async list(page?: PageRequest): Promise<Paged<Playlist>> {
    const limit = limitOf(page)
    const offset = offsetOf(page?.cursor)
    const rows = await this.db.query<PlaylistRow>(
      `SELECT ${PLAYLIST_COLUMNS}
         FROM playlists p
         ${PLAYLIST_JOINS}
        ORDER BY p.updated_at DESC, p.urn ASC
        LIMIT ? OFFSET ?`,
      [limit + 1, offset],
    )
    const result = paged(rows, offset, limit)
    return { ...result, items: result.items.map((row) => this.toPlaylist(row)) }
  }

  async get(urn: string, page?: PageRequest): Promise<PlaylistDetail | undefined> {
    const row = await this.db.get<PlaylistRow>(
      `SELECT ${PLAYLIST_COLUMNS}
         FROM playlists p
         ${PLAYLIST_JOINS}
        WHERE p.urn = ?`,
      [urn],
    )
    if (!row) return undefined

    const playlist = this.toPlaylist(row)
    if (row.is_smart === 1) return this.resolveSmart(row, playlist, page)

    const limit = limitOf(page)
    const offset = offsetOf(page?.cursor)
    const items = await this.db.query<ItemRow>(
      `SELECT id, track_urn, position, added_at, added_by, note
         FROM playlist_items
        WHERE playlist_urn = ?
        ORDER BY position ASC
        LIMIT ? OFFSET ?`,
      [urn, limit + 1, offset],
    )
    const result = paged(items, offset, limit)
    return { ...playlist, items: result.items.map(toItem), hasMore: result.hasMore, ...(result.cursor ? { cursor: result.cursor } : {}) }
  }

  /**
   * Resolve a smart playlist.
   *
   * `limit` in the rule is the length of the list — "the top 50 most played" —
   * so it is honoured as a whole and comes back in one page. Without one, the
   * read pages like any other, so a rule that matches 100k tracks does not
   * materialise them to draw a screen (docs/06 §12's rule, applied here).
   */
  private async resolveSmart(
    row: PlaylistRow,
    playlist: Playlist,
    page?: PageRequest,
  ): Promise<PlaylistDetail> {
    const smart = parseSmart(row.smart_query_json, row.urn)
    const compiled = compileSmartQuery(smart)
    const cap = compiled.limit
    const limit = cap ?? limitOf(page, DEFAULT_LIMIT)
    const offset = cap === undefined ? offsetOf(page?.cursor) : 0

    const order = compiled.orderBy
      ? `${compiled.orderBy} ${compiled.desc ? 'DESC' : 'ASC'}, t.urn ASC`
      : `COALESCE(t.sort_title, t.title) ASC, t.urn ASC`

    const rows = await this.db.query<{ urn: string }>(
      `SELECT t.urn
       ${SMART_PLAYLIST_FROM}
        WHERE t.available = 1 AND ${compiled.where}
        ORDER BY ${order}
        LIMIT ? OFFSET ?`,
      [...compiled.params, limit + 1, offset],
    )

    const result = paged(rows, offset, limit)
    // One key per row, ascending. They are display order, not stable
    // identities: nothing can be moved or removed, so nothing keys off them.
    const positions = sequence(result.items.length)
    const items: PlaylistItem[] = result.items.map((item, index) => ({
      id: item.urn,
      trackUrn: item.urn,
      position: positions[index]!,
    }))

    return {
      ...playlist,
      isSmart: true,
      smart,
      items,
      hasMore: result.hasMore,
      ...(result.cursor ? { cursor: result.cursor } : {}),
      ...(result.hasMore ? {} : { trackCount: items.length }),
    }
  }

  /* ── writes ────────────────────────────────────────────────────────── */

  async create(
    name: string,
    opts: { description?: string; smart?: SmartPlaylist } = {},
  ): Promise<Playlist> {
    const clean = requiredName(name)
    const now = Date.now()
    const urn = `BBeBee:local:playlist:${newId('lp')}`

    if (opts.smart) {
      // Validate before storing: an uncompilable tree would turn every later
      // read of this playlist into a throw.
      compileSmartQuery(opts.smart)
      await this.db.exec(
        `INSERT INTO playlists
           (urn, name, description, is_smart, smart_query_json, track_count, duration_ms,
            revision, sync_state, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, NULL, NULL, 0, 'clean', ?, ?)`,
        [urn, clean, opts.description ?? null, JSON.stringify(opts.smart), now, now],
      )
      return { urn, name: clean, isSmart: true, ...(opts.description ? { description: opts.description } : {}) }
    }

    await this.db.exec(
      `INSERT INTO playlists
         (urn, name, description, is_smart, track_count, duration_ms,
          revision, sync_state, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, 'clean', ?, ?)`,
      [urn, clean, opts.description ?? null, now, now],
    )
    return { urn, name: clean, trackCount: 0, ...(opts.description ? { description: opts.description } : {}) }
  }

  async update(
    urn: string,
    patch: { name?: string; description?: string | null; artworkUrl?: string | null },
  ): Promise<void> {
    const row = await this.require(urn)
    const name = patch.name === undefined ? row.name : requiredName(patch.name)
    const description = patch.description === undefined ? row.description : patch.description
    let artworkId = row.artwork_id
    if (patch.artworkUrl !== undefined) {
      if (patch.artworkUrl === null || patch.artworkUrl.trim() === '') {
        artworkId = null
      } else {
        artworkId = `aw_${newId('art')}`
        await this.db.exec(
          `INSERT INTO artworks (id, source_url, fetched_at) VALUES (?, ?, ?)`,
          [artworkId, patch.artworkUrl.trim(), Date.now()],
        )
      }
    }
    await this.db.exec(
      `UPDATE playlists
          SET name = ?, description = ?, artwork_id = ?, revision = revision + 1, updated_at = ?
        WHERE urn = ?`,
      [name, description, artworkId, Date.now(), urn],
    )
  }

  async remove(urn: string): Promise<void> {
    const result = await this.db.exec('DELETE FROM playlists WHERE urn = ?', [urn])
    if (result.changes === 0) throw notFound(urn)
  }

  async addTracks(
    urn: string,
    trackUrns: readonly string[],
    opts: { at?: number } = {},
  ): Promise<number> {
    const row = await this.require(urn)
    if (row.is_smart === 1) throw smartRefusal(urn)
    if (trackUrns.length === 0) return 0

    for (const track of trackUrns) {
      const parsed = safeParse(track)
      if (!parsed || parsed.kind !== 'track') {
        throw new LibraryError(`not a track urn: ${JSON.stringify(track)}`, 'invalid-urn')
      }
    }

    const now = Date.now()
    await this.db.transaction(async (tx) => {
      const positions = await tx.query<{ position: string }>(
        'SELECT position FROM playlist_items WHERE playlist_urn = ? ORDER BY position ASC',
        [urn],
      )
      const ordered = positions.map((p) => p.position)
      const at = opts.at === undefined ? ordered.length : Math.max(0, Math.min(ordered.length, opts.at))
      let before = ordered[at - 1]
      const after = ordered[at]

      for (const track of trackUrns) {
        const position = between(before, after)
        await tx.exec(
          `INSERT INTO playlist_items (id, playlist_urn, position, track_urn, added_at)
           VALUES (?, ?, ?, ?, ?)`,
          [newId('pi'), urn, position, track, now],
        )
        before = position
      }
      await this.recount(tx, urn, now)
    })
    return trackUrns.length
  }

  async removeItems(urn: string, itemIds: readonly string[]): Promise<void> {
    await this.require(urn)
    if (itemIds.length === 0) return
    const holes = itemIds.map(() => '?').join(', ')
    const now = Date.now()
    await this.db.transaction(async (tx) => {
      await tx.exec(
        `DELETE FROM playlist_items WHERE playlist_urn = ? AND id IN (${holes})`,
        [urn, ...itemIds],
      )
      await this.recount(tx, urn, now)
    })
  }

  async moveItem(urn: string, itemId: string, toIndex: number): Promise<void> {
    await this.require(urn)
    const rows = await this.db.query<{ id: string; position: string }>(
      'SELECT id, position FROM playlist_items WHERE playlist_urn = ? ORDER BY position ASC',
      [urn],
    )
    const from = rows.findIndex((row) => row.id === itemId)
    if (from === -1) throw new LibraryError(`playlist item ${itemId} is not in ${urn}`, 'not-found')

    const without = rows.filter((_, index) => index !== from)
    const to = Math.max(0, Math.min(without.length, toIndex))
    if (to === from) return

    // The single write the fractional index exists for: one key between the
    // destination's neighbours, and the tail is never touched.
    const position = between(without[to - 1]?.position, without[to]?.position)
    await this.db.exec(
      `UPDATE playlist_items SET position = ? WHERE playlist_urn = ? AND id = ?`,
      [position, urn, itemId],
    )
    await this.touch(urn)
  }

  async setSmartQuery(urn: string, query: SmartPlaylist): Promise<void> {
    await this.require(urn)
    compileSmartQuery(query)
    await this.db.exec(
      `UPDATE playlists
          SET is_smart = 1, smart_query_json = ?, revision = revision + 1, updated_at = ?
        WHERE urn = ?`,
      [JSON.stringify(query), Date.now(), urn],
    )
  }

  /* ── internals ─────────────────────────────────────────────────────── */

  private async require(urn: string): Promise<PlaylistRow> {
    const row = await this.db.get<PlaylistRow>(
      `SELECT ${PLAYLIST_COLUMNS}
         FROM playlists p
         ${PLAYLIST_JOINS}
        WHERE p.urn = ?`,
      [urn],
    )
    if (!row) throw notFound(urn)
    return row
  }

  /** Recompute the derived columns in the same transaction as the rows. */
  private async recount(tx: DbService, urn: string, now: number): Promise<void> {
    await tx.exec(
      `UPDATE playlists
          SET track_count = (SELECT COUNT(*) FROM playlist_items WHERE playlist_urn = ?),
              duration_ms = (SELECT COALESCE(SUM(t.duration_ms), 0)
                               FROM playlist_items pi
                               LEFT JOIN tracks t ON t.urn = pi.track_urn
                              WHERE pi.playlist_urn = ?),
              revision = revision + 1,
              updated_at = ?
        WHERE urn = ?`,
      [urn, urn, now, urn],
    )
  }

  private async touch(urn: string): Promise<void> {
    await this.db.exec(
      'UPDATE playlists SET revision = revision + 1, updated_at = ? WHERE urn = ?',
      [Date.now(), urn],
    )
  }

  private toPlaylist(row: PlaylistRow): Playlist {
    const artwork = artworkOf(row)
    return {
      urn: row.urn,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      ...(artwork ? { artwork } : {}),
      ...(row.owner ? { owner: row.owner } : {}),
      ...(row.is_public === 1 ? { isPublic: true } : {}),
      ...(row.track_count !== null ? { trackCount: row.track_count } : {}),
      ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
      ...(row.is_smart === 1 ? { isSmart: true } : {}),
      ...(row.created_at ? { createdAt: row.created_at } : {}),
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    }
  }
}

function toItem(row: ItemRow): PlaylistItem {
  return {
    id: row.id,
    trackUrn: row.track_urn,
    position: row.position,
    addedAt: row.added_at,
    ...(row.added_by ? { addedBy: row.added_by } : {}),
    ...(row.note ? { note: row.note } : {}),
  }
}

/** A stored tree that no longer parses is a corrupted row, not a rule failure. */
function parseSmart(json: string | null, urn: string): SmartPlaylist {
  if (!json) {
    throw new LibraryError(`smart playlist ${urn} has no rule tree`, 'smart-playlist')
  }
  try {
    return JSON.parse(json) as SmartPlaylist
  } catch (error) {
    throw new LibraryError(`smart playlist ${urn} has an unreadable rule tree`, 'smart-playlist', {
      cause: error,
    })
  }
}

function safeParse(urn: string) {
  try {
    return parseUrn(urn)
  } catch {
    return undefined
  }
}

export function requiredName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new LibraryError('a name is required', 'invalid-name')
  return clean
}

function notFound(urn: string): LibraryError {
  return new LibraryError(`no playlist ${urn}`, 'not-found')
}

function smartRefusal(urn: string): LibraryError {
  return new LibraryError(
    `${urn} is a smart playlist; its tracks come from its rules and cannot be edited directly`,
    'smart-playlist',
  )
}
