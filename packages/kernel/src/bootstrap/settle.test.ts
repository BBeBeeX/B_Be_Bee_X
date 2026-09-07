/**
 * `start()` settles the graph.
 *
 * These pin the fix for a class of bug that bit twice while building M0: a
 * wrapper that spawns a child plugin without awaiting it resolves immediately,
 * so the caller believes the service is ready when its `Service.init` is still
 * running. The instances were fixed; this makes the *shape* harmless.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { createApp } from './app.js'
import type { PluginRegistry } from '../loader/loader.js'
import { tick } from '../testing.js'

/** A service whose initialisation genuinely takes time. */
class SlowService extends Service {
  ready = false
  constructor(ctx: Context) {
    super(ctx, 'slow')
  }
  async [Service.init]() {
    await new Promise((r) => setTimeout(r, 60))
    this.ready = true
  }
}

/** The mistake: spawn the child, do not await it. */
const forgetful = {
  name: 'forgetful',
  apply(ctx: Context) {
    const fiber = ctx.plugin(SlowService)
    return () => void fiber.dispose()
  },
}

/** The correct form, for comparison. */
const careful = {
  name: 'careful',
  async apply(ctx: Context) {
    const fiber = await ctx.plugin(SlowService)
    return () => void fiber.dispose()
  },
}

function registryOf(plugin: unknown): PluginRegistry {
  return {
    'test/subject': {
      plugin: plugin as never,
      manifest: {
        id: 'test/subject',
        version: '0.0.0',
        displayName: 'subject',
        engines: { BBeBee: '^0.1.0' },
        entry: { main: './x.js' },
        capabilities: [],
      },
      builtin: true,
    },
  }
}

const appWith = (plugin: unknown, settleTimeoutMs?: number) =>
  createApp({
    target: 'desktop',
    bootstrap: [],
    registry: registryOf(plugin),
    config: { plugins: { 'test/subject': {} } },
    ...(settleTimeoutMs === undefined ? {} : { settleTimeoutMs }),
  })

describe('start() waits for in-flight initialisation', () => {
  it('a forgetful wrapper is NOT ready before settling', async () => {
    // Demonstrates the underlying hazard: without the settle step, `start()`
    // would have returned here with `ready === false`.
    const ctx = new Context()
    await ctx.plugin(forgetful)
    expect(
      (ctx as never as { slow?: SlowService }).slow?.ready ?? false,
      'the child should still be initialising — otherwise this test proves nothing',
    ).toBe(false)
  })

  it('start() settles it anyway', async () => {
    const app = appWith(forgetful)
    await app.start()
    expect((app.ctx as never as { slow: SlowService }).slow.ready).toBe(true)
    await app.stop()
  })

  it('start() also settles the correct form', async () => {
    const app = appWith(careful)
    await app.start()
    expect((app.ctx as never as { slow: SlowService }).slow.ready).toBe(true)
    await app.stop()
  })

  it('does not wait on a plugin resting in PENDING', async () => {
    // PENDING is a legitimate steady state — waiting on a service that may
    // never arrive. Only LOADING blocks, or boot would hang on any optional
    // dependency that is simply absent.
    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: {
        waiter: {
          plugin: { name: 'waiter', inject: ['nothingProvidesThis'], apply: () => {} } as never,
          manifest: {
            id: 'waiter',
            version: '0.0.0',
            displayName: 'waiter',
            engines: { BBeBee: '^0.1.0' },
            entry: { main: './x.js' },
            capabilities: [],
          },
          builtin: true,
        },
      },
      config: { plugins: { waiter: {} } },
      settleTimeoutMs: 5_000,
    })

    const startedAt = Date.now()
    await app.start()
    expect(Date.now() - startedAt, 'should not have waited out the timeout').toBeLessThan(2_000)
    expect(app.plugins[0]?.state).toBe('pending')
    await app.stop()
  })

  it('warns rather than hanging when something never finishes loading', async () => {
    const neverFinishes = {
      name: 'never-finishes',
      apply(ctx: Context) {
        class Stuck extends Service {
          constructor(c: Context) {
            super(c, 'stuck')
          }
          async [Service.init]() {
            await new Promise(() => {}) // deliberately never resolves
          }
        }
        void ctx.plugin(Stuck)
      },
    }

    const app = createApp({
      target: 'desktop',
      bootstrap: [],
      registry: registryOf(neverFinishes),
      config: { plugins: { 'test/subject': {} } },
      settleTimeoutMs: 120,
      // Cordis cannot dispose a fiber whose init never resolves, so
      // teardown must bound the wait rather than hang on it.
      disposeTimeoutMs: 120,
    })
    const warn = vi.fn()
    app.ctx.logger.warn = warn

    await app.start()
    await tick()

    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/still initialising/)

    // And shutdown completes rather than hanging on the stuck fiber.
    await expect(app.stop()).resolves.toBeUndefined()
  })
})
