/**
 * `ctx.js` — the conformance suite.
 *
 * Two implementations exist (desktop and mobile QuickJS builds), and they must
 * be interchangeable in the places that are easy to get subtly different:
 * whether a realm survives a limit breach, whether `dispose()` throws on a
 * second call, and whether a script that awaits a host function ever resumes.
 *
 * The last one is the reason this suite exists. A QuickJS embedding that does
 * not pump the realm's job queue deadlocks on the first `await` — and nothing
 * simpler than an executable check catches it, because the code *looks* right.
 *
 * See docs/04-core-services.md §19 and services/js.ts.
 */

import type { JsService } from '../services/js.js'
import { assert, assertEqual, assertRejects, type ConformanceSuite } from './harness.js'

export interface JsSubject {
  js: JsService
}

export const jsConformance: ConformanceSuite<JsSubject> = {
  service: 'js',
  checks: [
    {
      name: 'evaluates an expression and returns its value',
      because: 'the floor: without this nothing else is worth checking',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          assertEqual(await realm.eval('1 + 1'), 2, 'arithmetic')
          assertEqual(await realm.eval('"a" + "b"'), 'ab', 'strings')
          assertEqual(await realm.eval('[1,2,3].map(n => n * 2)'), [2, 4, 6], 'arrays')
          assertEqual(await realm.eval('({ a: 1, b: [true, null] })'), { a: 1, b: [true, null] }, 'objects')
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'binds scope as globals',
      because: 'a jsLib helper declares at top level and a rule expects to see it there',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          assertEqual(await realm.eval('key + page', { key: 'x', page: 2 }), 'x2', 'scope')
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'has no ambient host reach',
      because: 'a realm that can fetch or read files is not a sandbox, whatever else it does',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          for (const name of ['fetch', 'require', 'process', 'XMLHttpRequest', 'importScripts']) {
            assertEqual(
              await realm.eval(`typeof ${name}`),
              'undefined',
              `${name} must not exist in the realm`,
            )
          }
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'cannot reach a host object through a returned value',
      because: 'the failure that makes same-realm "sandboxes" worthless is a live reference out',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          // Whatever comes back is data. Mutating it must not be able to touch
          // anything the realm still holds.
          const first = (await realm.eval('globalThis.shared = { n: 1 }; shared')) as { n: number }
          first.n = 99
          assertEqual(await realm.eval('shared.n'), 1, 'the host got a copy, not a reference')
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'interrupts an infinite loop',
      because: 'a stranger’s script must not be able to hang the app',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 250 })
        const started = Date.now()
        await assertRejects(
          () => realm.eval('while (true) {}'),
          'an unbounded loop is interrupted',
          (error) => (error as Error).name === 'JsTimeoutError',
        )
        assert(Date.now() - started < 5000, 'the interrupt arrives near the deadline, not eventually')
        realm.dispose()
      },
    },

    {
      name: 'interrupts a loop that runs after an await',
      because:
        'the engine deadline only fires while the engine runs, and eval returns at the first await — arming it only around the initial evaluation leaves every continuation unbounded, which is a freeze rather than a timeout',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 250, budgetMs: 3000 })
        const started = Date.now()
        await assertRejects(
          () => realm.eval('(async () => { await 1; while (true) {} })()'),
          'a loop in a continuation is interrupted',
          (error) => (error as Error).name === 'JsTimeoutError',
        )
        assert(Date.now() - started < 15_000, 'and it is interrupted promptly')
        realm.dispose()
      },
    },

    {
      name: 'interrupts a loop chained onto a host call',
      because:
        'the same hole by the other route: a continuation queued by a host promise runs in a pump, not in eval',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 250, budgetMs: 3000 })
        realm.expose('later', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return 1
        })
        const started = Date.now()
        await assertRejects(
          () => realm.eval('later().then(() => { while (true) {} })'),
          'a loop after a host call is interrupted',
          (error) => (error as Error).name === 'JsTimeoutError',
        )
        assert(Date.now() - started < 15_000, 'and it is interrupted promptly')
        realm.dispose()
      },
    },

    {
      name: 'bounds the whole call, not only each stretch of execution',
      because:
        'a script that yields repeatedly stays within the per-stretch limit for ever; without a budget it never has to stop',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 2000, budgetMs: 600 })
        realm.expose('wait', async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return 1
        })
        await assertRejects(
          () => realm.eval('(async () => { for (let i = 0; i < 20; i++) await wait(); return 1 })()'),
          'the budget ends it',
          (error) => (error as Error).name === 'JsTimeoutError',
        )
        realm.dispose()
      },
    },

    {
      name: 'survives being torn down with a frame still parked on an await',
      because:
        'disposing a context holding a suspended frame aborts the whole WASM instance — the realm leaks, dispose throws, and the service’s unload loop hits it again',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 2000, budgetMs: 500 })
        realm.expose('slow', async () => {
          await new Promise((resolve) => setTimeout(resolve, 400))
          return 1
        })
        await assertRejects(
          () => realm.eval('(async () => { await slow(); await slow(); await slow(); return 9 })()'),
          'the budget ends it rather than the engine aborting',
          (error) => (error as Error).name === 'JsTimeoutError',
        )
        // And the contract still holds: dispose never throws.
        realm.dispose()
        realm.dispose()
      },
    },

    {
      name: 'a realm that breached a limit is poisoned',
      because:
        'engine state after an interrupt is undefined; reusing it turns a sandbox into a crash later',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 200 })
        await assertRejects(
          () => realm.eval('while (true) {}'),
          'the loop is interrupted',
          (error) => (error as Error).name === 'JsTimeoutError',
        )
        await assertRejects(
          () => realm.eval('1 + 1'),
          'and the realm refuses everything after',
          (error) => (error as Error).name === 'JsRealmDisposedError',
        )
        realm.dispose()
      },
    },

    {
      name: 'a script’s own throw is distinct from a limit breach',
      because:
        '"your rule is wrong" and "your rule is too slow" need opposite fixes and must not look alike',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          await assertRejects(
            () => realm.eval('throw new Error("boom")'),
            'a thrown error surfaces as a script error',
            (error) => (error as Error).name === 'JsScriptError' && /boom/.test((error as Error).message),
          )
          // And the realm is still usable, because nothing was breached.
          assertEqual(await realm.eval('1 + 1'), 2, 'a throw does not poison the realm')
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'a syntax error is a script error, not a crash',
      because: 'a source author typing a broken jsLib should see their typo, not a stack from the host',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          await assertRejects(
            () => realm.eval('function ('),
            'unparseable code rejects',
            (error) => (error as Error).name === 'JsScriptError',
          )
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'calls a host function and returns its value',
      because: 'a realm with no way out is useless; this is the only way out there is',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          realm.expose('double', (n) => (n as number) * 2)
          assertEqual(await realm.eval('double(21)'), 42, 'host call')
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'a script can await a host function',
      because:
        'the single most common way to get a QuickJS embedding wrong: without pumping the job queue this deadlocks',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 4000 })
        try {
          realm.expose('slow', async (n) => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return (n as number) + 1
          })
          assertEqual(await realm.eval('slow(1).then(v => v + 1)'), 3, 'awaited host call')
          assertEqual(
            await realm.eval('(async () => { const v = await slow(10); return v * 2 })()'),
            22,
            'inside an async function too',
          )
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'preload runs before the first eval, in call order',
      because: 'a jsLib helper the first rule uses would otherwise fail intermittently',
      async run({ js }) {
        const realm = await js.createRealm()
        try {
          await realm.preload('function a() { return "a" }')
          await realm.preload('function b() { return a() + "b" }')
          assertEqual(await realm.eval('b()'), 'ab', 'both preloads, in order')
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'dispose is idempotent',
      because:
        'a disposer may legitimately run from a fiber teardown and an explicit call; the second must not throw',
      async run({ js }) {
        const realm = await js.createRealm()
        realm.dispose()
        realm.dispose()
      },
    },

    {
      name: 'reports that it is no longer usable',
      because:
        'a caller that caches a realm cannot find out by awaiting a rejection — one timeout would brick every later script for that source until the process restarted',
      async run({ js }) {
        const realm = await js.createRealm({ timeoutMs: 200, budgetMs: 1000 })
        assertEqual(realm.disposed, false, 'a fresh realm is usable')

        await assertRejects(
          () => realm.eval('while (true) {}'),
          'the loop is interrupted',
          (error) => (error as Error).name === 'JsTimeoutError',
        )
        assertEqual(realm.disposed, true, 'and a poisoned realm says so, synchronously')
      },
    },

    {
      name: 'every other method rejects on a disposed realm',
      because:
        'the rule is the opposite of dispose’s, they are easy to conflate, and getting them backwards is silent',
      async run({ js }) {
        const realm = await js.createRealm()
        realm.dispose()
        await assertRejects(
          () => realm.eval('1'),
          'eval on a disposed realm rejects',
          (error) => (error as Error).name === 'JsRealmDisposedError',
        )
        await assertRejects(
          () => realm.preload('1'),
          'preload on a disposed realm rejects',
          (error) => (error as Error).name === 'JsRealmDisposedError',
        )
      },
    },

    {
      name: 'does not leak a handle per rejected promise',
      because:
        'a rejected bridge that never frees its handle turns a source retrying a failing call into a growing heap',
      async run({ js }) {
        const realm = await js.createRealm({ budgetMs: 20_000 })
        try {
          realm.expose('fails', () => {
            throw new Error('no')
          })
          // Enough iterations that a per-call leak would breach the heap.
          for (let i = 0; i < 400; i++) {
            await realm.eval('(() => { try { fails() } catch { return 1 } })()')
          }
          assertEqual(await realm.eval('1 + 1'), 2, 'the realm is still healthy')
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'realms share nothing',
      because: 'two imported sources must not be able to see each other’s state',
      async run({ js }) {
        const a = await js.createRealm()
        const b = await js.createRealm()
        try {
          await a.eval('globalThis.secret = "a"')
          assertEqual(await b.eval('typeof secret'), 'undefined', 'b cannot see a')
        } finally {
          a.dispose()
          b.dispose()
        }
      },
    },

    {
      name: 'caps the size of a value crossing out',
      because:
        'the heap ceiling bounds the realm; nothing bounds the host once a value has crossed into it',
      async run({ js }) {
        const realm = await js.createRealm({ maxResultBytes: 1024 })
        try {
          await assertRejects(
            () => realm.eval('"x".repeat(50000)'),
            'an oversized result is refused',
            (error) => (error as Error).name === 'JsBridgeError',
          )
        } finally {
          realm.dispose()
        }
      },
    },

    {
      name: 'reports its engine',
      because: 'a source that works on desktop and not on mobile must be debuggable, not mysterious',
      async run({ js }) {
        assert(typeof js.engine.name === 'string' && js.engine.name.length > 0, 'engine has a name')
        assert(typeof js.engine.version === 'string', 'engine has a version')
      },
    },
  ],
}
