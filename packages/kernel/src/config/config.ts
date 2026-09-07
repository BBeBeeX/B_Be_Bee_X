/**
 * The application config document, and its expansion into plugin activations.
 *
 * One document serves both targets. It is read through `ctx.fs` before any
 * feature plugin loads — the shell parses YAML or JSON and hands the object
 * here, so the kernel never depends on a parser.
 *
 * **Music sources are not configured here.** They are rows in the `sources`
 * table, imported and edited in the app, and `plugin-source-runtime` gives
 * each one its own fiber inside its own `ctx.isolate('http')` scope. Putting
 * them in a config file would mean hand-editing JSON to add a server, and
 * would make "import this string" a developer action. That is why this file
 * no longer expands per-plugin `instances`: nothing needed them once the only
 * multi-instance thing in the system stopped being a plugin.
 *
 * See docs/03-plugin-system.md §6.4 and docs/06-music-sources.md §9.
 */

import { ConfigError } from '@BBeBee/protocol'

export interface PluginEntry {
  enabled?: boolean
  config?: Record<string, unknown>
}

export interface AppConfig {
  plugins?: Record<string, PluginEntry>
}

/** A single plugin activation. */
export interface ResolvedPlugin {
  pluginId: string
  config: Record<string, unknown>
}

/**
 * Validate and expand a config document.
 *
 * Throws `ConfigError` rather than returning a partial result: a malformed
 * config that silently drops a plugin would look identical to a plugin that
 * failed to load, which is a miserable thing to debug.
 */
export function resolveConfig(config: AppConfig): ResolvedPlugin[] {
  const out: ResolvedPlugin[] = []

  for (const [pluginId, entry] of Object.entries(config.plugins ?? {})) {
    // `plugins: { a: }` is valid YAML and yields null. Skipping it silently
    // would look exactly like a plugin that failed to load.
    if (entry === null || typeof entry !== 'object') {
      throw new ConfigError(pluginId, ['entry must be an object'])
    }
    if (entry.config !== undefined && (entry.config === null || typeof entry.config !== 'object')) {
      throw new ConfigError(pluginId, ['config must be an object'])
    }
    if (entry.enabled === false) continue

    out.push({ pluginId, config: entry.config ?? {} })
  }

  return out
}

/**
 * Whether a plugin is enabled.
 *
 * False unless the plugin is mentioned in the config and not explicitly
 * disabled — configuration is the allowlist, so presence in the registry is
 * not on its own enough to run.
 */
export function isEnabled(config: AppConfig, pluginId: string): boolean {
  const entry = config.plugins?.[pluginId]
  return entry ? entry.enabled !== false : false
}
