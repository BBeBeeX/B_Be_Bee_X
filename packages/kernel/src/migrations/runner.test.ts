import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Migration, SqlValue } from '@BBeBee/protocol'
import {
  MigrationError,
  MigrationRunner,
  NamespaceCollisionError,
  expandNs,
  nsPrefix,
} from './runner.js'
import { CORE_MIGRATIONS } from './core.js'

/**
 * A real SQLite database, not a fake.
 *
 * `node:sqlite` ships with Node 22+, which is also what Electron 44 bundles —
 * so this is the same engine `core-db-node` will use in production, and these
 * tests genuinely validate the SQL rather than a mock's idea of it.
 */
function memoryDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')

  const base = {
    async exec(sql: string, params: SqlValue[] = []) {
      const stmt = db.prepare(sql)
      const r = stmt.run(...(params as never[]))
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    },
    async query<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[]
    },
  }

  return {
    db,
    ...base,
    // BEGIN IMMEDIATE takes the write lock up front rather than upgrading
    // mid-transaction, which is what `core-db-node` will do.
    async transaction<T>(fn: (tx: typeof base) => Promise<T>): Promise<T> {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(base)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

describe('nsPrefix', () => {
  it('turns a package id into a legible table prefix', () => {
    expect(nsPrefix('plugin:@BBeBee/plugin-scrobble')).toBe('plugin_bbebee_plugin_scrobble')
    expect(nsPrefix('core')).toBe('core')
  })

  it('is lossy: separators all fold to underscore', () => {
    // Readability was chosen over injectivity, so collisions ARE possible.
    // Uniqueness is enforced against schema_namespaces instead — see the
    // NamespaceCollisionError test below.
    expect(nsPrefix('plugin:a-b')).toBe('plugin_a_b')
    expect(nsPrefix('plugin:a.b')).toBe('plugin_a_b')
    expect(nsPrefix('plugin:a_b')).toBe('plugin_a_b')
  })

  it('rejects a namespace with no usable characters', () => {
    expect(() => nsPrefix('!!!')).toThrow()
  })
})

describe('expandNs', () => {
  it('expands every occurrence', () => {
    expect(expandNs('CREATE TABLE {{ns}}_a; CREATE INDEX i ON {{ns}}_a(x)', 'plugin:foo')).toBe(
      'CREATE TABLE plugin_foo_a; CREATE INDEX i ON plugin_foo_a(x)',
    )
  })
})

describe('MigrationRunner', () => {
  let harness: ReturnType<typeof memoryDb>
  let runner: MigrationRunner

  beforeEach(() => {
    harness = memoryDb()
    runner = new MigrationRunner(harness)
  })

  it('applies pending migrations in version order', async () => {
    const order: number[] = []
    const migrations: Migration[] = [
      { version: 2, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
      { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
    ]
    const applied = await runner.apply('plugin:demo', migrations)
    expect(applied).toBe(2)
    expect(await runner.appliedVersions('plugin:demo')).toEqual([1, 2])
    void order
  })

  it('is idempotent — a second run applies nothing', async () => {
    const migrations: Migration[] = [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }]
    expect(await runner.apply('plugin:demo', migrations)).toBe(1)
    // Would throw "table already exists" if it re-ran.
    expect(await runner.apply('plugin:demo', migrations)).toBe(0)
  })

  it('applies only what is new when a migration is added later', async () => {
    await runner.apply('plugin:demo', [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }])
    const added = await runner.apply('plugin:demo', [
      { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
      { version: 2, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
    ])
    expect(added).toBe(1)
  })

  it('keeps namespaces independent', async () => {
    await runner.apply('plugin:a', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await runner.apply('plugin:b', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    // Same logical table name, two real tables, no collision.
    const tables = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'plugin_%'`,
    )
    expect(tables.map((t) => t.name).sort()).toEqual(['plugin_a_t', 'plugin_b_t'])
  })

  it('wraps a failing migration with its namespace and version', async () => {
    await expect(
      runner.apply('plugin:demo', [{ version: 1, up: 'THIS IS NOT SQL' }]),
    ).rejects.toThrow(MigrationError)
  })

  it('does not record a version whose migration failed', async () => {
    await runner.apply('plugin:demo', [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }])
    await expect(
      runner.apply('plugin:demo', [
        { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
        { version: 2, up: 'NOT SQL' },
      ]),
    ).rejects.toThrow(MigrationError)
    expect(await runner.appliedVersions('plugin:demo')).toEqual([1])
  })

  it('refuses a multi-statement `up` instead of applying half of it', async () => {
    // The driver compiles the first statement and discards the rest in
    // silence, so this migration would create `_a`, record version 1 as
    // applied, and leave the schema permanently short of `_b` with no error
    // to investigate. `up` takes an array precisely so this is expressible.
    await expect(
      runner.apply('plugin:demo', [
        { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT); CREATE TABLE {{ns}}_b (id TEXT)' },
      ]),
    ).rejects.toThrow(MigrationError)

    expect(await runner.appliedVersions('plugin:demo')).toEqual([])
    const tables = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'plugin_demo_%'`,
    )
    expect(tables, 'nothing may have run').toEqual([])

    // The same statements as an array apply normally.
    await runner.apply('plugin:demo', [
      { version: 1, up: ['CREATE TABLE {{ns}}_a (id TEXT)', 'CREATE TABLE {{ns}}_b (id TEXT)'] },
    ])
    expect(await runner.appliedVersions('plugin:demo')).toEqual([1])
  })

  it('rolls back a partially-applied migration so the next boot can retry', async () => {
    // THE regression test for the worst failure mode: without a transaction,
    // statement 1 committed and the bookkeeping row did not, so every
    // subsequent boot re-ran CREATE TABLE into "already exists" — a
    // permanently unbootable database.
    await expect(
      runner.apply('plugin:demo', [
        {
          version: 1,
          up: ['CREATE TABLE {{ns}}_ok (id TEXT)', 'THIS STATEMENT FAILS'],
        },
      ]),
    ).rejects.toThrow(MigrationError)

    // The first statement must have been rolled back.
    const tables = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'plugin_demo_ok'`,
    )
    expect(tables, 'partial migration was not rolled back').toHaveLength(0)

    // …so a corrected migration applies cleanly on the next attempt.
    const applied = await runner.apply('plugin:demo', [
      { version: 1, up: ['CREATE TABLE {{ns}}_ok (id TEXT)', "SELECT 'now valid'"] },
    ])
    expect(applied).toBe(1)
  })

  it('refuses a namespace whose prefix another namespace already owns', async () => {
    // nsPrefix is lossy: 'plugin:a-b' and 'plugin:a.b' both yield
    // 'plugin_a_b'. Without this check they would silently share tables.
    await runner.apply('plugin:a-b', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await expect(
      runner.apply('plugin:a.b', [{ version: 1, up: 'CREATE TABLE {{ns}}_u (id TEXT)' }]),
    ).rejects.toThrow(NamespaceCollisionError)
  })

  it('rejects duplicate versions within one array', async () => {
    // Both would enter `pending`; the second executes its statements and only
    // then fails on the PK conflict — the H1 shape again.
    await expect(
      runner.apply('plugin:demo', [
        { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
        { version: 1, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
      ]),
    ).rejects.toThrow(/more than once/)
  })

  it('refuses to run against a newer schema rather than rolling back', async () => {
    // Simulates downgrading the app: the database knows v2, this build does not.
    await runner.apply('plugin:demo', [
      { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
      { version: 2, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
    ])
    await expect(
      runner.apply('plugin:demo', [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }]),
    ).rejects.toThrow(/newer schema/)
  })

  it('dropNamespace removes exactly that plugin\'s tables', async () => {
    await runner.apply('plugin:a', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await runner.apply('plugin:b', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])

    const dropped = await runner.dropNamespace('plugin:a')
    expect(dropped).toEqual(['plugin_a_t'])
    expect(await runner.appliedVersions('plugin:a')).toEqual([])
    // The other plugin is untouched.
    expect(await runner.appliedVersions('plugin:b')).toEqual([1])
  })

  it('dropNamespace does not match a longer prefix through the LIKE wildcard', async () => {
    // `_` is a single-character wildcard in LIKE, so an unescaped
    // `plugin_a_%` also matches `plugin_ax_t` — dropping an unrelated
    // plugin's tables. Cross-plugin data loss on uninstall.
    await runner.apply('plugin:a', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await runner.apply('plugin:ax', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])

    const dropped = await runner.dropNamespace('plugin:a')
    expect(dropped).toEqual(['plugin_a_t'])

    const survivors = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'plugin_ax_t'`,
    )
    expect(survivors, "neighbouring plugin's table was dropped").toHaveLength(1)
  })

  it('dropNamespace tolerates foreign keys between a plugin\'s own tables', async () => {
    // With PRAGMA foreign_keys = ON (which the docs require), dropping a
    // parent before its child would trip a constraint violation.
    await runner.apply('plugin:fk', [
      {
        version: 1,
        up: [
          'CREATE TABLE {{ns}}_parent (id TEXT PRIMARY KEY)',
          'CREATE TABLE {{ns}}_child (id TEXT PRIMARY KEY, p TEXT REFERENCES {{ns}}_parent(id))',
        ],
      },
    ])
    await harness.exec(`INSERT INTO plugin_fk_parent (id) VALUES ('a')`)
    await harness.exec(`INSERT INTO plugin_fk_child (id, p) VALUES ('c', 'a')`)

    const dropped = await runner.dropNamespace('plugin:fk')
    expect(dropped.sort()).toEqual(['plugin_fk_child', 'plugin_fk_parent'])
  })
})

describe('CORE_MIGRATIONS', () => {
  it('applies cleanly against real SQLite', async () => {
    const harness = memoryDb()
    const runner = new MigrationRunner(harness)
    const applied = await runner.apply('core', CORE_MIGRATIONS)
    expect(applied).toBe(CORE_MIGRATIONS.length)
  })

  it('creates every table documented in docs/07-data-model.md §4', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    const rows = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%'`,
    )
    const tables = new Set(rows.map((r) => r.name))

    for (const expected of [
      'providers', 'accounts', 'cookie_jars', 'artworks',
      'artists', 'albums', 'tracks', 'track_artists', 'album_artists',
      'genres', 'track_genres', 'external_ids', 'track_links',
      'media_bindings', 'scan_roots', 'scan_entries',
      'playlists', 'playlist_items', 'library_items', 'collections', 'collection_items',
      'queue_items', 'playback_state', 'play_history', 'track_stats',
      'download_tasks', 'download_policies',
      'effect_chains', 'effect_nodes', 'presets', 'settings',
      'plugin_records', 'capability_grants', 'lyrics', 'cache_entries',
      'tracks_fts',
    ]) {
      expect(tables, `missing table: ${expected}`).toContain(expected)
    }
  })

  it('enforces the track_links canonical-order constraint', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    // The CHECK is what keeps the relation symmetric without storing it twice.
    await expect(
      harness.exec(
        'INSERT INTO track_links (urn_a, urn_b, confidence, method, created_at) VALUES (?,?,?,?,?)',
        ['BBeBee:z:track:2', 'BBeBee:a:track:1', 1.0, 'isrc', Date.now()],
      ),
    ).rejects.toThrow()
  })

  it('allows only one active effect chain per scope', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    const insert = (id: string, active: number) =>
      harness.exec(
        'INSERT INTO effect_chains (id, name, is_active, scope, created_at) VALUES (?,?,?,?,?)',
        [id, id, active, 'global', Date.now()],
      )
    await insert('a', 1)
    await expect(insert('b', 1)).rejects.toThrow()
    // An inactive one alongside is fine.
    await expect(insert('c', 0)).resolves.toBeDefined()
  })

  it('allows only one in-flight download per track', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    const insert = (id: string, state: string) =>
      harness.exec(
        `INSERT INTO download_tasks (id, track_urn, target_uri, state, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`,
        [id, 'BBeBee:nas:track:1', `file:///${id}`, state, Date.now(), Date.now()],
      )
    await insert('t1', 'running')
    await expect(insert('t2', 'queued')).rejects.toThrow()
    // Once done, the partial index no longer covers it, so a re-download is allowed.
    await harness.exec(`UPDATE download_tasks SET state='done' WHERE id='t1'`)
    await expect(insert('t3', 'queued')).resolves.toBeDefined()
  })

  it('cascades provider deletion to its catalogue rows', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await harness.exec(
      'INSERT INTO providers (instance_id, plugin_id, display_name, created_at) VALUES (?,?,?,?)',
      ['nas', '@BBeBee/plugin-source-jellyfin', 'NAS', Date.now()],
    )
    await harness.exec(
      `INSERT INTO tracks (urn, instance_id, remote_id, title, fetched_at) VALUES (?,?,?,?,?)`,
      ['BBeBee:nas:track:1', 'nas', '1', 'Song', Date.now()],
    )
    await harness.exec('DELETE FROM providers WHERE instance_id = ?', ['nas'])

    const left = await harness.query('SELECT urn FROM tracks')
    expect(left).toHaveLength(0)
  })

  it('supports diacritic-folded full-text search', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (1, ?, ?, ?)`,
      ['Jóga', 'Björk', 'Homogenic'],
    )
    // A user typing "bjork" must find "Björk".
    const hits = await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'bjork'`)
    expect(hits).toHaveLength(1)
  })

  it('allows the search index to be updated and pruned', async () => {
    // A plain `content=''` FTS5 table cannot be DELETEd from or UPDATEd —
    // "cannot DELETE from contentless fts5 table". Without contentless_delete
    // a renamed or deleted track keeps its index row forever and searches
    // return stale hits with no way to remove them short of a full rebuild.
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (1, ?, ?, ?)`,
      ['Old Title', 'Artist', 'Album'],
    )

    // Re-index as delete + insert. A contentless-delete table rejects an
    // UPDATE that sets only some columns ("cannot UPDATE a subset of columns
    // on fts5 contentless-delete table"), so callers must always rewrite the
    // whole row — which delete + insert makes explicit.
    await harness.exec(`DELETE FROM tracks_fts WHERE rowid = 1`)
    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (1, ?, ?, ?)`,
      ['New Title', 'Artist', 'Album'],
    )
    expect(
      await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'New'`),
    ).toHaveLength(1)
    expect(
      await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'Old'`),
      'stale term still matches after re-index',
    ).toHaveLength(0)

    await harness.exec(`DELETE FROM tracks_fts WHERE rowid = 1`)
    expect(
      await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'New'`),
      'deleted track still in the index',
    ).toHaveLength(0)
  })

  it('maps FTS rowids to track urns', async () => {
    // FTS5 addresses rows by integer rowid; the catalogue is keyed by URN.
    // Without the mapping there is no way to re-index or remove one track.
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await harness.exec(
      'INSERT INTO providers (instance_id, plugin_id, display_name, created_at) VALUES (?,?,?,?)',
      ['nas', 'p', 'NAS', Date.now()],
    )
    await harness.exec(
      `INSERT INTO tracks (urn, instance_id, remote_id, title, fetched_at) VALUES (?,?,?,?,?)`,
      ['BBeBee:nas:track:1', 'nas', '1', 'Jóga', Date.now()],
    )
    const { lastInsertRowid } = await harness.exec(
      'INSERT INTO tracks_fts_map (urn) VALUES (?)',
      ['BBeBee:nas:track:1'],
    )
    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (?, ?, ?, ?)`,
      [lastInsertRowid, 'Jóga', 'Björk', 'Homogenic'],
    )

    const found = await harness.query<{ urn: string }>(
      `SELECT m.urn FROM tracks_fts f
       JOIN tracks_fts_map m ON m.rowid = f.rowid
       WHERE tracks_fts MATCH 'bjork'`,
    )
    expect(found.map((f) => f.urn)).toEqual(['BBeBee:nas:track:1'])

    // Deleting the track cascades the mapping, so a stale row cannot linger.
    await harness.exec('DELETE FROM tracks WHERE urn = ?', ['BBeBee:nas:track:1'])
    expect(await harness.query('SELECT rowid FROM tracks_fts_map')).toHaveLength(0)
  })
})
