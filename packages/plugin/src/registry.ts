import { PluginRegistryService } from "@b_be_bee/database/services/pluginRegistry"

import type { InstalledPluginMetadata } from "./manifest"

export const installPluginMetadata = async (metadata: InstalledPluginMetadata) => {
  await PluginRegistryService.upsert(metadata)
  return metadata
}

export const getInstalledPlugin = (pluginId: string) => {
  return PluginRegistryService.get(pluginId)
}

export const listInstalledPlugins = () => {
  return PluginRegistryService.list()
}

export const listStartupPlugins = () => {
  return PluginRegistryService.listEnabledForStartup()
}

export const setPluginState = async (
  pluginId: string,
  state: InstalledPluginMetadata["state"],
) => {
  await PluginRegistryService.setState(pluginId, state)
}

export const recordPluginError = async (
  pluginId: string,
  lastError: NonNullable<InstalledPluginMetadata["lastError"]>,
) => {
  await PluginRegistryService.recordError(pluginId, lastError)
}

export const uninstallPluginMetadata = async (pluginId: string) => {
  await PluginRegistryService.delete(pluginId)
}
