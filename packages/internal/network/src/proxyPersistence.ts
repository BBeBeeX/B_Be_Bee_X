import { ProxySettingsService } from "@b_be_bee/database/services/proxySettings"

import type { ProxySettings } from "./types"
import type { ProxySettingsState } from "./proxy"
import { assertPersistableProxySettings, emptyProxySettingsState } from "./proxy"

let proxySettingsState: ProxySettingsState = emptyProxySettingsState()
let hydrationPromise: Promise<ProxySettingsState> | undefined

export const getProxySettingsState = () => proxySettingsState

export const hydrateProxySettings = async () => {
  hydrationPromise =
    hydrationPromise ||
    Promise.all([ProxySettingsService.getGlobal(), ProxySettingsService.getAllPlugins()]).then(
      ([globalSettings, pluginRows]) => {
        proxySettingsState = {
          global: globalSettings,
          plugins: Object.fromEntries(pluginRows.map((row) => [row.pluginId, row.settings])),
        }
        return proxySettingsState
      },
    )
  return hydrationPromise
}

export const ensureProxySettingsHydrated = async () => {
  return hydrateProxySettings()
}

export const setGlobalProxySettings = async (settings: ProxySettings) => {
  assertPersistableProxySettings(settings)
  await ProxySettingsService.saveGlobal(settings)
  proxySettingsState = {
    ...proxySettingsState,
    global: settings,
  }
}

export const deleteGlobalProxySettings = async () => {
  await ProxySettingsService.deleteGlobal()
  proxySettingsState = {
    ...proxySettingsState,
    global: undefined,
  }
}

export const setPluginProxySettings = async (pluginId: string, settings: ProxySettings) => {
  assertPersistableProxySettings(settings)
  await ProxySettingsService.savePlugin(pluginId, settings)
  proxySettingsState = {
    ...proxySettingsState,
    plugins: {
      ...proxySettingsState.plugins,
      [pluginId]: settings,
    },
  }
}

export const deletePluginProxySettings = async (pluginId: string) => {
  await ProxySettingsService.deletePlugin(pluginId)
  const { [pluginId]: _deleted, ...plugins } = proxySettingsState.plugins
  proxySettingsState = {
    ...proxySettingsState,
    plugins,
  }
}

export const resetProxySettingsStateForTests = () => {
  hydrationPromise = undefined
  proxySettingsState = emptyProxySettingsState()
}
