import { asc, eq, inArray } from "drizzle-orm"

import { db } from "../db"
import { localFilesTable, localFileTrackLinksTable } from "../schemas"
import type { LocalFileSchema, LocalFileTrackLinkSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

class LocalFileServiceStatic implements Resetable {
  async reset() {
    await db.delete(localFileTrackLinksTable).execute()
    await db.delete(localFilesTable).execute()
  }

  async upsert(file: LocalFileSchema) {
    await db
      .insert(localFilesTable)
      .values(file)
      .onConflictDoUpdate({
        target: [localFilesTable.id],
        set: conflictUpdateAllExcept(localFilesTable, ["id"]),
      })
  }

  async linkTrack(link: LocalFileTrackLinkSchema) {
    await db
      .insert(localFileTrackLinksTable)
      .values(link)
      .onConflictDoNothing()
  }

  getAll() {
    return db.query.localFilesTable.findMany({
      orderBy: [asc(localFilesTable.path)],
    })
  }

  async getByTrackId(trackId: string) {
    const links = await db.query.localFileTrackLinksTable.findMany({
      where: eq(localFileTrackLinksTable.trackId, trackId),
    })
    const localFileIds = links.map((link) => link.localFileId)
    if (localFileIds.length === 0) return []

    return db.query.localFilesTable.findMany({
      where: inArray(localFilesTable.id, localFileIds),
      orderBy: [asc(localFilesTable.path)],
    })
  }

  async delete(id: string) {
    await db.delete(localFileTrackLinksTable).where(eq(localFileTrackLinksTable.localFileId, id))
    await db.delete(localFilesTable).where(eq(localFilesTable.id, id))
  }
}

export const LocalFileService = new LocalFileServiceStatic()
