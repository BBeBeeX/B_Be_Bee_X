import type { PersistedProxySettings } from "@b_be_bee/database/schemas/index"

import type { NetworkError, NetworkErrorCategory } from "./errors"

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS"
export type NetworkHeaders = Record<string, string>
export type NetworkBody = BodyInit | null
export type NetworkResponseType = "json" | "text" | "arrayBuffer" | "raw"
export type ProxyPreference = "inherit" | "force" | "direct"

export type ProxySettings = PersistedProxySettings

export interface RetryPolicy {
  attempts: number
  backoffMs: number
  maxBackoffMs: number
  retryableStatuses: number[]
  retryableErrors: NetworkErrorCategory[]
  retryUnsafeMethods: boolean
}

export interface CachePolicy {
  enabled: boolean
  ttlMs: number
  key?: string
  varyHeaders?: string[]
}

export interface NetworkRequest {
  url: string | URL
  method?: HttpMethod
  headers?: NetworkHeaders
  body?: NetworkBody
  signal?: AbortSignal
  timeoutMs?: number
  responseType?: NetworkResponseType
  expectStatus?: boolean
  proxy?: ProxyPreference
  retry?: Partial<RetryPolicy>
  cache?: CachePolicy
}

export interface NetworkResponse<TData = unknown> {
  data: TData
  headers: NetworkHeaders
  ok: boolean
  status: number
  statusText: string
  url: string
  fromCache: boolean
}

export interface NetworkRequestContext {
  pluginId?: string
}

export interface TransportRequest extends NetworkRequest {
  method: HttpMethod
  resolvedProxy?: ProxySettings
}

export interface NetworkTransport {
  request: (request: TransportRequest) => Promise<Response>
}

export interface NetworkLogger {
  log: (event: NetworkLogEvent) => void
}

export type NetworkLogEventType =
  | "request:start"
  | "request:success"
  | "request:failure"
  | "request:retry"
  | "cache:hit"
  | "cache:miss"

export interface NetworkLogEvent {
  type: NetworkLogEventType
  url: string
  method: HttpMethod
  pluginId?: string
  status?: number
  durationMs?: number
  attempt?: number
  errorCategory?: NetworkError["category"]
  headers?: NetworkHeaders
}

export interface PluginNetworkPolicy {
  allowedMethods?: HttpMethod[]
  allowedDomains?: string[]
  allowProxy?: boolean
  requireProxy?: boolean
  allowDirect?: boolean
  allowCache?: boolean
  allowUnsafeRetry?: boolean
}

export interface NetworkClientConfig {
  cache?: NetworkCache
  logger?: NetworkLogger
  retry?: Partial<RetryPolicy>
  transport?: NetworkTransport
}

export interface PluginNetworkClientConfig extends NetworkClientConfig {
  policy?: PluginNetworkPolicy
}

export interface NetworkClient {
  request: <TData = unknown>(request: NetworkRequest) => Promise<NetworkResponse<TData>>
}

export interface PluginNetworkClient extends NetworkClient {
  pluginId: string
}

export interface NetworkCache {
  get: (key: string) => NetworkResponse<unknown> | undefined
  set: (key: string, response: NetworkResponse<unknown>, ttlMs: number) => void
  delete: (key: string) => void
  clearNamespace: (namespace: string) => void
}
