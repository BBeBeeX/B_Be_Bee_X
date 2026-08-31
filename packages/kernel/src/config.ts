/**
 * The application config document, and its expansion into plugin instances.
 *
 * One document serves both targets. It is read through `ctx.fs` before any
 * feature plugin loads — the shell parses YAML or JSON and hands the object
 * here, so the kernel never depends on a parser.
 *
 * See docs/03-plugin-system.md §6.4.
 */

import { ConfigError } from '@BBeBee/protocol'

/** One configured instance of a plugin. */
export interface PluginInstanceConfig {
  /** Instance id. Becomes the URN's second segment — must be stable. */
  id: string
  config?: Record<string, unknown>
}

export interface PluginEntry {
  enabled?: boolean
  config?: Record<string, unknown>
  /**
   * Present only for `instantiable` plugins. Expands to one `ctx.plugin()`
   * call per entry, each in its own `ctx.isolate('http')` scope.
   */
  instances?: PluginInstanceConfig[]
}

export interface AppConfig {
  plugins?: Record<string, PluginEntry>
}

/** A single plugin activation, after expansion. Instance ids are resolved. */
export interface ResolvedInstance {
  pluginId: string
  /** For non-instantiable plugins this equals `pluginId`. */
  instanceId: string
  config: Record<string, unknown>
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

/**
 * Validate and expand a config document.
 *
 * Throws `ConfigError` rather than returning a partial result: a malformed
 * config that silently drops a source would look identical to a source that
 * failed to load, which is a miserable thing to debug.
 */
export function resolveConfig(config: AppConfig): ResolvedInstance[] {
  const out: ResolvedInstance[] = []
  const seen = new Map<string, string>()

  for (const [pluginId, entry] of Object.entries(config.plugins ?? {})) {
    if (entry.enabled === false) continue

    // An explicit `instances` key expands by entry — including an empty array,
    // which means zero activations. Falling back to a default instance there
    // would boot a ghost provider whose instanceId is the whole package name.
    if (entry.instances) {
      for (const inst of entry.instances) {
        if (!inst.id || !ID_PATTERN.test(inst.id)) {
          throw new ConfigError(pluginId, [
            `instance id ${JSON.stringify(inst.id)} must match ${ID_PATTERN}`,
          ])
        }
        if (inst.id.includes(':')) {
          throw new ConfigError(pluginId, [`instance id may not contain ':' (urn separator)`])
        }
        const prior = seen.get(inst.id)
        if (prior) {
          throw new ConfigError(pluginId, [
            `duplicate instance id ${JSON.stringify(inst.id)}, already used by ${prior}`,
          ])
        }
        seen.set(inst.id, pluginId)
        out.push({
          pluginId,
          instanceId: inst.id,
          // Instance config overlays the plugin-level defaults.
          config: { ...entry.config, ...inst.config },
        })
      }
    } else {
      const prior = seen.get(pluginId)
      if (prior) {
        throw new ConfigError(pluginId, [`duplicate instance id ${JSON.stringify(pluginId)}`])
      }
      seen.set(pluginId, pluginId)
      out.push({ pluginId, instanceId: pluginId, config: entry.config ?? {} })
    }
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
