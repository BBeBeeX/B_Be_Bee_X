/**
 * Semantic tests for Cordis itself.
 *
 * Cordis is a release candidate whose README says the API may change without
 * notice, and the whole architecture rests on the behaviours asserted here.
 * The point is that an upstream bump breaks *this file*, with a pointed
 * message, rather than surfacing six weeks later as a plugin that will not
 * unload. Every test names the design decision it protects.
 *
 * See docs/09-project-structure.md §5.1.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { FiberState } from './fiber-state.js'
import { snapshotContext, tick } from './testing.js'

describe('dependency injection', () => {
  it('holds a plugin in PENDING until its injected services exist', async () => {
    // docs/02 §3: "Nobody sequences the plugin list." Load order is derived
    // from `inject`, so the loader can instantiate in any order.
    const ctx = new Context()
    const applied = vi.fn()

    const fiber = ctx.plugin({ inject: ['later'], apply: applied })
    await tick()
    expect(applied).not.toHaveBeenCalled()

    ctx.provide('later', { ok: true })
    await tick()
    expect(applied).toHaveBeenCalledTimes(1)
    expect(fiber.state).toBe(FiberState.ACTIVE)
  })

  it('unloads a plugin when a dependency disappears, and reloads when it returns', async () => {
    // docs/03 §2: this ACTIVE → UNLOADING → PENDING → ACTIVE cycle is what
    // makes provider sign-out remove everything the provider contributed,
    // with no bespoke cleanup code anywhere.
    const ctx = new Context()
    const applied = vi.fn()
    const disposed = vi.fn()

    const remove = ctx.provide('flaky', { v: 1 })
    ctx.plugin({
      inject: ['flaky'],
      apply: () => {
        applied()
        return disposed
      },
    })
    await tick()
    expect(applied).toHaveBeenCalledTimes(1)

    remove()
    await tick()
    expect(disposed).toHaveBeenCalledTimes(1)

    ctx.provide('flaky', { v: 2 })
    await tick()
    expect(applied).toHaveBeenCalledTimes(2)
  })

  it('treats EVERY injected key as required, including object-form nulls', async () => {
    // Cordis's object form is `{ service: interceptConfig }` — the value is
    // configuration, NOT an optionality marker. `Fiber._refresh()` iterates
    // every key and parks the fiber if any impl is missing.
    //
    // This surprised us and briefly made it into docs/03 §3 as "null marks an
    // optional dependency", which is false. The test exists so nobody
    // rediscovers it the hard way.
    const ctx = new Context()
    const applied = vi.fn()
    ctx.plugin({ inject: { absent: null }, apply: applied })
    await tick()
    expect(applied).not.toHaveBeenCalled()
  })

  it('expresses an optional dependency as a nested ctx.inject()', async () => {
    // The actual pattern: the outer plugin activates immediately, and only the
    // inner block waits. This is what the `@Inject()` method decorator
    // compiles to, and what docs/03 §3 now prescribes.
    const ctx = new Context()
    const outer = vi.fn()
    const inner = vi.fn()

    await ctx.plugin((c: Context) => {
      outer()
      c.inject(['optional'], inner)
    })
    await tick()
    expect(outer).toHaveBeenCalledTimes(1)
    expect(inner).not.toHaveBeenCalled()

    ctx.provide('optional', { ok: true })
    await tick()
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('delivers the object-form inject value as intercept config', async () => {
    // Confirms the positive half of the claim above.
    const ctx = new Context()
    let seen: unknown

    class Configured extends Service<{ tag?: string }> {
      constructor(c: Context) {
        super(c, 'configured')
      }
      read(this: Configured) {
        seen = this[Service.resolveConfig]()
      }
    }
    await ctx.plugin(Configured)

    await ctx.plugin({
      inject: { configured: { tag: 'from-inject' } },
      apply: (c: Context) => {
        ;(c as never as { configured: Configured }).configured.read()
      },
    })
    await tick()
    expect(seen).toMatchObject({ tag: 'from-inject' })
  })
})

describe('effects and disposal', () => {
  it('runs disposers in reverse registration order', async () => {
    // docs/03 §2: teardown must unwind, so a listener registered against a
    // resource is removed before the resource itself goes.
    const ctx = new Context()
    const order: number[] = []

    const fiber = await ctx.plugin((c: Context) => {
      c.effect(() => () => void order.push(1), 'first')
      c.effect(() => () => void order.push(2), 'second')
      c.effect(() => () => void order.push(3), 'third')
    })

    await fiber.dispose()
    expect(order).toEqual([3, 2, 1])
  })

  it('collects a disposer returned directly from apply()', async () => {
    const ctx = new Context()
    const disposed = vi.fn()
    const fiber = await ctx.plugin(() => disposed)
    await fiber.dispose()
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('collects every disposer yielded from a generator effect', async () => {
    const ctx = new Context()
    const seen: string[] = []
    const fiber = await ctx.plugin((c: Context) => {
      c.effect(function* () {
        yield () => void seen.push('a')
        yield () => void seen.push('b')
      }, 'multi')
    })
    await fiber.dispose()
    expect(seen).toEqual(['b', 'a'])
  })

  it('removes event listeners registered through the plugin context', async () => {
    // The leak test in docs/09 §6 depends on this being automatic.
    const ctx = new Context()
    const heard = vi.fn()

    const fiber = await ctx.plugin((c: Context) => {
      c.on('internal/plugin' as never, heard as never)
    })
    await fiber.dispose()
    await tick()

    const hooks = (ctx.events as unknown as { _hooks: Record<string, unknown[]> })._hooks
    expect(hooks['internal/plugin']?.includes(heard as never)).toBeFalsy()
  })

  it('is idempotent — disposing twice runs disposers once', async () => {
    const ctx = new Context()
    const disposed = vi.fn()
    const fiber = await ctx.plugin(() => disposed)
    await fiber.dispose()
    await fiber.dispose()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})

describe('isolation', () => {
  it('isolates only the named key, sharing everything else', async () => {
    // docs/03 §5: this is what gives each provider instance its own cookie jar
    // and rate limiter while still sharing fs, db, and logger.
    const root = new Context()
    root.provide('shared', { id: 'shared' })
    root.provide('http', { id: 'root-http' })

    const scoped = root.isolate('http')
    scoped.provide('http', { id: 'scoped-http' })

    expect((root as never as { http: { id: string } }).http.id).toBe('root-http')
    expect((scoped as never as { http: { id: string } }).http.id).toBe('scoped-http')
    // The un-isolated key is still the same object in both.
    expect((scoped as never as { shared: unknown }).shared).toBe(
      (root as never as { shared: unknown }).shared,
    )
  })

  it('keeps two isolated scopes invisible to each other', () => {
    // Cookies must never cross a provider boundary.
    const root = new Context()
    const a = root.isolate('http')
    const b = root.isolate('http')
    a.provide('http', { id: 'a' })
    b.provide('http', { id: 'b' })
    expect((a as never as { http: { id: string } }).http.id).toBe('a')
    expect((b as never as { http: { id: string } }).http.id).toBe('b')
  })
})

describe('interception', () => {
  it('delivers intercept config to a Service via resolveConfig', async () => {
    // docs/03 §7: the capability gate is built on this. If it stops working,
    // every plugin silently gains unrestricted access — so this test is the
    // one that must never be deleted.
    const ctx = new Context()
    let seen: unknown

    class Gated extends Service<{ granted?: string[] }> {
      constructor(c: Context) {
        super(c, 'gated')
      }
      read(this: Gated) {
        seen = this[Service.resolveConfig]()
      }
    }

    await ctx.plugin(Gated)
    const scoped = ctx.intercept('gated', { granted: ['fs:read:media'] })
    ;(scoped as never as { gated: Gated }).gated.read()

    expect(seen).toMatchObject({ granted: ['fs:read:media'] })
  })
})

describe('events', () => {
  it('composes waterfall listeners as middleware', async () => {
    // docs/02 §5: this is how plugin-download substitutes a local file for a
    // stream URL without ctx.player knowing downloads exist.
    const ctx = new Context()
    const trail: string[] = []

    ctx.on('test/waterfall' as never, ((value: string, next: () => string) => {
      trail.push('outer-in')
      const result = next()
      trail.push('outer-out')
      return `outer(${result})`
    }) as never)

    ctx.on('test/waterfall' as never, ((value: string, next: () => string) => {
      trail.push('inner')
      return `inner(${next()})`
    }) as never)

    const result = ctx.waterfall('test/waterfall' as never, 'x' as never, ((v: string) =>
      `base:${v}`) as never)

    expect(result).toBe('outer(inner(base:x))')
    expect(trail).toEqual(['outer-in', 'inner', 'outer-out'])
  })

  it('lets a waterfall listener short-circuit without calling next', () => {
    const ctx = new Context()
    const inner = vi.fn(() => 'never')
    ctx.on('test/short' as never, (() => 'substituted') as never)
    const result = ctx.waterfall('test/short' as never, 'x' as never, inner as never)
    expect(result).toBe('substituted')
    expect(inner).not.toHaveBeenCalled()
  })

  it('aggregates listener rejections from parallel dispatch', async () => {
    // docs/07 §5: `source/signed-out` is parallel so every listener runs even
    // if one throws — a failing scrobbler must not block the cookie purge.
    const ctx = new Context()
    const second = vi.fn()
    ctx.on('test/parallel' as never, (() => Promise.reject(new Error('boom'))) as never)
    ctx.on('test/parallel' as never, second as never)

    await expect(ctx.parallel('test/parallel' as never)).rejects.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('failure containment', () => {
  it('does not take down the context when a plugin throws', async () => {
    // docs/03 §2: a FAILED plugin's dependents never activate, but the app
    // keeps running. This is what quarantine builds on.
    const ctx = new Context()
    ctx.logger.error = vi.fn()

    ctx.plugin(() => {
      throw new Error('bad plugin')
    })
    await tick()

    const healthy = vi.fn()
    await ctx.plugin(healthy)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})

describe('FiberState mirror', () => {
  it('matches the values the live runtime reports', async () => {
    // fiber-state.ts hard-codes these because cordis exports them as an
    // ambient const enum that cannot be imported under isolatedModules.
    const ctx = new Context()
    const fiber = await ctx.plugin(() => {})
    expect(fiber.state).toBe(FiberState.ACTIVE)

    const pending = ctx.plugin({ inject: ['nope'], apply: () => {} })
    await tick()
    expect(pending.state).toBe(FiberState.PENDING)

    await fiber.dispose()
    expect(fiber.state).toBe(FiberState.DISPOSED)
  })
})

describe('snapshotContext internals', () => {
  it('can still reach the internals it depends on', () => {
    // snapshotContext() reads events._hooks and reflect.store, neither of
    // which has a public accessor. Fail here rather than silently returning
    // an empty snapshot that makes every leak test pass.
    const ctx = new Context()
    expect((ctx.events as unknown as { _hooks: unknown })._hooks).toBeTypeOf('object')
    expect((ctx.reflect as unknown as { store: unknown }).store).toBeTypeOf('object')
    expect(ctx.fiber.getEffects()).toBeInstanceOf(Array)
    expect(snapshotContext(ctx)).toHaveProperty('runtimes')
  })
})
