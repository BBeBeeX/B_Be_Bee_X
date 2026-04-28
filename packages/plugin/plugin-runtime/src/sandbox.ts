import type {
  PluginExecutionModel,
  PluginHostApi,
  PluginManifest,
  PluginModule,
} from "@b_be_bee/plugin-sdk/manifest"
import { PluginError, validateMusicSourcePlugin } from "@b_be_bee/plugin-sdk/music-source"

export interface PluginSandboxContext {
  code: string
  host: PluginHostApi
  manifest: PluginManifest
}

export interface PluginSandboxAdapter {
  execute: (context: PluginSandboxContext) => Promise<PluginModule>
  platform: "electron" | "expo" | "web"
  supportedExecutionModels: PluginExecutionModel[]
}

export const assertExecutionModelSupported = (
  adapter: PluginSandboxAdapter,
  executionModel: PluginExecutionModel,
) => {
  if (!adapter.supportedExecutionModels.includes(executionModel)) {
    throw new Error(`Execution model ${executionModel} is not supported by ${adapter.platform}.`)
  }
}

export const executePluginInSandbox = async (
  adapter: PluginSandboxAdapter,
  context: PluginSandboxContext,
) => {
  assertExecutionModelSupported(adapter, context.manifest.executionModel)
  const module = await adapter.execute(context)
  if (context.manifest.type === "music-source") {
    try {
      validateMusicSourcePlugin(module, context.manifest)
    } catch (error) {
      if (error instanceof PluginError) throw error
      throw new PluginError(
        "INVALID_RESPONSE",
        "Music source plugin must provide meta, capabilities, and required music source methods.",
      )
    }
  }
  return module
}
