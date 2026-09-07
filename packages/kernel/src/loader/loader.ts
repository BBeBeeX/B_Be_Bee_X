/**
 * The static plugin loader.
 *
 * Metro cannot resolve a module path computed at runtime, so on mobile every
 * plugin import must be statically analysable: a codegen step emits a registry
 * object and this loader instantiates from it. Desktop registers this loader
 * too, and layers `plugin-loader-dynamic` on top for user-installed plugins.
 *
 * See docs/03-plugin-system.md §6.
 */

import type { Context } from 'cordis'
import type { Plugin } from 'cordis'
import type { PluginManifest } from '@BBeBee/protocol'
import { scopeContext } from '../capability-gate/capability.js'
import type { ResolvedPlugin } from '../config/config.js'
import { FiberState, fiberStateName } from '../fiber-state.js'

/** What the codegen step emits: package id → plugin, plus its manifest. */
export interface RegistryEntry {
  plugin: Plugin
  manifest: PluginManifest
  /**
   * True for first-party plugins bundled with the app, which are granted their
   * manifest implicitly. Third-party plugins must be granted explicitly by the
   * user; without a grant entry they are refused rather than trusted.
   * See docs/03-plugin-system.md §7.
   */
  builtin?: boolean
}

export type PluginRegistry = Record<string, RegistryEntry>

export type LoadState =
  | 'active'
  /** Loaded without error but still waiting on an injected service. */
  | 'pending'
  | 'failed'
  | 'quarantined'
  | 'missing'
  /** Not bundled, and the user has not granted its requested capabilities. */
  | 'ungranted'

export interface LoadedPlugin {
  pluginId: string
  state: LoadState
  error?: Error
  /** Which injected services were still missing, when `state` is 'pending'. */
  waitingFor?: string[]
  /** Present when the plugin actually started. */
  dispose?: () => Promise<void>
}

export interface LoadOptions {
  /** Consecutive failures before a plugin is skipped on subsequent boots. */
  quarantineAfter?: number
  /** Prior failure counts from `plugin_records.fail_count`, keyed by pluginId. */
  failCounts?: Record<string, number>
  /**
   * Grants from `capability_grants`, keyed by pluginId. Absent for a
   * non-`builtin` plugin means "the user has not approved this", and it is
   * refused — the gate fails closed.
   */
  grants?: Record<string, readonly string[]>
  /**
   * Called for each plugin to derive its context. Defaults to the capability
   * gate alone.
   *
   * Per-source isolation is *not* done here: `plugin-source-runtime` calls
   * `ctx.isolate('http')` itself, once per imported source, because sources
   * come and go while the app runs and the loader only runs at boot.
   */
  deriveContext?: (ctx: Context, plugin: ResolvedPlugin, manifest: PluginManifest) => Context
}

/**
 * Instantiate every resolved plugin.
 *
 * Failures are contained: a plugin that throws is recorded as `failed` and its
 * dependents simply never activate. Nothing here rethrows, because one bad
 * plugin must not become an unrecoverable boot loop.
 */
export async function loadPlugins(
  ctx: Context,
  registry: PluginRegistry,
  plugins: ResolvedPlugin[],
  options: LoadOptions = {},
): Promise<LoadedPlugin[]> {
  const quarantineAfter = options.quarantineAfter ?? 2
  const results: LoadedPlugin[] = []

  for (const inst of plugins) {
    const entry = registry[inst.pluginId]

    if (!entry) {
      const error = new Error(`plugin ${inst.pluginId} is configured but not in the registry`)
      ctx.logger.warn(error.message)
      ctx.emit('plugin/failed', inst.pluginId, error)
      results.push({ ...ids(inst), state: 'missing', error })
      continue
    }

    const failures = options.failCounts?.[inst.pluginId] ?? 0
    if (failures >= quarantineAfter) {
      ctx.logger.warn(
        `plugin ${inst.pluginId} is quarantined after ${failures} consecutive failures`,
      )
      results.push({ ...ids(inst), state: 'quarantined' })
      continue
    }

    // Fail closed: a plugin that is neither bundled nor explicitly granted
    // does not silently receive whatever its own manifest asked for.
    const granted = options.grants?.[inst.pluginId]
    if (!entry.builtin && !granted && entry.manifest.capabilities.length > 0) {
      const error = new Error(
        `plugin ${inst.pluginId} requests [${entry.manifest.capabilities.join(', ')}] ` +
          `but has no capability grant; install it to approve`,
      )
      ctx.logger.warn(error.message)
      results.push({ ...ids(inst), state: 'ungranted', error })
      continue
    }

    try {
      const base = scopeContext(ctx, {
        pluginId: inst.pluginId,
        requested: entry.manifest.capabilities,
        ...(granted ? { granted } : {}),
      })
      const scoped = options.deriveContext?.(base, inst, entry.manifest) ?? base

      const fiber = await scoped.plugin(entry.plugin, inst.config)

      // `await ctx.plugin()` resolves as soon as the fiber settles — which
      // includes settling into PENDING because an injected service never
      // arrived. Reporting that as `active` makes the plugin inspector claim
      // a plugin is healthy while it has never run.
      if (fiber.state !== FiberState.ACTIVE) {
        const waitingFor = missingInjections(scoped, entry.plugin)
        ctx.logger.warn(
          `plugin ${inst.pluginId} is ${fiberStateName(fiber.state)}` +
            (waitingFor.length ? `, waiting for: ${waitingFor.join(', ')}` : ''),
        )
        results.push({
          ...ids(inst),
          state: 'pending',
          waitingFor,
          dispose: () => fiber.dispose(),
        })
        continue
      }

      ctx.emit('plugin/loaded', inst.pluginId)
      results.push({
        ...ids(inst),
        state: 'active',
        dispose: async () => {
          await fiber.dispose()
          ctx.emit('plugin/unloaded', inst.pluginId)
        },
      })
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      ctx.logger.error(`plugin ${inst.pluginId} failed to load: ${error.message}`)
      ctx.emit('plugin/failed', inst.pluginId, error)
      results.push({ ...ids(inst), state: 'failed', error })
    }
  }

  return results
}

/** Which of a plugin's declared injections are not currently available. */
function missingInjections(ctx: Context, plugin: Plugin): string[] {
  const inject = (plugin as { inject?: string[] | Record<string, unknown> }).inject
  if (!inject) return []
  const names = Array.isArray(inject) ? inject : Object.keys(inject)
  return names.filter((name) => (ctx as unknown as Record<string, unknown>)[name] === undefined)
}

function ids(inst: ResolvedPlugin): { pluginId: string } {
  return { pluginId: inst.pluginId }
}
