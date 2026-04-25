import { and, eq } from "drizzle-orm"

import { db } from "../db"
import { pluginAccountsTable } from "../schemas"
import type { PluginAccountSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { applyLocalSyncDefaults, conflictUpdateAllExcept } from "./internal/utils"

class PluginAccountServiceStatic implements Resetable {
  async reset() {
    await db.delete(pluginAccountsTable).execute()
  }

  async upsert(account: PluginAccountSchema) {
    const row = applyLocalSyncDefaults(account)
    await db
      .insert(pluginAccountsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [pluginAccountsTable.pluginId, pluginAccountsTable.accountId],
        set: conflictUpdateAllExcept(pluginAccountsTable, ["id"]),
      })
  }

  getAllByPluginId(pluginId: string) {
    return db.query.pluginAccountsTable.findMany({
      where: eq(pluginAccountsTable.pluginId, pluginId),
    })
  }

  getDefaultByPluginId(pluginId: string) {
    return db.query.pluginAccountsTable.findFirst({
      where: and(eq(pluginAccountsTable.pluginId, pluginId), eq(pluginAccountsTable.isDefault, true)),
    })
  }

  async delete(id: string) {
    await db.delete(pluginAccountsTable).where(eq(pluginAccountsTable.id, id))
  }
}

export const PluginAccountService = new PluginAccountServiceStatic()
