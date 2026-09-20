import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { TransportState } from '@BBeBee/protocol'
import pluginDesktopLyrics, { apply } from './index.js'

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
  await ctx.plugin(pluginDesktopLyrics)

  return { ctx }
}

describe('plugin-desktop-lyrics', () => {
  it('has valid plugin export and name', () => {
    expect(pluginDesktopLyrics.name).toBe('plugin-desktop-lyrics')
    expect(typeof apply).toBe('function')
  })

  it('manages visibility state', async () => {
    const { ctx } = await createHarness()
    expect(ctx.desktopLyrics.state.visible).toBe(true)

    ctx.desktopLyrics.toggleVisible()
    expect(ctx.desktopLyrics.state.visible).toBe(false)

    ctx.desktopLyrics.setVisible(true)
    expect(ctx.desktopLyrics.state.visible).toBe(true)
  })

  it('clamps font size and opacity within boundaries', async () => {
    const { ctx } = await createHarness()

    ctx.desktopLyrics.setFontSize(50)
    expect(ctx.desktopLyrics.state.fontSize).toBe(40)

    ctx.desktopLyrics.setFontSize(10)
    expect(ctx.desktopLyrics.state.fontSize).toBe(14)

    ctx.desktopLyrics.setOpacity(1.5)
    expect(ctx.desktopLyrics.state.opacity).toBe(1.0)

    ctx.desktopLyrics.setOpacity(0.05)
    expect(ctx.desktopLyrics.state.opacity).toBe(0.2)
  })

  it('updates position and lock state', async () => {
    const { ctx } = await createHarness()

    ctx.desktopLyrics.setPosition({ x: 120, y: 350 })
    expect(ctx.desktopLyrics.state.position).toEqual({ x: 120, y: 350 })

    ctx.desktopLyrics.setLocked(true)
    expect(ctx.desktopLyrics.state.locked).toBe(true)
  })
})
