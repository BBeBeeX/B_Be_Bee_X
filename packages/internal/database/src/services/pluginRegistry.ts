import { eq } from "drizzle-orm"

import { db } from "../db"
import { pluginRegistryTable, type InstalledPluginMetadata } from "../schemas"
import type { PluginRegistrySchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

const toRow = (metadata: InstalledPluginMetadata): PluginRegistrySchema => ({
  codeAssetId: metadata.codeAssetId,
  checksum: metadata.checksum,
  executionModel: metadata.manifest.executionModel,
  id: metadata.id,
  installedAt: metadata.installedAt,
  lastError: metadata.lastError || null,
  manifest: metadata.manifest,
  pluginType: metadata.manifest.type,
  signature: metadata.signature,
  signatureStatus: metadata.signatureStatus,
  sourceKind: metadata.sourceKind,
  state: metadata.state,
  updatedAt: metadata.updatedAt,
})

const toMetadata = (row: PluginRegistrySchema): InstalledPluginMetadata => ({
  checksum: row.checksum,
  codeAssetId: row.codeAssetId,
  id: row.id,
  installedAt: row.installedAt,
  lastError: row.lastError || null,
  manifest: row.manifest,
  signature: row.signature,
  signatureStatus: row.signatureStatus,
  sourceKind: row.sourceKind,
  state: row.state,
  updatedAt: row.updatedAt,
})

class PluginRegistryServiceStatic implements Resetable {
  async reset() {
    await db.delete(pluginRegistryTable).execute()
  }

  async upsert(metadata: InstalledPluginMetadata) {
    await db
      .insert(pluginRegistryTable)
      .values(toRow(metadata))
      .onConflictDoUpdate({
        target: [pluginRegistryTable.id],
        set: conflictUpdateAllExcept(pluginRegistryTable, ["id"]),
      })
  }

  async get(pluginId: string) {
    const row = await db.query.pluginRegistryTable.findFirst({
      where: eq(pluginRegistryTable.id, pluginId),
    })
    return row ? toMetadata(row) : undefined
  }

  async list() {
    const rows = await db.query.pluginRegistryTable.findMany()
    return rows.map(toMetadata)
  }

  async listEnabledForStartup() {
    const rows = await db.query.pluginRegistryTable.findMany({
      where: eq(pluginRegistryTable.state, "enabled"),
    })
    return rows.map(toMetadata)
  }

  async setState(pluginId: string, state: InstalledPluginMetadata["state"]) {
    await db
      .update(pluginRegistryTable)
      .set({
        state,
        updatedAt: Date.now(),
      })
      .where(eq(pluginRegistryTable.id, pluginId))
  }

  async recordError(pluginId: string, lastError: NonNullable<InstalledPluginMetadata["lastError"]>) {
    await db
      .update(pluginRegistryTable)
      .set({
        lastError,
        state: "error",
        updatedAt: Date.now(),
      })
      .where(eq(pluginRegistryTable.id, pluginId))
  }

  async delete(pluginId: string) {
    await db.delete(pluginRegistryTable).where(eq(pluginRegistryTable.id, pluginId))
  }
}

export const PluginRegistryService = new PluginRegistryServiceStatic()
