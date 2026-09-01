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
import { nsPrefix as nsPrefixOf } from './migrations/runner.js'
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

/* ── db ─────────────────────────────────────────────────────────────────── */

/** Table names a plugin may reach with `db:own`, given its namespace prefix. */
function ownTablePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_`, 'i')
}

/**
 * Identifiers a SQL statement touches.
 *
 * Deliberately crude — a regex over the shapes SQLite actually uses, not a
 * parser. It exists to make `db:own` mean something rather than nothing, and
 * it fails *closed*: anything it cannot confidently attribute is treated as a
 * foreign table and refused.
 */
export function tablesReferenced(sql: string): string[] {
  const names = new Set<string>()
  const pattern =
    /\b(?:FROM|JOIN|INTO|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\w+\s+ON)\s+["'`[]?([A-Za-z_][\w$]*)/gi
  for (const match of sql.matchAll(pattern)) {
    if (match[1]) names.add(match[1])
  }
  return [...names]
}

/** Statements a plugin may never issue, whatever it was granted. */
const DB_FORBIDDEN = /^\s*(ATTACH|DETACH|VACUUM\s+INTO)\b/i

/**
 * Bookkeeping the kernel touches *on a plugin's behalf*.
 *
 * `defineSchema` records applied versions and prefix ownership, and reads
 * `sqlite_master` to enumerate a namespace's tables. Gating these would break
 * the very mechanism that gives a plugin its own schema. A plugin can only
 * corrupt its own migration record this way, which harms nobody else.
 */
const KERNEL_TABLES = new Set([
  'schema_migrations',
  'schema_namespaces',
  'sqlite_master',
  'sqlite_sequence',
])

/**
 * How much a statement asks of a table.
 *
 *   read    SELECT and friends
 *   write   INSERT / UPDATE / DELETE / REPLACE — the rows change
 *   schema  CREATE / DROP / ALTER — the table itself changes
 *
 * `schema` is its own class rather than a kind of `write` because dropping the
 * catalogue and updating a row in it are not the same request, and a grant
 * that cannot tell them apart cannot be prompted for honestly at install time.
 */
export type DbAccess = 'read' | 'write' | 'schema'

const ACCESS_BY_KEYWORD: Record<string, DbAccess> = {
  select: 'read',
  explain: 'read',
  values: 'read',
  insert: 'write',
  replace: 'write',
  update: 'write',
  delete: 'write',
  create: 'schema',
  drop: 'schema',
  alter: 'schema',
  reindex: 'schema',
  analyze: 'schema',
  vacuum: 'schema',
  pragma: 'schema',
}

const ACCESS_RANK: Record<DbAccess, number> = { read: 0, write: 1, schema: 2 }

/** Strip comments so the leading keyword is the first thing we see. */
function withoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * Classify what a statement asks for, taking the most demanding class in the
 * string when several statements are separated by `;`.
 *
 * Like `tablesReferenced`, this is a regex over the shapes SQLite uses rather
 * than a parser, and it fails *closed* in both directions that matter:
 *
 *  - `SELECT 1; DROP TABLE tracks` is classified `schema`, not `read`, so a
 *    second statement cannot ride in on the first one's grant.
 *  - A string containing what looks like a statement boundary
 *    (`INSERT INTO t VALUES ('a; DROP TABLE x')`) is classified by the more
 *    demanding half. That refuses a legitimate statement rather than
 *    permitting an illegitimate one, which is the right direction to be wrong
 *    in — and parameter binding means such literals are rare in practice.
 *  - Nothing recognisable at all is `schema`, the most demanding class.
 */
export function classifyDbAccess(sql: string): DbAccess {
  let rank = -1
  for (const fragment of withoutComments(sql).split(';')) {
    const keyword = /^\s*([A-Za-z]+)/.exec(fragment)?.[1]?.toLowerCase()
    if (!keyword) continue
    // A CTE may front any of SELECT / INSERT / UPDATE / DELETE.
    const access =
      keyword === 'with'
        ? /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(fragment)
          ? 'write'
          : 'read'
        : ACCESS_BY_KEYWORD[keyword]
    if (!access) continue
    rank = Math.max(rank, ACCESS_RANK[access])
  }
  if (rank < 0) return 'schema'
  return (['read', 'write', 'schema'] as const)[rank]!
}

/**
 * The namespaces a grant set opens, and what may be done in each.
 *
 *   db:read:<ns>    SELECT
 *   db:write:<ns>   INSERT / UPDATE / DELETE
 *   db:*:<ns>       everything, schema changes included
 *
 * `write` deliberately does **not** imply `read`: a plugin that both reads and
 * writes the catalogue declares both, which keeps `db:*:<ns>` meaningful and
 * keeps the install-time prompt specific. `db:own` is separate and total —
 * a plugin owns its own tables outright.
 */
