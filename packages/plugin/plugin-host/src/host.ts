import type { PluginSession } from "@b_be_bee/models"
import { logger } from "@b_be_bee/logger"
import { createPluginNetworkClient } from "@b_be_bee/network/client"
import type { NetworkRequest } from "@b_be_bee/network/types"

import type { PluginHostApi, PluginManifest } from "@b_be_bee/plugin-sdk/manifest"
import { PluginError, type PluginNetworkRequest } from "@b_be_bee/plugin-sdk/music-source"
import {
  assertAuthAllowed,
  assertNetworkAllowed,
  assertProxyAllowed,
} from "@b_be_bee/plugin-loader/permissions"

export interface PluginHostApiOptions {
  authProvider?: () => Promise<PluginSession | undefined>
}

export const createPluginHostApi = (
  manifest: PluginManifest,
  options: PluginHostApiOptions = {},
): PluginHostApi => {
  const networkClient = createPluginNetworkClient(manifest.id, {
    policy: {
      allowedDomains: manifest.permissions.network,
      allowDirect: manifest.permissions.proxy,
      allowProxy: manifest.permissions.proxy,
      requireProxy: false,
    },
  })

  return {
    auth: {
      getSession: async () => {
        assertAuthAllowed(manifest)
        return options.authProvider?.()
      },
    },
    logger: {
      error(message, metadata) {
        logger.error("[plugin]", manifest.id, message, metadata)
      },
      info(message, metadata) {
        logger.info("[plugin]", manifest.id, message, metadata)
      },
    },
    network: {
      request: async <TData>(input: PluginNetworkRequest) => {
        assertNetworkAllowed(manifest, input)
        assertProxyAllowed(manifest, input.proxy)
        const { useAuth, ...request } = input
        const headers = { ...request.headers }
        if (useAuth) {
          assertAuthAllowed(manifest)
          const session = await options.authProvider?.()
          if (!session?.isLoggedIn) {
            throw new PluginError("AUTH_REQUIRED", `Plugin ${manifest.id} requires an active session.`)
          }
          const cookie = session.credentials?.cookie
          const token = session.credentials?.token
          if (cookie) headers.Cookie = cookie
          if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`
        }
        const response = await networkClient.request<TData>({
          ...(request as NetworkRequest),
          headers,
        })
        return response.data
      },
    },
  }
}
