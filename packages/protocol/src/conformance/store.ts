/**
 * Conformance suite for `ctx.store` — the namespaced key/value service.
 *
 * Small surface, but the namespace isolation check matters: plugins receive a
 * pre-namespaced store and must not be able to read each other's settings.
 */

import type { StoreService } from '../index.js'
import { assert, assertEqual, type ConformanceSuite } from './harness.js'

export interface StoreSubject {
  store: StoreService
}

export const storeConformance: ConformanceSuite<StoreSubject> = {
  service: 'store',
  checks: [
    {
      name: 'round-trips values of each JSON type',
      because: 'settings hold strings, numbers, booleans, arrays, and objects',
      async run({ store }) {
        const values: Record<string, unknown> = {
          s: 'text',
          n: 42,
          f: 1.5,
          b: true,
          arr: [1, 'two', false],
          obj: { nested: { deep: true } },
          nul: null,
        }
        for (const [k, v] of Object.entries(values)) {
          await store.set(k, v)
          assertEqual(await store.get(k), v, `round-trip ${k}`)
        }
      },
    },
    {
      name: 'returns undefined for a missing key',
      because: 'callers distinguish "unset" from "set to null"',
      async run({ store }) {
        assert((await store.get('never-written')) === undefined, 'missing key is undefined')
        await store.set('explicit-null', null)
        assertEqual(await store.get('explicit-null'), null, 'null is preserved')
      },
    },
    {
      name: 'overwrites an existing key',
      because: 'every settings write is an overwrite',
      async run({ store }) {
        await store.set('k', 'first')
        await store.set('k', 'second')
        assertEqual(await store.get('k'), 'second', 'overwritten')
      },
    },
    {
      name: 'delete removes a key',
      because: '"reset to default" is implemented as a delete',
      async run({ store }) {
        await store.set('doomed', 1)
        await store.delete('doomed')
        assert((await store.get('doomed')) === undefined, 'deleted')
      },
    },
    {
      name: 'delete of a missing key is not an error',
      because: 'reset must be idempotent',
      async run({ store }) {
        await store.delete('never-existed')
      },
    },
    {
      name: 'keys() honours a prefix filter',
      because: 'settings pages enumerate one plugin at a time',
      async run({ store }) {
        await store.set('a:one', 1)
        await store.set('a:two', 2)
        await store.set('b:three', 3)
        const found = (await store.keys('a:')).sort()
        assertEqual(found, ['a:one', 'a:two'], 'prefix filter')
      },
    },
    {
      name: 'namespaces are isolated',
      because: 'a plugin must not read another plugin settings',
      async run({ store }) {
        const a = store.namespace('plugin-a')
        const b = store.namespace('plugin-b')
        await a.set('shared-key', 'from-a')
        await b.set('shared-key', 'from-b')
        assertEqual(await a.get('shared-key'), 'from-a', 'namespace a')
        assertEqual(await b.get('shared-key'), 'from-b', 'namespace b')
      },
    },
    {
      name: 'a namespaced keys() does not leak the parent',
      because: 'enumeration must respect the same boundary as reads',
      async run({ store }) {
        await store.set('root-level', 1)
        const ns = store.namespace('scoped')
        await ns.set('inner', 2)
        assert(!(await ns.keys()).includes('root-level'), 'parent key leaked into namespace')
      },
    },
  ],
}
