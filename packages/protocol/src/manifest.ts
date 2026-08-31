/**
 * `BBeBee.plugin.json` — the manifest, and the capability grammar.
 *
 * One format serves both loaders: statically bundled on mobile, additionally
 * runtime-loadable on desktop. See docs/03-plugin-system.md §6–§7.
 */

/* ── Capability grammar ─────────────────────────────────────────────────── */

/**
 * Filesystem scopes a capability can name.
 *
 * `logs` is its own scope rather than part of `own`: the log directory is a
 * shared app resource that several transports write to, and folding it into
 * `own` would mean any plugin granted "its own data" could also read every
 * plugin's log output.
 */
export type FsScope = 'own' | 'media' | 'cache' | 'downloads' | 'logs' | 'all'

/**
 * A capability string.
 *
 *   fs:read:<scope> | fs:write:<scope>   filesystem within a named scope
 *   net:host/<glob>                      outbound HTTP/WS, plus a persisted
 *                                        cookie jar scoped to this instance
 *   db:own | db:read:<ns>                own namespaced tables; explicit reads
 *   secrets:own                          own credential namespace (no `all`)
 *   audio | mediaSession | notify | shell | background
 */
export type Capability =
  | `fs:read:${FsScope}`
  | `fs:write:${FsScope}`
  | `net:host/${string}`
  | 'db:own'
  | `db:read:${string}`
  | 'secrets:own'
  | 'audio'
  | 'mediaSession'
  | 'notify'
  | 'shell'
  | 'background'

/**
 * Services the kernel mediates. Anything else is unrestricted.
 *
 * `store` is here not because it needs a capability — it does not — but
 * because the intercept config carries the per-plugin storage namespace that
 * `ctx.store`, `ctx.secrets`, and the cookie jar all key on. See docs/03 §5.
 */
export const MEDIATED_SERVICES = [
  'fs',
  'http',
  'ws',
  'db',
  'store',
  'secrets',
  'audio',
  'mediaSession',
  'notify',
  'shell',
  'background',
] as const

export type MediatedService = (typeof MEDIATED_SERVICES)[number]

/* ── Manifest ───────────────────────────────────────────────────────────── */

export interface PluginEntrypoints {
  main: string
  ui?: {
    mobile?: string
    desktop?: string
  }
}

export interface PluginContributes {
  services?: string[]
  settings?: string
  slots?: string[]
}

export interface PluginManifest {
  /** Package id, e.g. '@BBeBee/plugin-source-subsonic'. */
  id: string
  version: string
  displayName: string
  description?: string
  engines: { BBeBee: string }
  entry: PluginEntrypoints
  capabilities: Capability[]
  contributes?: PluginContributes
  /** Whether the user may configure this plugin more than once. */
  instantiable?: boolean
}

/* ── Capability matching ────────────────────────────────────────────────── */

/**
 * Which services a capability governs, or an empty array if it governs none.
 *
 * `net:host/…` governs both `http` and `ws` — one grant covers HTTP and
 * WebSocket to the same host, per docs/03 §7.
 */
export function servicesForCapability(cap: string): MediatedService[] {
  if (cap.startsWith('fs:')) return ['fs']
  if (cap.startsWith('net:')) return ['http', 'ws']
  if (cap.startsWith('db:')) return ['db']
  if (cap.startsWith('secrets:')) return ['secrets']
  if ((MEDIATED_SERVICES as readonly string[]).includes(cap)) return [cap as MediatedService]
  return []
}

/** The primary service a capability governs. See `servicesForCapability`. */
export function serviceForCapability(cap: string): MediatedService | undefined {
  return servicesForCapability(cap)[0]
}

/**
 * Match a host against a `net:host/<glob>` pattern.
 *
 * Supports a leading `*.` wildcard and a bare `*`. Deliberately narrow: a
 * general glob implementation here would be a security-relevant surface with
 * no corresponding benefit.
 */
export function hostMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // '.example.com'
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return pattern === host
}

/** Whether a granted capability set permits an `fs` operation. */
export function allowsFs(
  granted: readonly string[],
  mode: 'read' | 'write',
  scope: FsScope,
): boolean {
  return granted.some((c) => {
    if (c === `fs:${mode}:all`) return true
    if (c === `fs:${mode}:${scope}`) return true
    // `write` implies `read` on the same scope.
    if (mode === 'read' && (c === `fs:write:${scope}` || c === 'fs:write:all')) return true
    return false
  })
}

/** Whether a granted capability set permits a request to `host`. */
export function allowsHost(granted: readonly string[], host: string): boolean {
  return granted.some(
    (c) => c.startsWith('net:host/') && hostMatches(c.slice('net:host/'.length), host),
  )
}
