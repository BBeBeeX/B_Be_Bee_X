import type { InstalledPluginMetadata } from "@b_be_bee/database/schemas/index"
import type { PluginSession } from "@b_be_bee/models"
import type { PluginNetworkRequest } from "./music-source"

export const pluginTypes = ["music-source", "ui-extension", "service"] as const
export const pluginExecutionModels = ["isolated-vm", "worker", "bridge"] as const
export const pluginStates = ["installed", "enabled", "loaded", "running", "error", "disabled"] as const

export type PluginType = (typeof pluginTypes)[number]
export type PluginExecutionModel = (typeof pluginExecutionModels)[number]
export type PluginState = (typeof pluginStates)[number]
export type PluginSourceKind = "zip" | "single-file"
export type PluginSignatureStatus = "verified" | "unverified" | "blocked"

export interface PluginManifestPermissions {
  network: string[]
  storage: string[]
  auth: boolean
  proxy: boolean
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: string
  minAppVersion: string
  type: PluginType
  executionModel: PluginExecutionModel
  capabilities: string[]
  scopes: string[]
  permissions: PluginManifestPermissions
  checksum: string
  signature: string
}

export interface PluginErrorRecord {
  message: string
  phase: PluginLifecyclePhase
  occurredAt: number
}

export type PluginLifecyclePhase =
  | "install"
  | "enable"
  | "load"
  | "run"
  | "api-call"
  | "event"
  | "disable"
  | "uninstall"
  | "update"

export type { InstalledPluginMetadata }

export interface PluginErrorContext {
  pluginId: string
  phase: PluginLifecyclePhase
  executionModel: PluginExecutionModel
  state: PluginState
}

export type PluginOnError = (error: Error, context: PluginErrorContext) => void | Promise<void>

export interface PluginModule {
  onLoad?: (host: PluginHostApi) => void | Promise<void>
  onRun?: (host: PluginHostApi) => void | Promise<void>
  onUnload?: () => void | Promise<void>
  onError?: PluginOnError
}

export interface PluginHostApi {
  auth: {
    getSession: () => Promise<PluginSession | undefined>
  }
  logger: {
    error: (message: string, metadata?: Record<string, unknown>) => void
    info: (message: string, metadata?: Record<string, unknown>) => void
  }
  network: {
    request: <TData = unknown>(input: PluginNetworkRequest) => Promise<TData>
  }
  storage: {
    get: (namespace: string, key: string) => Promise<unknown>
    set: (namespace: string, key: string, value: unknown) => Promise<void>
  }
}
