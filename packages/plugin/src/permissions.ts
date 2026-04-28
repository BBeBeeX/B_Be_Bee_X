import { NetworkError } from "@b_be_bee/network/errors"
import type { NetworkRequest, ProxyPreference } from "@b_be_bee/network/types"

import type { PluginManifest } from "./manifest"

export const hostnameMatchesDomain = (hostname: string, domain: string) => {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export const assertNetworkAllowed = (manifest: PluginManifest, request: NetworkRequest) => {
  const hostname = new URL(String(request.url)).hostname
  if (!manifest.permissions.network.some((domain) => hostnameMatchesDomain(hostname, domain))) {
    throw new NetworkError("policy", `Plugin ${manifest.id} cannot access ${hostname}.`, {
      pluginId: manifest.id,
      url: String(request.url),
    })
  }
}

export const assertProxyAllowed = (manifest: PluginManifest, proxy?: ProxyPreference) => {
  if ((proxy === "force" || proxy === "direct") && !manifest.permissions.proxy) {
    throw new NetworkError("policy", `Plugin ${manifest.id} cannot select proxy behavior.`, {
      pluginId: manifest.id,
    })
  }
}

export const assertAuthAllowed = (manifest: PluginManifest) => {
  if (!manifest.permissions.auth) {
    throw new Error(`Plugin ${manifest.id} cannot access auth/session APIs.`)
  }
}
