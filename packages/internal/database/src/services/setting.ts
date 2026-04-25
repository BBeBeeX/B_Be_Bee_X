import { and, eq } from "drizzle-orm"

import { db } from "../db"
import { settingsTable } from "../schemas"
import type { SettingSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { applyLocalSyncDefaults, conflictUpdateAllExcept } from "./internal/utils"

class SettingServiceStatic implements Resetable {
  async reset() {
    await db.delete(settingsTable).execute()
  }

  async upsert(setting: SettingSchema) {
    const row = applyLocalSyncDefaults(setting)
    await db
      .insert(settingsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [settingsTable.namespace, settingsTable.key],
        set: conflictUpdateAllExcept(settingsTable, ["namespace", "key"]),
      })
  }

  get(namespace: string, key: string) {
    return db.query.settingsTable.findFirst({
      where: and(eq(settingsTable.namespace, namespace), eq(settingsTable.key, key)),
    })
  }

  getAllByNamespace(namespace: string) {
    return db.query.settingsTable.findMany({
      where: eq(settingsTable.namespace, namespace),
    })
  }
}

export const SettingService = new SettingServiceStatic()
