import { eq } from "drizzle-orm"

import { db } from "../db"
import {
  networkGlobalProxySettingsTable,
  networkPluginProxySettingsTable,
  type PersistedProxySettings,
} from "../schemas"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

const GLOBAL_PROXY_SETTINGS_ID = "global"

class ProxySettingsServiceStatic implements Resetable {
  async reset() {
    await db.delete(networkPluginProxySettingsTable).execute()
    await db.delete(networkGlobalProxySettingsTable).execute()
  }

  async getGlobal() {
    const row = await db.query.networkGlobalProxySettingsTable.findFirst({
      where: eq(networkGlobalProxySettingsTable.id, GLOBAL_PROXY_SETTINGS_ID),
    })
    return row?.settings
  }

  async saveGlobal(settings: PersistedProxySettings) {
    await db
      .insert(networkGlobalProxySettingsTable)
      .values({
        id: GLOBAL_PROXY_SETTINGS_ID,
        settings,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [networkGlobalProxySettingsTable.id],
        set: conflictUpdateAllExcept(networkGlobalProxySettingsTable, ["id"]),
      })
  }

  async deleteGlobal() {
    await db
      .delete(networkGlobalProxySettingsTable)
      .where(eq(networkGlobalProxySettingsTable.id, GLOBAL_PROXY_SETTINGS_ID))
  }

  async getPlugin(pluginId: string) {
    const row = await db.query.networkPluginProxySettingsTable.findFirst({
      where: eq(networkPluginProxySettingsTable.pluginId, pluginId),
    })
    return row?.settings
  }

  async getAllPlugins() {
    return db.query.networkPluginProxySettingsTable.findMany()
  }

  async savePlugin(pluginId: string, settings: PersistedProxySettings) {
    await db
      .insert(networkPluginProxySettingsTable)
      .values({
        pluginId,
        settings,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [networkPluginProxySettingsTable.pluginId],
        set: conflictUpdateAllExcept(networkPluginProxySettingsTable, ["pluginId"]),
      })
  }

  async deletePlugin(pluginId: string) {
    await db
      .delete(networkPluginProxySettingsTable)
      .where(eq(networkPluginProxySettingsTable.pluginId, pluginId))
  }
}

export const ProxySettingsService = new ProxySettingsServiceStatic()
