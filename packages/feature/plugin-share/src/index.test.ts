import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { Share } from './index.js'

describe('plugin-share', () => {
  it('activates and claims its service', async () => {
    const ctx = new Context()
    await ctx.plugin(plugin, {})
    await tick()
    expect(ctx.share).toBeInstanceOf(Share)
  })

  it('leaves nothing behind when unloaded', async () => {
    // The architecture's central claim, applied to this plugin (docs/09 §6).
    const ctx = new Context()
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
