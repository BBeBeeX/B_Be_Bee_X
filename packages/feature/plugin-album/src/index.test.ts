/**
 * `plugin-album` as a plugin: it contributes the album route, and it unloads
 * the contribution with itself.
 *
 * The route id is the contract the shells and the listing screens navigate
 * to, so it is pinned here rather than only exercised through a screen.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'
import { ALBUM_ROUTES } from './views.js'

/** `ctx.ui`, as far as this plugin is concerned: a place to contribute. */
class UiStub extends Service {
  readonly contributed: { id: string; path?: string; kind: string }[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  contribute(c: { kind: string; id: string; path?: string }) {
    this.contributed.push({ kind: c.kind, id: c.id, ...(c.path ? { path: c.path } : {}) })
    return () => {}
  }
}

describe('plugin-album', () => {
  it('contributes the album route once the ui registry is up', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(plugin)
    await tick()

    const ui = ctx.ui as unknown as UiStub
    expect(ui.contributed).toEqual([
      { kind: 'route', id: ALBUM_ROUTES.album, path: '/album/:urn' },
    ])
  })

  it('loads with no ui registry at all, contributing nothing', async () => {
    // A build without `plugin-ui` is a build without a shell, not a broken
    // plugin: the contribution waits in a child fiber that never activates.
    const ctx = new Context()
    await expect(ctx.plugin(plugin)).resolves.toBeDefined()
  })
})

describe('plugin-album lifecycle', () => {
  it('snapshots clean after unload, contribution and all', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })

  it('snapshots clean after unload when the ui registry never appeared', async () => {
    const ctx = new Context()
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin)
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
