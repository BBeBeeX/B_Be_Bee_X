import { createCacheKey, isCacheableRequest, MemoryNetworkCache } from "./cache"
import { NetworkError, normalizeUnknownError } from "./errors"
import { emitLog } from "./logging"
import { ensureProxySettingsHydrated, getProxySettingsState } from "./proxyPersistence"
import { resolveProxy } from "./proxy"
import { canRetry, getRetryDelayMs, mergeRetryPolicy, wait } from "./retry"
import { FetchTransport } from "./transport"
import type {
  HttpMethod,
  NetworkClient,
  NetworkClientConfig,
  NetworkHeaders,
  NetworkRequest,
  NetworkRequestContext,
  NetworkResponse,
  NetworkTransport,
  PluginNetworkClient,
  PluginNetworkClientConfig,
  PluginNetworkPolicy,
  RetryPolicy,
} from "./types"

const DEFAULT_METHOD: HttpMethod = "GET"

const normalizeMethod = (method?: HttpMethod): HttpMethod => method || DEFAULT_METHOD

const createTimeoutSignal = (signal: AbortSignal | undefined, timeoutMs: number | undefined) => {
  if (!timeoutMs) return signal

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()

  signal?.addEventListener("abort", abort, { once: true })
  controller.signal.addEventListener(
    "abort",
    () => {
      globalThis.clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
    },
    { once: true },
  )

  return controller.signal
}

const headersToRecord = (headers: Headers): NetworkHeaders => {
  const record: NetworkHeaders = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

const parseResponseData = async <TData>(response: Response, request: NetworkRequest) => {
  const responseType = request.responseType || "json"
  if (responseType === "raw") {
    return response as TData
  }
  if (responseType === "text") {
    return response.text() as Promise<TData>
  }
  if (responseType === "arrayBuffer") {
    return response.arrayBuffer() as Promise<TData>
  }
  if (response.status === 204) {
    return undefined as TData
  }
  return response.json() as Promise<TData>
}

const validatePluginPolicy = (
  request: NetworkRequest,
  method: HttpMethod,
  context: NetworkRequestContext,
  policy?: PluginNetworkPolicy,
) => {
  if (!context.pluginId) return

  if (policy?.allowedDomains) {
    const hostname = new URL(String(request.url)).hostname
    const isAllowed = policy.allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    )
    if (!isAllowed) {
      throw new NetworkError("policy", `Plugin request host ${hostname} is not allowed.`, {
        method,
        pluginId: context.pluginId,
        url: String(request.url),
      })
    }
  }

  if ((request.proxy === "force" || request.proxy === "direct") && policy?.allowProxy === false) {
    throw new NetworkError("policy", "Plugin proxy selection is blocked by policy.", {
      method,
      pluginId: context.pluginId,
      url: String(request.url),
    })
  }

  if (policy?.allowedMethods && !policy.allowedMethods.includes(method)) {
    throw new NetworkError("policy", `Plugin request method ${method} is not allowed.`, {
      method,
      pluginId: context.pluginId,
      url: String(request.url),
    })
  }

  if (request.cache?.enabled && policy?.allowCache === false) {
    throw new NetworkError("policy", "Plugin cache usage is blocked by policy.", {
      method,
      pluginId: context.pluginId,
      url: String(request.url),
    })
  }

  if (request.retry?.retryUnsafeMethods && policy?.allowUnsafeRetry !== true) {
    throw new NetworkError("policy", "Unsafe method retries are blocked by policy.", {
      method,
      pluginId: context.pluginId,
      url: String(request.url),
    })
  }
}

const buildRequest = (
  request: NetworkRequest,
  method: HttpMethod,
  retryPolicy: RetryPolicy,
  signal: AbortSignal | undefined,
): NetworkRequest => ({
  ...request,
  method,
  retry: retryPolicy,
  signal,
})

class NetworkClientImpl implements NetworkClient {
  private readonly cache: NetworkClientConfig["cache"]
  private readonly logger: NetworkClientConfig["logger"]
  private readonly retry: NetworkClientConfig["retry"]
  private readonly transport: NetworkTransport
  private readonly context: NetworkRequestContext
  private readonly policy?: PluginNetworkPolicy

  constructor(config: NetworkClientConfig & { context?: NetworkRequestContext; policy?: PluginNetworkPolicy }) {
    this.cache = config.cache || new MemoryNetworkCache()
    this.logger = config.logger
    this.retry = config.retry
    this.transport = config.transport || new FetchTransport()
    this.context = config.context || {}
    this.policy = config.policy
  }

