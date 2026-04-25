import { assertPluginStateTransition } from "./lifecycle"
import type {
  InstalledPluginMetadata,
  PluginErrorContext,
  PluginLifecyclePhase,
  PluginModule,
} from "./manifest"
import { createPluginHostApi, type PluginHostApiOptions } from "./host"
import {
  installPluginMetadata,
  listStartupPlugins,
  recordPluginError,
  setPluginState,
  uninstallPluginMetadata,
} from "./registry"
import { executePluginInSandbox, type PluginSandboxAdapter } from "./sandbox"

export interface PluginRuntimeOptions {
  hostApi?: PluginHostApiOptions
  onError?: (error: Error, context: PluginErrorContext) => void | Promise<void>
  sandbox: PluginSandboxAdapter
}

interface RuntimeEntry {
  code: string
  metadata: InstalledPluginMetadata
  module?: PluginModule
}

export class PluginRuntime {
  private readonly entries = new Map<string, RuntimeEntry>()

  constructor(private readonly options: PluginRuntimeOptions) {}

  async install(metadata: InstalledPluginMetadata, code: string) {
    await installPluginMetadata(metadata)
    this.entries.set(metadata.id, { code, metadata })
    return metadata
  }

  async update(metadata: InstalledPluginMetadata, code: string) {
    const existing = this.entries.get(metadata.id)
    await existing?.module?.onUnload?.()
    await installPluginMetadata(metadata)
    this.entries.set(metadata.id, { code, metadata })
    return metadata
  }

  async enable(pluginId: string) {
    const entry = this.requireEntry(pluginId)
    this.transition(entry, "enabled")
    await setPluginState(pluginId, "enabled")
  }

  async load(pluginId: string) {
    const entry = this.requireEntry(pluginId)
    try {
      this.transition(entry, "loaded")
      const host = createPluginHostApi(entry.metadata.manifest, this.options.hostApi)
      entry.module = await executePluginInSandbox(this.options.sandbox, {
        code: entry.code,
        host,
        manifest: entry.metadata.manifest,
      })
      await entry.module.onLoad?.(host)
      await setPluginState(pluginId, "loaded")
    } catch (error) {
      await this.handleError(entry, "load", error)
      throw error
    }
  }

  async run(pluginId: string) {
    const entry = this.requireEntry(pluginId)
    try {
      this.transition(entry, "running")
      const host = createPluginHostApi(entry.metadata.manifest, this.options.hostApi)
      await entry.module?.onRun?.(host)
      await setPluginState(pluginId, "running")
    } catch (error) {
      await this.handleError(entry, "run", error)
      throw error
    }
  }

  async disable(pluginId: string) {
    const entry = this.requireEntry(pluginId)
    await entry.module?.onUnload?.()
    this.transition(entry, "disabled")
    await setPluginState(pluginId, "disabled")
  }

  async uninstall(pluginId: string) {
    const entry = this.entries.get(pluginId)
    await entry?.module?.onUnload?.()
    this.entries.delete(pluginId)
    await uninstallPluginMetadata(pluginId)
  }

  async unload(pluginId: string) {
    const entry = this.requireEntry(pluginId)
    await entry.module?.onUnload?.()
    entry.module = undefined
  }

  async loadEnabledOnStartup(codeResolver: (metadata: InstalledPluginMetadata) => Promise<string>) {
    const plugins = await listStartupPlugins()
    for (const metadata of plugins) {
      const code = await codeResolver(metadata)
      this.entries.set(metadata.id, { code, metadata })
      await this.load(metadata.id).catch(() => undefined)
    }
  }

  private transition(entry: RuntimeEntry, nextState: InstalledPluginMetadata["state"]) {
    assertPluginStateTransition(entry.metadata.state, nextState)
    entry.metadata = {
      ...entry.metadata,
      state: nextState,
      updatedAt: Date.now(),
    }
  }

  private requireEntry(pluginId: string) {
    const entry = this.entries.get(pluginId)
    if (!entry) {
      throw new Error(`Plugin ${pluginId} is not installed in this runtime.`)
    }
    return entry
  }

  private async handleError(entry: RuntimeEntry, phase: PluginLifecyclePhase, error: unknown) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    entry.metadata = {
      ...entry.metadata,
      lastError: {
        message: normalized.message,
        occurredAt: Date.now(),
        phase,
      },
      state: "error",
      updatedAt: Date.now(),
    }
    await recordPluginError(entry.metadata.id, entry.metadata.lastError!)
    const context: PluginErrorContext = {
      executionModel: entry.metadata.manifest.executionModel,
      phase,
      pluginId: entry.metadata.id,
      state: entry.metadata.state,
    }
    await entry.module?.onError?.(normalized, context)
    await this.options.onError?.(normalized, context)
  }
}
