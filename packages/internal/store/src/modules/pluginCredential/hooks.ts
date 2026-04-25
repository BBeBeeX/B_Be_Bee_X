import { useCallback } from "react"

import { type PluginCredentialStore, usePluginCredentialsStore } from "./store"

export const usePluginCredential = (pluginId?: string | null) => {
  return usePluginCredentialsStore(
    useCallback(
      (state: PluginCredentialStore) => {
        if (!pluginId) {
          return
        }
        return state.credentials[pluginId]
      },
      [pluginId],
    ),
  )
}
