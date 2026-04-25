import type { PluginSession } from "@b_be_bee/models"
import { eq } from "drizzle-orm"

import { db } from "../db"
import { pluginSessionsTable } from "../schemas"
import type { PluginSessionSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { applyLocalSyncDefaults, conflictUpdateAllExcept } from "./internal/utils"

const toRow = (session: PluginSession): PluginSessionSchema => {
  const base: PluginSessionSchema = {
    pluginId: session.pluginId,
    activeAccountId: session.credentials?.userId ?? null,
    isLoggedIn: session.isLoggedIn,
    state: {
      activeAccountId: session.credentials?.userId ?? null,
      label: session.user?.name ?? session.credentials?.username ?? null,
      avatar: session.user?.avatar ?? null,
      raw: undefined,
      user: session.user ?? null,
    },
    updatedAt: session.updatedAt,
    dirty: false,
    lastSyncedAt: null,
    syncState: "local_only",
  }

  return applyLocalSyncDefaults(base)
}

const toModel = (row: PluginSessionSchema): PluginSession => ({
  pluginId: row.pluginId,
  isLoggedIn: row.isLoggedIn ?? false,
  updatedAt: row.updatedAt,
  user: row.state?.user ?? null,
})

class PluginSessionServiceStatic implements Resetable {
  async reset() {
    await db.delete(pluginSessionsTable).execute()
  }

  async upsert(session: PluginSession) {
    await db
      .insert(pluginSessionsTable)
      .values(toRow(session))
      .onConflictDoUpdate({
        target: [pluginSessionsTable.pluginId],
        set: conflictUpdateAllExcept(pluginSessionsTable, ["pluginId"]),
      })
  }

  async getByPluginId(pluginId: string) {
    const row = await db.query.pluginSessionsTable.findFirst({
      where: eq(pluginSessionsTable.pluginId, pluginId),
    })
    return row ? toModel(row) : undefined
  }

  async getAll() {
    const rows = await db.query.pluginSessionsTable.findMany()
    return rows.map(toModel)
  }

  async deleteByPluginId(pluginId: string) {
    await db.delete(pluginSessionsTable).where(eq(pluginSessionsTable.pluginId, pluginId))
  }
}

export const PluginSessionService = new PluginSessionServiceStatic()
