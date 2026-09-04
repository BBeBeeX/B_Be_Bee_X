/**
 * `BBeBee.plugin.json` — the manifest, and the capability grammar.
 *
 * One format, one loader: plugins are statically bundled on every target
 * (ADR-1 as amended). What users add at runtime is a music **source string**,
 * which is data interpreted by `plugin-source-runtime`, not code handed to
 * `ctx.plugin()`. See docs/03-plugin-system.md §6–§7.
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
 *   db:own                               its own namespaced tables, outright
 *   db:read:<ns>                         SELECT within another namespace
 *   db:write:<ns>                        INSERT / UPDATE / DELETE there
 *   db:*:<ns>                            both, plus schema changes
 *   secrets:own                          own credential namespace (no `all`)
 *   js                                   may evaluate untrusted script
 *   audio | mediaSession | notify | shell | background
 *
 * The `db` verbs are deliberately separate rather than nested: `db:write:core`
 * does not imply `db:read:core`, so a plugin that does both says so, and an
 * install-time prompt can name exactly what it is asking for. `db:*:<ns>` is
 * the only grant that permits `CREATE`, `DROP` or `ALTER` on someone else's
 * tables.
 */
export type Capability =
  | `fs:read:${FsScope}`
  | `fs:write:${FsScope}`
  | `net:host/${string}`
  | 'db:own'
  | `db:read:${string}`
  | `db:write:${string}`
  | `db:*:${string}`
  | 'secrets:own'
  /**
   * May evaluate untrusted script in `ctx.js`. Held by
   * `plugin-source-runtime` and nothing else.
   *
   * The grant does not widen what the evaluated code can reach — that is
   * fixed by the host surface and the per-source egress allowlist. It makes
   * *who is allowed to run it* auditable.
   */
  | 'js'
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
  'js',
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
  /** Package id, e.g. '@BBeBee/plugin-source-runtime'. */
  id: string
  version: string
  displayName: string
  description?: string
  engines: { BBeBee: string }
  entry: PluginEntrypoints
  capabilities: Capability[]
  contributes?: PluginContributes
}

/* ── Capability matching ────────────────────────────────────────────────── */

/**
 * Which services a capability governs, or an empty array if it governs none.
 *
 * `net:host/…` governs both `http` and `ws` — one grant covers HTTP and
 * WebSocket to the same host, per docs/03 §7.
 */
/**
 * Whether a hostname is covered by an entry in a source's `allowedHosts`.
 *
 * Distinct from `hostMatches` above, which matches a `net:host/<glob>` grant.
 * This one governs the *second*, narrower list a source declares about itself
 * (docs/06 §8), and its rules differ deliberately:
 *
 *  - An entry covers itself and its subdomains, so `example.org` admits
 *    `cdn.example.org` — but never `notexample.org`, which a bare suffix
 *    comparison would wave through.
 *  - `*.example.org` is accepted as a synonym for subdomains only, because
 *    an author who writes it should not silently get a fail-closed source.
 *  - A single-label entry is **refused**. `allowedHosts: ["org"]` reads as a
 *    modest declaration and would mean "anywhere in .org"; `localhost` is the
 *    one exception, since it is a real host and a common self-hosted target.
 */
export function declaredHostMatches(host: string, declared: string): boolean {
  const entry = declared.trim().toLowerCase().replace(/\.$/, '')
  if (!entry) return false

  if (entry.startsWith('*.')) {
    const base = entry.slice(2)
    if (!base.includes('.') && base !== 'localhost') return false
    return host.endsWith(`.${base}`)
  }

  if (!entry.includes('.') && entry !== 'localhost') return false
  return host === entry || host.endsWith(`.${entry}`)
}

/** Whether any entry in a source's `allowedHosts` covers this host. */
export function hostAllowedBy(host: string, declared: readonly string[]): boolean {
  return declared.some((entry) => declaredHostMatches(host, entry))
}

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
