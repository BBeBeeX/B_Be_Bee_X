import type { PluginSessionCredentials } from "@b_be_bee/models"
import { and, eq, isNull } from "drizzle-orm"

import { db } from "../db"
import { pluginCredentialsTable } from "../schemas"
import type { PluginCredentialSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"
import {
  decryptPluginCredentialPayload,
  encryptPluginCredentialPayload,
  setPluginCredentialEncryptionSecret,
} from "./pluginCredentialEncryption"

function credentialRowId(pluginId: string, accountId?: string | null) {
  return accountId ? `${pluginId}:${accountId}` : pluginId
}

class PluginCredentialServiceStatic implements Resetable {
  async reset() {
    await db.delete(pluginCredentialsTable).execute()
  }

  async upsert(pluginId: string, credentials: PluginSessionCredentials, accountId?: string | null) {
    const encryptedPayload = await encryptPluginCredentialPayload<PluginSessionCredentials>(credentials)
    const row: PluginCredentialSchema = {
      id: credentialRowId(pluginId, accountId),
      pluginId,
      accountId: accountId ?? null,
      encryptedPayload,
      updatedAt: Date.now(),
    }

    await db
      .insert(pluginCredentialsTable)
      .values(row)
      .onConflictDoUpdate({
        target: [pluginCredentialsTable.id],
        set: conflictUpdateAllExcept(pluginCredentialsTable, ["id"]),
      })
  }

  async getByPluginId(pluginId: string) {
    const row = await db.query.pluginCredentialsTable.findFirst({
      where: and(eq(pluginCredentialsTable.pluginId, pluginId), isNull(pluginCredentialsTable.accountId)),
    })
    if (!row) return undefined

    return decryptPluginCredentialPayload<PluginSessionCredentials>(row.encryptedPayload)
  }

  async getByAccount(pluginId: string, accountId: string) {
    const row = await db.query.pluginCredentialsTable.findFirst({
      where: and(
        eq(pluginCredentialsTable.pluginId, pluginId),
        eq(pluginCredentialsTable.accountId, accountId),
      ),
    })
    if (!row) return undefined

    return decryptPluginCredentialPayload<PluginSessionCredentials>(row.encryptedPayload)
  }

  async getAll() {
    const rows = await db.query.pluginCredentialsTable.findMany()
    const entries = await Promise.all(
      rows.map(async (row): Promise<[string, PluginSessionCredentials]> => [
        row.accountId ? `${row.pluginId}:${row.accountId}` : row.pluginId,
        await decryptPluginCredentialPayload<PluginSessionCredentials>(row.encryptedPayload),
      ]),
    )

    return entries
  }

  async deleteByPluginId(pluginId: string) {
    await db.delete(pluginCredentialsTable).where(eq(pluginCredentialsTable.pluginId, pluginId))
  }

  async deleteByAccount(pluginId: string, accountId: string) {
    await db
      .delete(pluginCredentialsTable)
      .where(
        and(eq(pluginCredentialsTable.pluginId, pluginId), eq(pluginCredentialsTable.accountId, accountId)),
      )
  }
}

export { setPluginCredentialEncryptionSecret }
export const PluginCredentialService = new PluginCredentialServiceStatic()
