/**
 * The capability gate.
 *
 * Each plugin runs in a context where every mediated core service has been
 * `intercept`ed with the plugin's grants. The service reads that config and
 * refuses out-of-scope operations. Because services are reached through
 * Cordis's proxy, a plugin cannot walk the object graph to an unscoped
 * reference.
 *
 * ⚠️ This is defense in depth, NOT a sandbox. Runtime-loaded plugins execute
 * in the same JS realm as the app and can reach globals and patch prototypes.
 * The gate makes overreach *auditable and revocable*; it does not contain a
 * hostile plugin. See docs/03-plugin-system.md §7.
 */

import type { Context } from 'cordis'
import {
  CapabilityError,
  MEDIATED_SERVICES,
  allowsFs,
  allowsHost,
  type Capability,
  type FsScope,
  type MediatedService,
} from '@BBeBee/protocol'

/**
 * What the kernel injects into each mediated service via `ctx.intercept()`.
 * Core service implementations read this off their resolved config.
 */
export interface CapabilityConfig {
  pluginId: string
  /**
   * The configured instance. Core services use it as the namespace for
   * per-instance storage — the `store` prefix, the `secrets` namespace, and
   * the cookie jar name all key on this. See docs/03 §5.
   */
  instanceId: string
  granted: readonly string[]
}

export interface GrantOptions {
  pluginId: string
  instanceId?: string
  /** What the manifest asked for. */
  requested: readonly Capability[]
  /**
   * What the user actually granted. When omitted the manifest is trusted,
   * which is correct only for bundled first-party plugins — `loadPlugins`
   * refuses a non-`builtin` plugin that has no grant.
   */
  granted?: readonly string[]
}

/**
 * Derive a plugin's context, with every mediated service capability-scoped.
 *
 * Services not listed in `MEDIATED_SERVICES` pass through untouched — they
 * expose nothing a capability would govern.
 */
export function scopeContext(ctx: Context, opts: GrantOptions): Context {
  const config: CapabilityConfig = {
    pluginId: opts.pluginId,
    instanceId: opts.instanceId ?? opts.pluginId,
    granted: normalizeGrants(opts.granted ?? opts.requested),
  }

  let scoped = ctx
  for (const key of MEDIATED_SERVICES) {
    scoped = scoped.intercept(key, config)
  }
  return scoped
}

/** Drop anything that is not a string, so a malformed grant list cannot throw. */
function normalizeGrants(granted: readonly unknown[]): string[] {
  return granted.filter((c): c is string => typeof c === 'string')
}

/* ── Enforcement helpers, called by core service implementations ────────── */

/**
 * Read the gate config a service was intercepted with.
 *
 * Returns `undefined` for an unmediated caller — the kernel itself, a core
 * service calling another, or a test harness. Those are trusted.
 */
export function capabilityConfigOf(config: unknown): CapabilityConfig | undefined {
  if (!config || typeof config !== 'object') return undefined
  const c = config as Partial<CapabilityConfig>
  if (typeof c.pluginId !== 'string' || !Array.isArray(c.granted)) return undefined
  return {
    pluginId: c.pluginId,
    instanceId: typeof c.instanceId === 'string' ? c.instanceId : c.pluginId,
    granted: normalizeGrants(c.granted),
  }
}

export function assertFs(config: unknown, mode: 'read' | 'write', scope: FsScope): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  if (!allowsFs(gate.granted, mode, scope)) {
    throw new CapabilityError(
      `fs:${mode}:${scope}`,
      `${gate.pluginId} may not ${mode} ${scope} files`,
    )
  }
}

/**
 * Check an outbound URL against the `net:host/<glob>` grants.
 *
 * Governs both `ctx.http` and `ctx.ws` — one grant covers HTTP and WebSocket
 * to the same host, matching docs/03 §7.
 *
 * ⚠️ Matching is on the hostname only: the port is not considered, so a grant
 * cannot be narrowed to `host:8080`. Patterns are compared lowercase; an
 * IDN host must be granted in the same (punycode or unicode) form the URL
 * uses. Unmatched cases deny, so the failure direction is safe.
 */
export function assertHost(config: unknown, url: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return

  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    throw new CapabilityError('net:host', `${gate.pluginId} requested a malformed url: ${url}`)
  }
  // Normalise a trailing-dot FQDN so `example.org.` matches `example.org`.
  if (host.endsWith('.')) host = host.slice(0, -1)

  if (!allowsHost(gate.granted, host)) {
    throw new CapabilityError(`net:host/${host}`, `${gate.pluginId} may not reach ${host}`)
  }
}

/** WebSocket connections are governed by the same `net:host/` grants. */
export const assertWsHost = assertHost

/** For the flag-shaped capabilities: `audio`, `notify`, `shell`, `background`, … */
export function assertGranted(config: unknown, capability: MediatedService | string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  if (!gate.granted.includes(capability)) {
    throw new CapabilityError(capability, `${gate.pluginId} was not granted ${capability}`)
  }
}

/**
 * The storage namespace a plugin's `store`, `secrets`, and cookie jar use.
 *
 * Core services call this rather than inventing their own scheme, so a plugin
 * gets the same namespace across all three.
 */
export function storageNamespace(config: unknown): string | undefined {
  return capabilityConfigOf(config)?.instanceId
}
