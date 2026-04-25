import { and, eq, gt } from "drizzle-orm"

import { db } from "../db"
import { playSourceCachesTable, playSourceCacheStatusesTable } from "../schemas"
import type { PlaySourceCacheSchema, PlaySourceCacheStatusSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

class PlaySourceCacheServiceStatic implements Resetable {
  async reset() {
    await db.delete(playSourceCacheStatusesTable).execute()
    await db.delete(playSourceCachesTable).execute()
  }

  async upsertPayload(entry: PlaySourceCacheSchema) {
    await db
      .insert(playSourceCachesTable)
      .values(entry)
      .onConflictDoUpdate({
        target: [playSourceCachesTable.cacheKey],
        set: conflictUpdateAllExcept(playSourceCachesTable, ["cacheKey"]),
      })
  }

  async upsertStatus(status: PlaySourceCacheStatusSchema) {
    await db
      .insert(playSourceCacheStatusesTable)
      .values(status)
      .onConflictDoUpdate({
        target: [playSourceCacheStatusesTable.cacheKey],
        set: conflictUpdateAllExcept(playSourceCacheStatusesTable, ["cacheKey"]),
      })
  }

  getPayloadWithStatus(cacheKey: string) {
    return db
      .select()
      .from(playSourceCachesTable)
      .innerJoin(
        playSourceCacheStatusesTable,
        eq(playSourceCachesTable.cacheKey, playSourceCacheStatusesTable.cacheKey),
      )
      .where(eq(playSourceCachesTable.cacheKey, cacheKey))
  }

  getValidPayloadWithStatus(cacheKey: string) {
    return db
      .select()
      .from(playSourceCachesTable)
      .innerJoin(
        playSourceCacheStatusesTable,
        eq(playSourceCachesTable.cacheKey, playSourceCacheStatusesTable.cacheKey),
      )
      .where(
        and(
          eq(playSourceCachesTable.cacheKey, cacheKey),
          eq(playSourceCacheStatusesTable.status, "valid"),
          gt(playSourceCacheStatusesTable.expiresAt, Date.now()),
        ),
      )
  }
}

export const PlaySourceCacheService = new PlaySourceCacheServiceStatic()
