import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { TransportState } from '@BBeBee/protocol'
import pluginMiniPlayer, { apply } from './index.js'

class PlayerStub extends Service {
  public transport: TransportState = {
    status: 'idle',
    positionMs: 0,
    durationMs: 180_000,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
  }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  get state() {
    return this.transport
  }
}

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(pluginMiniPlayer)

  return { ctx }
}

describe('plugin-mini-player', () => {
  it('has valid plugin export and name', () => {
    expect(pluginMiniPlayer.name).toBe('plugin-mini-player')
    expect(typeof apply).toBe('function')
  })

  it('manages visibility and mode state', async () => {
    const { ctx } = await createHarness()
    expect(ctx.miniPlayer.state.visible).toBe(false)
    expect(ctx.miniPlayer.state.mode).toBe('normal')

    await ctx.miniPlayer.open()
    expect(ctx.miniPlayer.state.visible).toBe(true)

    await ctx.miniPlayer.setMode('attached')
    expect(ctx.miniPlayer.state.mode).toBe('attached')

    await ctx.miniPlayer.toggle()
    expect(ctx.miniPlayer.state.visible).toBe(false)

    await ctx.miniPlayer.toggle()
    expect(ctx.miniPlayer.state.visible).toBe(true)

    await ctx.miniPlayer.close()
    expect(ctx.miniPlayer.state.visible).toBe(false)
  })
})
