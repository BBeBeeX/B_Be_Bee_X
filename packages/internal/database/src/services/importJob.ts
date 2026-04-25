import { desc, eq } from "drizzle-orm"

import { db } from "../db"
import { importJobsTable } from "../schemas"
import type { ImportJobSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

class ImportJobServiceStatic implements Resetable {
  async reset() {
    await db.delete(importJobsTable).execute()
  }

  async upsert(job: ImportJobSchema) {
    await db
      .insert(importJobsTable)
      .values(job)
      .onConflictDoUpdate({
        target: [importJobsTable.id],
        set: conflictUpdateAllExcept(importJobsTable, ["id"]),
      })
  }

  getById(id: string) {
    return db.query.importJobsTable.findFirst({ where: eq(importJobsTable.id, id) })
  }

  getAll() {
    return db.query.importJobsTable.findMany({
      orderBy: [desc(importJobsTable.updatedAt)],
    })
  }

  async delete(id: string) {
    await db.delete(importJobsTable).where(eq(importJobsTable.id, id))
  }
}

export const ImportJobService = new ImportJobServiceStatic()
