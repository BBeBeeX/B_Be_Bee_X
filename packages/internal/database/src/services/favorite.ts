import { eq, inArray } from "drizzle-orm"

import { db } from "../db"
import { musicFavoritesTable } from "../schemas"
import type { FavoriteSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

class FavoriteServiceStatic implements Resetable {
  async reset() {
    await db.delete(musicFavoritesTable).execute()
  }

  async add(favorite: FavoriteSchema) {
    await db
      .insert(musicFavoritesTable)
      .values(favorite)
      .onConflictDoUpdate({
        target: [musicFavoritesTable.audioId],
        set: conflictUpdateAllExcept(musicFavoritesTable, ["audioId"]),
      })
  }

  async remove(audioId: string) {
    await db.delete(musicFavoritesTable).where(eq(musicFavoritesTable.audioId, audioId))
  }

  getAll() {
    return db.query.musicFavoritesTable.findMany()
  }

  getMany(audioIds: string[]) {
    if (audioIds.length === 0) return Promise.resolve([])
    return db.query.musicFavoritesTable.findMany({
      where: inArray(musicFavoritesTable.audioId, audioIds),
    })
  }

  async has(audioId: string) {
    const favorite = await db.query.musicFavoritesTable.findFirst({
      where: eq(musicFavoritesTable.audioId, audioId),
    })
    return Boolean(favorite)
  }
}

export const FavoriteService = new FavoriteServiceStatic()
