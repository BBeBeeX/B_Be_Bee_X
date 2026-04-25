import { and, eq, isNull } from "drizzle-orm"

import { db } from "../db"
import { lyricsTable } from "../schemas"
import type { LyricSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { applyLocalSyncDefaults, conflictUpdateAllExcept } from "./internal/utils"

class LyricServiceStatic implements Resetable {
  async reset() {
    await db.delete(lyricsTable).execute()
  }

  async upsert(input: LyricSchema) {
    const lyric = applyLocalSyncDefaults(input)
    await db
      .insert(lyricsTable)
      .values(lyric)
      .onConflictDoUpdate({
        target: [lyricsTable.trackId, lyricsTable.format],
        set: conflictUpdateAllExcept(lyricsTable, ["id"]),
      })
  }

  async softDelete(id: string) {
    await db
      .update(lyricsTable)
      .set({
        deletedAt: Date.now(),
        dirty: true,
        syncState: "pending",
        updatedAt: Date.now(),
      })
      .where(eq(lyricsTable.id, id))
  }

  getByTrackId(trackId: string, options?: { includeDeleted?: boolean }) {
    return db.query.lyricsTable.findMany({
      where: options?.includeDeleted
        ? eq(lyricsTable.trackId, trackId)
        : and(eq(lyricsTable.trackId, trackId), isNull(lyricsTable.deletedAt)),
    })
  }

  getAll(options?: { includeDeleted?: boolean }) {
    return db.query.lyricsTable.findMany({
      where: options?.includeDeleted ? undefined : isNull(lyricsTable.deletedAt),
    })
  }

  getByTrackFormat(trackId: string, format: LyricSchema["format"], options?: { includeDeleted?: boolean }) {
    return db.query.lyricsTable.findFirst({
      where: options?.includeDeleted
        ? and(eq(lyricsTable.trackId, trackId), eq(lyricsTable.format, format))
        : and(
            eq(lyricsTable.trackId, trackId),
            eq(lyricsTable.format, format),
            isNull(lyricsTable.deletedAt),
          ),
    })
  }

  async delete(id: string) {
    await db.delete(lyricsTable).where(eq(lyricsTable.id, id))
  }

  // Legacy aliases for callers not yet migrated.
  getByAudioId(audioId: string, options?: { includeDeleted?: boolean }) {
    return this.getByTrackId(audioId, options)
  }
}

export const LyricService = new LyricServiceStatic()
