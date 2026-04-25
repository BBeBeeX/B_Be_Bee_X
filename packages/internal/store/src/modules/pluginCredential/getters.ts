import { usePluginCredentialsStore } from "./store"

const get = usePluginCredentialsStore.getState

export const getPluginCredential = (pluginId: string) => get().credentials[pluginId]
