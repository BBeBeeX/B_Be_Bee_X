/**
 * Forward-only, namespaced migrations.
 *
 * Used by every `core-db-*` implementation to satisfy `DbService.defineSchema`,
 * so the semantics are identical on both platforms rather than reimplemented.
 *
 * See docs/07-data-model.md §6.
 */

import type { Migration, SqlValue } from '@BBeBee/protocol'

/** The slice of `DbService` a migration needs. Avoids a circular dependency. */
export interface MigrationTx {
  exec(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowid: number }>
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
}

export interface MigrationDb extends MigrationTx {
  /**
   * Run `fn` atomically. Required, not optional: without it a migration that
   * fails partway leaves tables created but the version unrecorded, and the
   * next boot re-runs it into "table already exists" — permanently unbootable.
   */
  transaction<T>(fn: (tx: MigrationTx) => Promise<T>): Promise<T>
}

export const CORE_NAMESPACE = 'core'

export const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  namespace  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, version)
)`

/**
 * Records which namespace owns which table prefix.
 *
 * `nsPrefix` is lossy — it folds `-`, `.`, and `_` to `_`, so `plugin:a-b` and
 * `plugin:a.b` both yield `plugin_a_b`. Two such plugins would silently share
 * tables, so the mapping is registered and a collision is refused up front.
 */
export const NAMESPACES_TABLE = `
CREATE TABLE IF NOT EXISTS schema_namespaces (
  prefix    TEXT PRIMARY KEY,
  namespace TEXT NOT NULL
)`

/**
 * Turn a namespace into a table prefix.
 *
 * `plugin:@BBeBee/plugin-scrobble` becomes `plugin_bbebee_plugin_scrobble`, so
 * ownership is legible when reading the schema.
 *
 * ⚠️ Lossy by design (readability beats injectivity here). Uniqueness is
 * enforced separately against `schema_namespaces` — see `assertPrefixOwner`.
 */
export function nsPrefix(namespace: string): string {
  const slug = namespace
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) throw new Error(`namespace ${JSON.stringify(namespace)} produces an empty prefix`)
  return slug
}

/** Expand `{{ns}}` placeholders in a statement. */
export function expandNs(sql: string, namespace: string): string {
  return sql.replaceAll('{{ns}}', nsPrefix(namespace))
}

/** Escape a value for use in a `LIKE ... ESCAPE '\'` pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError'
  constructor(
    readonly namespace: string,
    readonly version: number,
    override readonly cause: unknown,
  ) {
    super(`migration ${namespace}@${version} failed: ${String(cause)}`)
  }
}

export class NamespaceCollisionError extends Error {
  override readonly name = 'NamespaceCollisionError'
  constructor(
    readonly namespace: string,
    readonly owner: string,
    readonly prefix: string,
  ) {
    super(
      `namespace ${JSON.stringify(namespace)} maps to table prefix ${JSON.stringify(prefix)}, ` +
        `which is already owned by ${JSON.stringify(owner)}`,
    )
  }
}

export class MigrationRunner {
  constructor(private readonly db: MigrationDb) {}

  async init(): Promise<void> {
    await this.db.exec(MIGRATIONS_TABLE)
    await this.db.exec(NAMESPACES_TABLE)
  }

  async appliedVersions(namespace: string): Promise<number[]> {
    const rows = await this.db.query<{ version: number }>(
      'SELECT version FROM schema_migrations WHERE namespace = ? ORDER BY version',
      [namespace],
    )
    return rows.map((r) => Number(r.version))
  }

  /** Claim the prefix for this namespace, or throw if another owns it. */
  private async assertPrefixOwner(namespace: string): Promise<string> {
    const prefix = nsPrefix(namespace)
    const existing = await this.db.query<{ namespace: string }>(
      'SELECT namespace FROM schema_namespaces WHERE prefix = ?',
      [prefix],
    )
    const owner = existing[0]?.namespace
    if (owner === undefined) {
      await this.db.exec('INSERT INTO schema_namespaces (prefix, namespace) VALUES (?, ?)', [
        prefix,
        namespace,
      ])
    } else if (owner !== namespace) {
      throw new NamespaceCollisionError(namespace, owner, prefix)
    }
    return prefix
  }

  /**
   * Apply every migration not yet recorded, in version order.
   *
   * Each migration's statements and its bookkeeping row commit **together**, so
   * an interruption leaves the database exactly at a version boundary.
   */
  async apply(namespace: string, migrations: Migration[]): Promise<number> {
    await this.init()
    await this.assertPrefixOwner(namespace)

    const seen = new Set<number>()
    for (const m of migrations) {
      if (seen.has(m.version)) {
        // Would otherwise half-apply: the first records the version, the second
        // executes its statements and then fails on the primary-key conflict.
        throw new Error(`namespace ${namespace} declares version ${m.version} more than once`)
      }
      seen.add(m.version)
    }

    const applied = new Set(await this.appliedVersions(namespace))
    for (const v of applied) {
      if (!seen.has(v)) {
        // The database is ahead of the code — a downgrade. Refuse rather than
        // attempt a rollback; a half-applied downgrade is worse than a clear
        // failure. See docs/07 §6.
        throw new Error(
          `database has ${namespace}@${v} applied but this build declares only ` +
            `[${[...seen].sort((a, b) => a - b).join(', ')}]; refusing to run against a ` +
            `newer schema (downgrade unsupported)`,
        )
      }
    }

    const pending = [...migrations]
      .sort((a, b) => a.version - b.version)
      .filter((m) => !applied.has(m.version))

    for (const migration of pending) {
      const statements = (Array.isArray(migration.up) ? migration.up : [migration.up]).map((s) =>
        expandNs(s, namespace),
      )

      try {
        await this.db.transaction(async (tx) => {
          for (const sql of statements) {
            await tx.exec(sql)
          }
          await tx.exec(
            'INSERT INTO schema_migrations (namespace, version, applied_at) VALUES (?, ?, ?)',
            [namespace, migration.version, Date.now()],
          )
        })
      } catch (cause) {
        throw new MigrationError(namespace, migration.version, cause)
      }
    }

    return pending.length
  }

  /**
   * Drop every table belonging to a namespace, plus its bookkeeping rows.
   *
   * Called on uninstall when the user chooses "remove data". Defaulting to
   * *keep* is the safer choice, so this is never automatic.
   */
  async dropNamespace(namespace: string): Promise<string[]> {
    await this.init()
    const prefix = nsPrefix(namespace)

    // `_` is a single-character wildcard in LIKE, so an unescaped
    // `plugin_a_%` also matches `plugin_ax_t` — another plugin's tables.
    const rows = await this.db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ESCAPE '\\'`,
      [`${escapeLike(prefix)}\\_%`],
    )
    // Belt and braces: never trust the pattern alone for a destructive op.
    const tables = rows.map((r) => r.name).filter((name) => name.startsWith(`${prefix}_`))

    await this.db.transaction(async (tx) => {
      // Plugin tables may reference each other; dropping a parent first would
      // trip an FK violation under the `PRAGMA foreign_keys = ON` the docs
      // require. Deferring moves enforcement to commit, by which point every
      // table in the set is gone.
      await tx.exec('PRAGMA defer_foreign_keys = ON')
      for (const name of tables) {
        // Identifier, not a value — quoted rather than bound. `name` came from
        // sqlite_master and passed the startsWith guard above.
        await tx.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`)
      }
      await tx.exec('DELETE FROM schema_migrations WHERE namespace = ?', [namespace])
      await tx.exec('DELETE FROM schema_namespaces WHERE namespace = ?', [namespace])
    })

    return tables
  }
}
