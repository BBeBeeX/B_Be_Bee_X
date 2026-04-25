import type { PluginSessionCredentials } from "@b_be_bee/models"
import { PluginCredentialService } from "@b_be_bee/database/services/pluginCredential"

import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"

export type PluginCredentialModel = PluginSessionCredentials

export type PluginCredentialStore = {
  credentials: Record<string, PluginCredentialModel>
  pluginIds: string[]
}

const defaultState: PluginCredentialStore = {
  credentials: {},
  pluginIds: [],
}

export const usePluginCredentialsStore = createZustandStore<PluginCredentialStore>(
  "pluginCredentials",
)(() => defaultState)

const set = usePluginCredentialsStore.setState
const immerSet = createImmerSetter(usePluginCredentialsStore)

class PluginCredentialActions implements Hydratable, Resetable {
  async hydrate() {
    const entries = await PluginCredentialService.getAll()
    pluginCredentialActions.upsertEntriesInSession(entries)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => PluginCredentialService.reset())
    await tx.run()
  }

  upsertEntriesInSession(entries: [string, PluginCredentialModel][]) {
    immerSet((state) => {
      for (const [pluginId, credentials] of entries) {
        if (!state.credentials[pluginId]) {
          state.pluginIds.push(pluginId)
        }
        state.credentials[pluginId] = credentials
      }
    })
  }

  async upsert(pluginId: string, credentials: PluginCredentialModel) {
    const tx = createTransaction()
    tx.store(() => this.upsertEntriesInSession([[pluginId, credentials]]))
    tx.persist(() => PluginCredentialService.upsert(pluginId, credentials))
    await tx.run()
  }

  deleteByPluginIdInSession(pluginId: string) {
    immerSet((state) => {
      delete state.credentials[pluginId]
      state.pluginIds = state.pluginIds.filter((id) => id !== pluginId)
    })
  }

  async deleteByPluginId(pluginId: string) {
    const tx = createTransaction()
    tx.store(() => this.deleteByPluginIdInSession(pluginId))
    tx.persist(() => PluginCredentialService.deleteByPluginId(pluginId))
    await tx.run()
  }
}

export const pluginCredentialActions = new PluginCredentialActions()
