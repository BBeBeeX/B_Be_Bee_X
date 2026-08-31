/**
 * Primitives shared by every contract in this package.
 *
 * Nothing here imports anything. That is deliberate: `@BBeBee/protocol` is
 * imported by headless plugins, by core services, by the kernel, and by both
 * UI shells, so it must be safe to load in any of them.
 *
 * See docs/04-core-services.md §0.
 */

/**
 * An abstract location. Never a raw filesystem path.
 *
 * Plugins never construct these by string concatenation — they ask
 * `ctx.fs` for a well-known directory and use `ctx.fs.join()`. That is what
 * lets the same code address `file:///…`, `content://…` (Android SAF), and
 * Expo's sandboxed document directory.
 */
export type Uri = string

/** A function that undoes whatever registered it. */
export interface Disposable {
  (): void
}

/** Directories the platform knows about, resolved via `ctx.paths` / `ctx.fs.dir()`. */
export type WellKnownDir =
  | 'data'
  | 'cache'
  | 'temp'
  | 'music'
  | 'downloads'
  | 'logs'

/**
 * A page of results.
 *
 * `cursor` is opaque and owned by whoever produced it — never parse or
 * synthesise one. `total` is optional because many backends genuinely do not
 * know, and inventing a number produces progress bars that lie.
 */
export interface Paged<T> {
  items: T[]
  cursor?: string
  total?: number
  hasMore: boolean
}

/**
 * Whether `uri` is `base` or lies inside it, respecting segment boundaries.
 *
 * A bare `uri.startsWith(base)` is wrong for containment: `…/BBeBee-backup`
 * starts with `…/BBeBee` without being inside it. That mistake in a capability
 * check reads as "this file is in your own directory" for a sibling directory
 * that is emphatically not, so this helper is the only correct way to ask.
 */
export function uriContains(base: Uri, uri: Uri): boolean {
  const root = base.endsWith('/') ? base.slice(0, -1) : base
  return uri === root || uri.startsWith(`${root}/`)
}

/**
 * The directory name for a plugin's private data.
 *
 * Sanitising alone is lossy — `plugin/x` and `plugin_x` both reduce to
 * `plugin_x` — and two plugins sharing a data directory is both a correctness
 * bug and, since the fs gate keys `own` on this path, a capability bug: each
 * would be inside the other's "own" scope.
 *
 * So the readable part is kept for legibility and a short hash of the *exact*
 * id is appended to make it injective. Unlike the database's namespace
 * registry there is nothing to collide against at registration time, so the
 * name has to carry the distinction itself.
 */
export function pluginDirName(pluginId: string): string {
  const readable = pluginId
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 48)
  return `${readable}-${shortHash(pluginId)}`
}

/**
 * A short, stable, non-cryptographic hash. FNV-1a over two lanes, 16 hex
 * chars — enough to separate the handful of plugin ids on one device.
 */
export function shortHash(value: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bf03635
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    a = Math.imul((a ^ code) >>> 0, 0x01000193) >>> 0
    b = Math.imul((b ^ (code + 1)) >>> 0, 0x01000193) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/** Raised when a plugin attempts something its manifest did not declare. */
export class CapabilityError extends Error {
  override readonly name = 'CapabilityError'
  constructor(
    readonly capability: string,
    message?: string,
  ) {
    super(message ?? `missing capability: ${capability}`)
  }
}

/** Raised when configuration fails its schema. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
  constructor(
    readonly pluginId: string,
    readonly issues: readonly string[],
  ) {
    super(`invalid config for ${pluginId}:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
  }
}
