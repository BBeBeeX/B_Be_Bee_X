/**
 * Everything the player keeps in SQL.
 *
 * Split out because the transport is hard enough to read without SQL in the
 * middle of it, and because the persistence rules are their own contract:
 * `queue_items` and `playback_state` are what "the queue survives a restart"
 * actually means (docs/07 §4.7).
 */

import type { DbService, PlayRecord, QueueItem, RepeatMode, SqlValue } from '@BBeBee/protocol'
import type { QueueEntry } from './queue.js'

export interface PersistedState {
  currentItemId?: string
  positionMs: number
  repeat: RepeatMode
  shuffle: boolean
  shuffleSeed: number
  volume: number
  muted: boolean
}

export interface NowPlayingMeta {
  title: string
  artist?: string
  album?: string
  artworkUri?: string
}

interface QueueRow {
  id: string
  position: string
  track_urn: string
  source_context_json: string | null
  added_by: string
  added_at: number
}

export class PlayerStore {
  constructor(
    private readonly db: DbService,
    private readonly deviceId: string,
  ) {}

  /* ── the queue ─────────────────────────────────────────────────────── */

  async loadQueue(): Promise<QueueEntry[]> {
    const rows = await this.db.query<QueueRow>(
      `SELECT id, position, track_urn, source_context_json, added_by, added_at
         FROM queue_items ORDER BY position ASC`,
    )
    return rows.map((row) => ({
      position: row.position,
      item: {
        id: row.id,
        trackUrn: row.track_urn,
        addedBy: row.added_by as QueueItem['addedBy'],
        addedAt: row.added_at,
        ...(row.source_context_json
          ? { sourceContext: JSON.parse(row.source_context_json) as QueueItem['sourceContext'] }
          : {}),
      },
    }))
  }

  /**
   * Replace the queue.
   *
   * `playback_state.current_item_id` has `ON DELETE SET NULL`, so clearing the
   * rows also clears the pointer — which is why the caller saves state after
   * this, never before.
   */
  async replaceQueue(entries: readonly QueueEntry[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.exec('DELETE FROM queue_items')
      for (const entry of entries) await insertEntry(tx, entry)
    })
  }

  async insertQueue(entries: readonly QueueEntry[]): Promise<void> {
    if (entries.length === 0) return
    await this.db.transaction(async (tx) => {
      for (const entry of entries) await insertEntry(tx, entry)
    })
  }

  async removeQueue(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.transaction(async (tx) => {
      for (const id of ids) await tx.exec('DELETE FROM queue_items WHERE id = ?', [id])
    })
  }

  /** One row — the point of a fractional index (docs/07 §4.6). */
  async moveQueueItem(entry: QueueEntry): Promise<void> {
    await this.db.exec('UPDATE queue_items SET position = ? WHERE id = ?', [
      entry.position,
      entry.item.id,
    ])
  }

  /* ── transport state ───────────────────────────────────────────────── */

  async loadState(): Promise<PersistedState | undefined> {
    const row = await this.db.get<{
      current_item_id: string | null
      position_ms: number
      repeat_mode: string
      shuffle: number
      shuffle_seed: number | null
      volume: number
      muted: number
    }>('SELECT * FROM playback_state WHERE id = 1')
    if (!row) return undefined

    return {
      ...(row.current_item_id ? { currentItemId: row.current_item_id } : {}),
      positionMs: row.position_ms,
      repeat: row.repeat_mode as RepeatMode,
      shuffle: row.shuffle === 1,
      shuffleSeed: row.shuffle_seed ?? 1,
      volume: row.volume,
      muted: row.muted === 1,
    }
  }

  async saveState(state: PersistedState): Promise<void> {
    await this.db.exec(
      `INSERT INTO playback_state
         (id, current_item_id, position_ms, repeat_mode, shuffle, shuffle_seed,
          volume, muted, device_id, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         current_item_id = excluded.current_item_id,
         position_ms     = excluded.position_ms,
         repeat_mode     = excluded.repeat_mode,
         shuffle         = excluded.shuffle,
         shuffle_seed    = excluded.shuffle_seed,
         volume          = excluded.volume,
         muted           = excluded.muted,
         device_id       = excluded.device_id,
         updated_at      = excluded.updated_at`,
      [
        state.currentItemId ?? null,
        Math.round(state.positionMs),
        state.repeat,
        state.shuffle ? 1 : 0,
        state.shuffleSeed,
        state.volume,
        state.muted ? 1 : 0,
        this.deviceId,
        Date.now(),
      ],
    )
  }

  /* ── history ───────────────────────────────────────────────────────── */

  /**
   * Append the play and update the derived stats in one transaction.
   *
   * `play_history` is the truth and `track_stats` is a cache of it; writing
   * them together is what keeps "most played" a single indexed read that can
   * never disagree with the record it came from (docs/07 §4.7).
   */
  async recordPlay(record: PlayRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO play_history
           (id, track_urn, started_at, ended_at, ms_played, completed, skipped,
            source_json, device_id, scrobble_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          record.id,
          record.trackUrn,
          record.startedAt,
          record.endedAt ?? null,
          Math.round(record.msPlayed),
          record.completed ? 1 : 0,
          record.skipped ? 1 : 0,
          record.source ? JSON.stringify(record.source) : null,
          record.deviceId ?? this.deviceId,
        ],
      )
      await tx.exec(
        `INSERT INTO track_stats (urn, play_count, skip_count, last_played_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(urn) DO UPDATE SET
           play_count     = play_count + excluded.play_count,
           skip_count     = skip_count + excluded.skip_count,
           last_played_at = excluded.last_played_at`,
        [
          record.trackUrn,
          record.completed ? 1 : 0,
          record.skipped ? 1 : 0,
          record.endedAt ?? record.startedAt,
        ],
      )
    })
  }

  /** A track the provider says is gone: greyed out in lists, not hidden. */
  async markUnavailable(urn: string): Promise<void> {
    await this.db.exec('UPDATE tracks SET available = 0 WHERE urn = ?', [urn])
  }

  /* ── now playing ───────────────────────────────────────────────────── */

  async nowPlaying(urn: string): Promise<NowPlayingMeta | undefined> {
    const row = await this.db.get<{
      title: string
      album: string | null
      artwork_uri: string | null
      artist: string | null
    }>(
      `SELECT t.title,
              al.title AS album,
              aw.local_uri AS artwork_uri,
              (SELECT a.name FROM track_artists ta JOIN artists a ON a.urn = ta.artist_urn
                WHERE ta.track_urn = t.urn ORDER BY ta.ordinal ASC LIMIT 1) AS artist
         FROM tracks t
         LEFT JOIN albums al ON al.urn = t.album_urn
         LEFT JOIN artworks aw ON aw.id = t.artwork_id
        WHERE t.urn = ?`,
      [urn],
    )
    if (!row) return undefined
    return {
      title: row.title,
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.album ? { album: row.album } : {}),
      // Must be a local Uri on mobile, so a remote-only artwork is omitted
      // rather than handed over to fail silently (docs/04 §7).
      ...(row.artwork_uri ? { artworkUri: row.artwork_uri } : {}),
    }
  }
}

async function insertEntry(
  tx: { exec(sql: string, params?: SqlValue[]): Promise<unknown> },
  entry: QueueEntry,
): Promise<void> {
  await tx.exec(
    `INSERT INTO queue_items (id, position, track_urn, source_context_json, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.item.id,
      entry.position,
      entry.item.trackUrn,
      entry.item.sourceContext ? JSON.stringify(entry.item.sourceContext) : null,
      entry.item.addedBy,
      entry.item.addedAt ?? Date.now(),
    ],
  )
}
