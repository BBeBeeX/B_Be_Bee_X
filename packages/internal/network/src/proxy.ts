import { NetworkError } from "./errors"
import type { NetworkRequestContext, PluginNetworkPolicy, ProxyPreference, ProxySettings } from "./types"

export interface ProxySettingsState {
  global?: ProxySettings
  plugins: Record<string, ProxySettings>
}

export interface ProxyResolutionInput {
  context: NetworkRequestContext
  preference?: ProxyPreference
  policy?: PluginNetworkPolicy
  state: ProxySettingsState
}

export interface ProxyResolution {
  settings?: ProxySettings
  usesProxy: boolean
}

export const emptyProxySettingsState = (): ProxySettingsState => ({
  plugins: {},
})

export const assertPersistableProxySettings = (settings: ProxySettings) => {
  if (!settings.host.trim()) {
    throw new NetworkError("policy", "Proxy host is required.")
  }
  if (!Number.isInteger(settings.port) || settings.port <= 0 || settings.port > 65535) {
    throw new NetworkError("policy", "Proxy port must be between 1 and 65535.")
  }
}

export const resolveProxy = (input: ProxyResolutionInput): ProxyResolution => {
  const preference = input.preference || "inherit"
  const pluginId = input.context.pluginId
  const pluginSettings = pluginId ? input.state.plugins[pluginId] : undefined
  const inheritedSettings = pluginSettings || input.state.global
  const requireProxy = Boolean(input.policy?.requireProxy || pluginSettings?.requireProxy)

  if (preference === "direct") {
    if (requireProxy || input.policy?.allowDirect === false) {
      throw new NetworkError("policy", "Direct requests are blocked by proxy policy.", {
        pluginId,
      })
    }
    return {
      usesProxy: false,
    }
  }

  if (preference === "force" && !inheritedSettings?.enabled) {
    throw new NetworkError("policy", "Proxy was required but no enabled proxy is configured.", {
      pluginId,
    })
  }

  if (!inheritedSettings?.enabled) {
    if (requireProxy) {
      throw new NetworkError("policy", "Proxy routing is required but no proxy is enabled.", {
        pluginId,
      })
    }
    return {
      usesProxy: false,
    }
  }

  return {
    settings: inheritedSettings,
    usesProxy: true,
  }
}
