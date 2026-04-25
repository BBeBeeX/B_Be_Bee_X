import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { db } from "../db"
import { tracksTable } from "../schemas"
import type { TrackSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { applyLocalSyncDefaults, conflictUpdateAllExcept, escapeSqlString } from "./internal/utils"

const ftsPayload = (track: TrackSchema) => ({
  album: track.album ? JSON.stringify(track.album) : "",
  artists: track.artists ? JSON.stringify(track.artists) : "",
  creator: track.creator ? JSON.stringify(track.creator) : "",
  tags: track.tags ? JSON.stringify(track.tags) : "",
  title: track.title,
  trackId: track.id,
})

async function upsertTrackFts(track: TrackSchema) {
  const payload = ftsPayload(track)
  await db.run(sql.raw(`
    INSERT INTO music_tracks_fts (track_id, title, artists, album, creator, tags)
    VALUES (
      '${escapeSqlString(payload.trackId)}',
      '${escapeSqlString(payload.title)}',
      '${escapeSqlString(payload.artists)}',
      '${escapeSqlString(payload.album)}',
      '${escapeSqlString(payload.creator)}',
      '${escapeSqlString(payload.tags)}'
    )
    ON CONFLICT(track_id) DO UPDATE SET
      title = excluded.title,
      artists = excluded.artists,
      album = excluded.album,
      creator = excluded.creator,
      tags = excluded.tags
  `))
}

async function deleteTrackFts(trackId: string) {
  await db.run(sql.raw(`DELETE FROM music_tracks_fts WHERE track_id = '${escapeSqlString(trackId)}'`))
}

class TrackServiceStatic implements Resetable {
  async reset() {
    await db.delete(tracksTable).execute()
    await db.run(sql.raw("DELETE FROM music_tracks_fts"))
  }

  async upsertMany(tracks: TrackSchema[]) {
    if (tracks.length === 0) return

    for (const input of tracks) {
      const track = applyLocalSyncDefaults(input)

      await db
        .insert(tracksTable)
        .values(track)
        .onConflictDoUpdate({
          target: [tracksTable.source, tracksTable.sourceId, tracksTable.sourceSubId],
          set: conflictUpdateAllExcept(tracksTable, ["id"]),
        })

      if (track.deletedAt) {
        await deleteTrackFts(track.id)
      } else {
        await upsertTrackFts(track)
      }
    }
  }

  async upsert(track: TrackSchema) {
    await this.upsertMany([track])
  }

  async softDelete(trackId: string) {
    await db
      .update(tracksTable)
      .set({
        deletedAt: Date.now(),
        dirty: true,
        syncState: "pending",
        updatedAt: Date.now(),
      })
      .where(eq(tracksTable.id, trackId))

    await deleteTrackFts(trackId)
  }

  async restore(trackId: string) {
    const track = await db.query.tracksTable.findFirst({ where: eq(tracksTable.id, trackId) })
    if (!track) return

    const restored: TrackSchema = {
      ...track,
      deletedAt: null,
      dirty: true,
      syncState: "pending",
      updatedAt: Date.now(),
    }

    await db
      .update(tracksTable)
      .set(restored)
      .where(eq(tracksTable.id, trackId))

    await upsertTrackFts(restored)
  }

  async delete(trackId: string) {
    await db.delete(tracksTable).where(eq(tracksTable.id, trackId))
    await deleteTrackFts(trackId)
  }

  getById(trackId: string, options?: { includeDeleted?: boolean }) {
    return db.query.tracksTable.findFirst({
      where: options?.includeDeleted
        ? eq(tracksTable.id, trackId)
        : and(eq(tracksTable.id, trackId), isNull(tracksTable.deletedAt)),
    })
  }

  getManyByIds(trackIds: string[], options?: { includeDeleted?: boolean }) {
    if (trackIds.length === 0) return Promise.resolve([])
    return db.query.tracksTable.findMany({
      where: options?.includeDeleted
        ? inArray(tracksTable.id, trackIds)
        : and(inArray(tracksTable.id, trackIds), isNull(tracksTable.deletedAt)),
    })
  }

  getAll(options?: { includeDeleted?: boolean }) {
    return db.query.tracksTable.findMany({
      where: options?.includeDeleted ? undefined : isNull(tracksTable.deletedAt),
    })
  }
}

export const TrackService = new TrackServiceStatic()
