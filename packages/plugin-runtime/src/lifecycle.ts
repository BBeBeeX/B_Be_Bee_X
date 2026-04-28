import type { PluginState } from "@b_be_bee/plugin-sdk/manifest"

const transitions: Record<PluginState, PluginState[]> = {
  disabled: ["enabled"],
  enabled: ["loaded", "disabled", "error"],
  error: ["disabled", "enabled"],
  installed: ["enabled", "disabled"],
  loaded: ["running", "disabled", "error"],
  running: ["disabled", "error"],
}

export const canTransitionPluginState = (from: PluginState, to: PluginState) => {
  return transitions[from].includes(to)
}

export const assertPluginStateTransition = (from: PluginState, to: PluginState) => {
  if (!canTransitionPluginState(from, to)) {
    throw new Error(`Invalid plugin state transition: ${from} -> ${to}`)
  }
}