  async request<TData = unknown>(request: NetworkRequest): Promise<NetworkResponse<TData>> {
    const method = normalizeMethod(request.method)
    const startedAt = Date.now()
    const url = String(request.url)
    const retryPolicy = mergeRetryPolicy({
      ...this.retry,
      ...request.retry,
    })
    const signal = createTimeoutSignal(request.signal, request.timeoutMs)
    const executableRequest = buildRequest(request, method, retryPolicy, signal)

    validatePluginPolicy(executableRequest, method, this.context, this.policy)
    await ensureProxySettingsHydrated()
    const proxyResolution = resolveProxy({
      context: this.context,
      preference: request.proxy,
      policy: this.policy,
      state: getProxySettingsState(),
    })

    if (request.cache?.enabled && !isCacheableRequest(executableRequest)) {
      throw new NetworkError("policy", "Only GET and HEAD requests are cacheable by default.", {
        method,
        pluginId: this.context.pluginId,
        url,
      })
    }

    const cacheKey =
      request.cache?.enabled && this.cache
        ? createCacheKey(executableRequest, this.context, request.cache)
        : undefined

    if (cacheKey && request.cache) {
      const cached = this.cache?.get(cacheKey)
      if (cached) {
        emitLog(this.logger, {
          method,
          pluginId: this.context.pluginId,
          type: "cache:hit",
          url,
        })
        return cached as NetworkResponse<TData>
      }
      emitLog(this.logger, {
        method,
        pluginId: this.context.pluginId,
        type: "cache:miss",
        url,
      })
    }

    emitLog(this.logger, {
      headers: request.headers,
      method,
      pluginId: this.context.pluginId,
      type: "request:start",
      url,
    })

    let attempt = 1
    while (true) {
      try {
        const response = await this.transport.request({
          ...executableRequest,
          method,
          resolvedProxy: proxyResolution.settings,
        })

        if ((request.expectStatus ?? true) && !response.ok) {
          throw new NetworkError("http", `HTTP ${response.status} ${response.statusText}`, {
            method,
            pluginId: this.context.pluginId,
            status: response.status,
            url,
          })
        }

        const data = await parseResponseData<TData>(response, request).catch((error: unknown) => {
          throw new NetworkError("parse", "Failed to parse network response.", {
            cause: error,
            method,
            pluginId: this.context.pluginId,
            status: response.status,
            url,
          })
        })

        const networkResponse: NetworkResponse<TData> = {
          data,
          fromCache: false,
          headers: headersToRecord(response.headers),
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url || url,
        }

        if (cacheKey && request.cache) {
          this.cache?.set(cacheKey, networkResponse, request.cache.ttlMs)
        }

        emitLog(this.logger, {
          durationMs: Date.now() - startedAt,
          method,
          pluginId: this.context.pluginId,
          status: response.status,
          type: "request:success",
          url,
        })

        return networkResponse
      } catch (error) {
        const normalized = normalizeUnknownError(error, {
          method,
          pluginId: this.context.pluginId,
          url,
        })

        if (canRetry({ attempt, error: normalized, method, policy: retryPolicy })) {
          emitLog(this.logger, {
            attempt,
            errorCategory: normalized.category,
            method,
            pluginId: this.context.pluginId,
            type: "request:retry",
            url,
          })
          await wait(getRetryDelayMs(attempt, retryPolicy))
          attempt += 1
          continue
        }

        emitLog(this.logger, {
          attempt,
          durationMs: Date.now() - startedAt,
          errorCategory: normalized.category,
          method,
          pluginId: this.context.pluginId,
          status: normalized.status,
          type: "request:failure",
          url,
        })
        throw normalized
      }
    }
  }
}

export const createNetworkClient = (config: NetworkClientConfig = {}): NetworkClient => {
  return new NetworkClientImpl(config)
}

export const createPluginNetworkClient = (
  pluginId: string,
  config: PluginNetworkClientConfig = {},
): PluginNetworkClient => {
  if (!pluginId.trim()) {
    throw new NetworkError("policy", "Plugin network clients require a plugin id.")
  }

  const client = new NetworkClientImpl({
    ...config,
    context: {
      pluginId,
    },
    policy: config.policy,
  })

  return {
    pluginId,
    request: client.request.bind(client),
  }
}
