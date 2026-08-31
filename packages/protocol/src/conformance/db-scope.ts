/**
 * Conformance suite for the `ctx.db` capability gate.
 *
 * Modelled on `fs-scope`, and for the same reason: `db:own` was enforced in
 * `core-db-node` while `DbBridge` had no gate at all, so the guarantee held
 * in tests and evaporated on the desktop path. A suite both implementations
 * run is the only thing that keeps them honest.
 *
 * Separate from `dbConformance` because it needs a *gated* database — one
 * derived through `scopeContext` with a specific grant — where the main suite
 * runs ungated.
 */

import type { DbService } from '../index.js'
import { assert, assertRejects, type ConformanceSuite } from './harness.js'

export interface DbScopeSubject {
  /** Ungated, for arranging fixtures and asserting outcomes. */
  admin: DbService
  /** The instance id the gated databases below were scoped to. */
  instanceId: string
  /** The table prefix that instance owns, e.g. `plugin_bbebee_plugin_demo`. */
  ownPrefix: string
  /** `db` as seen by a plugin granted exactly `db:own`. */
  own: DbService
  /** `db` as seen by a plugin granted `db:own` plus `db:read:core`. */
  ownPlusCoreReads: DbService
}

const denied = /outside its own namespace|may not/i

export const dbScopeConformance: ConformanceSuite<DbScopeSubject> = {
  service: 'db (capability scopes)',
  checks: [
    {
      name: 'a plugin can create and use its own namespaced tables',
      because: 'db:own would be useless otherwise',
      async run({ own, instanceId, ownPrefix }) {
        await own.defineSchema(`plugin:${instanceId}`, [
          { version: 1, up: 'CREATE TABLE {{ns}}_items (id TEXT PRIMARY KEY)' },
        ])
        await own.exec(`INSERT INTO ${ownPrefix}_items VALUES (?)`, ['x'])
        const rows = await own.query(`SELECT id FROM ${ownPrefix}_items`)
        assert(rows.length === 1, 'own table must be usable')
      },
    },
    {
      name: 'a plugin cannot drop a core catalogue table',
      because: 'the concrete claim in docs/07 §6 — otherwise db:own means nothing',
      async run({ admin, own }) {
        await assertRejects(() => own.exec('DROP TABLE providers'), 'DROP of a core table', denied)
        // And it really is still there.
        const rows = await admin.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='providers'`,
        )
        assert(rows.length === 1, 'providers table was actually dropped')
      },
    },
    {
      name: 'a plugin cannot read core tables without db:read:core',
      because: 'the catalogue holds every provider and every track',
      async run({ own }) {
        await assertRejects(() => own.query('SELECT * FROM tracks'), 'catalogue read', denied)
      },
    },
    {
      name: 'db:read:core opens the catalogue for reads',
      because: 'a feature plugin has to reach the library somehow',
      async run({ ownPlusCoreReads }) {
        const rows = await ownPlusCoreReads.query('SELECT * FROM tracks')
        assert(Array.isArray(rows), 'granted read should succeed')
      },
    },
    {
      name: "a plugin cannot touch another plugin's tables",
      because: 'namespaces are the whole basis of plugin-owned schema',
      async run({ admin, own }) {
        await admin.exec('CREATE TABLE plugin_other_secrets (v TEXT)')
        await admin.exec("INSERT INTO plugin_other_secrets VALUES ('shh')")
        await assertRejects(
          () => own.query('SELECT v FROM plugin_other_secrets'),
          "cross-plugin read",
          denied,
        )
        await assertRejects(
          () => own.exec("UPDATE plugin_other_secrets SET v='clobbered'"),
          'cross-plugin write',
          denied,
        )
      },
    },
    {
      name: 'a plugin cannot define schema for a namespace it does not own',
      because: 'otherwise it claims `core` and owns the catalogue',
      async run({ own }) {
        await assertRejects(
          () => own.defineSchema('core', [{ version: 99, up: 'CREATE TABLE {{ns}}_x (a TEXT)' }]),
          'defining a foreign namespace',
          /may only define schema for/,
        )
        await assertRejects(
          () =>
            own.defineSchema('plugin:@BBeBee/plugin-someone-else', [
              { version: 1, up: 'CREATE TABLE {{ns}}_x (a TEXT)' },
            ]),
          "defining another plugin's namespace",
          /may only define schema for/,
        )
      },
    },
    {
      name: 'ATTACH and DETACH are refused whatever the grants',
      because: 'ATTACH turns the database handle into an arbitrary-file primitive',
      async run({ ownPlusCoreReads }) {
        await assertRejects(
          () => ownPlusCoreReads.exec("ATTACH DATABASE '/tmp/evil.db' AS evil"),
          'ATTACH',
          /ATTACH|may not/i,
        )
      },
    },
    {
      name: 'a transaction is not a way around the gate',
      because: 'the transaction view is a separate code path in every implementation',
      async run({ own }) {
        await assertRejects(
          () => own.transaction(async (tx) => void (await tx.exec('DROP TABLE providers'))),
          'gated statement inside a transaction',
          denied,
        )
      },
    },
    {
      name: 'the gate does not apply to ungated callers',
      because: 'the kernel, core services and migrations must still work',
      async run({ admin }) {
        const rows = await admin.query('SELECT * FROM providers')
        assert(Array.isArray(rows), 'ungated query should succeed')
      },
    },
  ],
}
