import type { CachePolicy, NetworkCache, NetworkRequest, NetworkRequestContext, NetworkResponse } from "./types"

interface CacheEntry {
  expiresAt: number
  response: NetworkResponse<unknown>
}

export class MemoryNetworkCache implements NetworkCache {
  private readonly entries = new Map<string, CacheEntry>()

  get(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return {
      ...entry.response,
      fromCache: true,
    }
  }

  set(key: string, response: NetworkResponse<unknown>, ttlMs: number) {
    this.entries.set(key, {
      expiresAt: Date.now() + ttlMs,
      response: {
        ...response,
        fromCache: false,
      },
    })
  }

  delete(key: string) {
    this.entries.delete(key)
  }

  clearNamespace(namespace: string) {
    const prefix = `${namespace}:`
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key)
      }
    }
  }
}

export const isCacheableRequest = (request: NetworkRequest) => {
  const method = request.method || "GET"
  return method === "GET" || method === "HEAD"
}

export const createCacheNamespace = (context: NetworkRequestContext) => {
  return context.pluginId ? `plugin:${context.pluginId}` : "app"
}

export const createCacheKey = (
  request: NetworkRequest,
  context: NetworkRequestContext,
  policy: CachePolicy,
) => {
  if (policy.key) {
    return `${createCacheNamespace(context)}:${policy.key}`
  }

  const url = String(request.url)
  const method = request.method || "GET"
  const varyHeaders = (policy.varyHeaders || [])
    .map((header) => `${header.toLowerCase()}=${request.headers?.[header] || ""}`)
    .sort()
    .join("&")

  return `${createCacheNamespace(context)}:${method}:${url}:${varyHeaders}`
}
