import {
  pluginExecutionModels,
  pluginStates,
  pluginTypes,
  type InstalledPluginMetadata,
  type PluginErrorRecord,
  type PluginExecutionModel,
  type PluginLifecyclePhase,
  type PluginManifest,
  type PluginManifestPermissions,
  type PluginSession,
  type PluginSignatureStatus,
  type PluginSourceKind,
  type PluginState,
  type PluginType,
} from "@b_be_bee/models"
import type { PluginNetworkRequest } from "./music-source"

export { pluginExecutionModels, pluginStates, pluginTypes }

export type {
  InstalledPluginMetadata,
  PluginErrorRecord,
  PluginExecutionModel,
  PluginLifecyclePhase,
  PluginManifest,
  PluginManifestPermissions,
  PluginSignatureStatus,
  PluginSourceKind,
  PluginState,
  PluginType,
}

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