function parseDbGrants(granted: readonly string[]): Map<string, Set<DbAccess>> {
  const namespaces = new Map<string, Set<DbAccess>>()
  for (const grant of granted) {
    if (!grant.startsWith('db:') || grant === 'db:own') continue
    const rest = grant.slice('db:'.length)
    const sep = rest.indexOf(':')
    if (sep <= 0) continue
    const verb = rest.slice(0, sep).toLowerCase()
    const ns = rest.slice(sep + 1).toLowerCase()
    if (!ns) continue

    const allowed = namespaces.get(ns) ?? new Set<DbAccess>()
    if (verb === 'read') allowed.add('read')
    else if (verb === 'write') allowed.add('write')
    else if (verb === '*') {
      allowed.add('read')
      allowed.add('write')
      allowed.add('schema')
    } else continue // an unknown verb grants nothing
    namespaces.set(ns, allowed)
  }
  return namespaces
}

/**
 * Which grant, if any, covers a table.
 *
 * `core` is the fallback rather than a prefix match: the catalogue's tables
 * carry no prefix, so anything that is not a `plugin_` table belongs to it.
 */
function grantFor(
  table: string,
  grants: Map<string, Set<DbAccess>>,
): { ns: string; allowed: Set<DbAccess> } | undefined {
  const lower = table.toLowerCase()
  for (const [ns, allowed] of grants) {
    if (ns === 'core') continue
    if (lower === ns || lower.startsWith(`${ns}_`)) return { ns, allowed }
  }
  const core = grants.get('core')
  if (core && !lower.startsWith('plugin_')) return { ns: 'core', allowed: core }
  return undefined
}

/** The capability a refused statement would have needed. */
function capabilityFor(access: DbAccess, ns: string): string {
  return access === 'schema' ? `db:*:${ns}` : `db:${access}:${ns}`
}

const ACCESS_VERB: Record<DbAccess, string> = {
  read: 'read',
  write: 'write to',
  schema: 'change the schema of',
}

/**
 * The table prefix a caller owns, derived from its instance id.
 *
 * Every `ctx.db` implementation must derive it the same way, or the gate means
 * different things on different platforms — which is exactly how the desktop
 * path ended up with no gate at all while the in-process one had one.
 */
export function ownNamespaceOf(gate: CapabilityConfig): string {
  return `plugin:${gate.instanceId}`
}

/**
 * Gate a statement for whoever is calling. The entry point every `DbService`
 * implementation uses, so none of them has to re-derive the prefix.
 */
export function assertDbForCaller(config: unknown, sql: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  assertDb(config, sql, nsPrefixOf(ownNamespaceOf(gate)))
}

/**
 * A plugin may only define schema for its own namespace — otherwise it could
 * claim `core` and own the catalogue.
 */
export function assertOwnNamespace(config: unknown, namespace: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return
  const mine = ownNamespaceOf(gate)
  if (namespace !== mine) {
    throw new CapabilityError(
      'db:own',
      `${gate.pluginId} may only define schema for ${JSON.stringify(mine)}, not ` +
        JSON.stringify(namespace),
    )
  }
}

/**
 * Enforce the `db:` grants against one statement.
 *
 * A plugin may always use its own namespaced tables (`db:own`). Every other
 * table needs a grant naming its namespace *and* covering what the statement
 * does — `db:read:core` no longer carries an `INSERT`, which is the whole
 * point of separating the verbs.
 *
 * ⚠️ Regex-based, so this is a guard rail rather than a parser: it stops the
 * ordinary mistake and the casual overreach, not a determined author who
 * shares the runtime anyway (docs/03 §7).
 */
export function assertDb(config: unknown, sql: string, ownPrefix: string): void {
  const gate = capabilityConfigOf(config)
  if (!gate) return

  if (DB_FORBIDDEN.test(sql)) {
    throw new CapabilityError('db', `${gate.pluginId} may not issue ${sql.trim().split(/\s+/)[0]}`)
  }

  const grants = parseDbGrants(gate.granted)
  const access = classifyDbAccess(sql)
  const hasOwn = gate.granted.includes('db:own')
  const own = ownTablePattern(ownPrefix)

  for (const table of tablesReferenced(sql)) {
    if (KERNEL_TABLES.has(table.toLowerCase())) continue
    if (hasOwn && own.test(table)) continue

    const grant = grantFor(table, grants)
    if (!grant) {
      throw new CapabilityError(
        'db:own',
        `${gate.pluginId} may not touch table "${table}" — it is outside its own namespace`,
      )
    }
    if (!grant.allowed.has(access)) {
      throw new CapabilityError(
        capabilityFor(access, grant.ns),
        `${gate.pluginId} may not ${ACCESS_VERB[access]} table "${table}" — ` +
          `${capabilityFor(access, grant.ns)} is not granted`,
      )
    }
  }
}
