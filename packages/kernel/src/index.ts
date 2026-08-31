/**
 * `@BBeBee/kernel` — Cordis plus BBeBee's bootstrap.
 *
 * **Plugins import Cordis from here, not from `cordis` directly.** Cordis is a
 * release candidate whose README says the API may change without notice; this
 * re-export is the single adapter that would absorb such a change instead of
 * 40 packages each importing upstream. See docs/09-project-structure.md §5.1.
 */

// ── The pinned Cordis surface ────────────────────────────────────────────
// Deliberately narrow: this is the entire API the project uses, which bounds
// the blast radius of an upstream change and makes it auditable.
export { Context, Service, Inject } from 'cordis'
// `Disposable` is deliberately NOT re-exported from cordis: `@BBeBee/protocol`
// exports its own structurally identical one, and two same-named types would
// be easy for plugin authors to mix up. Import it from the protocol package.
export type { Plugin, Fiber, Effect, EffectMeta, Inject as InjectSpec } from 'cordis'

// `FiberState` is re-exported from our own mirror rather than from cordis:
// upstream declares it as an ambient `const enum`, which cannot be imported
// under isolatedModules (i.e. under esbuild, Metro, or Vite).
export { FiberState, fiberStateName, isActive, isSettled } from './fiber-state.js'
export type { FiberStateName, FiberStateValue } from './fiber-state.js'

// ── Kernel ───────────────────────────────────────────────────────────────
export { createApp, BootstrapError } from './app.js'
export type { App, AppOptions, BootstrapEntry, Target } from './app.js'

export { resolveConfig, isEnabled } from './config.js'
export type { AppConfig, PluginEntry, PluginInstanceConfig, ResolvedInstance } from './config.js'

export { loadPlugins } from './loader.js'
export type { LoadOptions, LoadState, LoadedPlugin, PluginRegistry, RegistryEntry } from './loader.js'

export {
  scopeContext,
  capabilityConfigOf,
  assertFs,
  assertHost,
  assertWsHost,
  assertGranted,
  assertDb,
  tablesReferenced,
  storageNamespace,
} from './capability.js'
export type { CapabilityConfig, GrantOptions } from './capability.js'

export {
  MigrationRunner,
  MigrationError,
  NamespaceCollisionError,
  CORE_NAMESPACE,
  MIGRATIONS_TABLE,
  NAMESPACES_TABLE,
  nsPrefix,
  expandNs,
  escapeLike,
} from './migrations/runner.js'
export type { MigrationDb, MigrationTx } from './migrations/runner.js'
export { CORE_MIGRATIONS } from './migrations/core.js'
