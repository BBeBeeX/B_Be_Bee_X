// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import type { TransportState } from '@BBeBee/protocol'
import { DesktopLyrics } from './DesktopLyrics.js'
import pluginDesktopLyricsUi from './index.js'

class UiStub extends Service {
  public views = new Map<string, any>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: any) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

class PlayerStub extends Service {
  public transport: TransportState = {
    status: 'playing',
    positionMs: 4000,
    durationMs: 180_000,
    bufferedMs: 0,
    volume: 1,
    muted: false,
    repeat: 'off',
    shuffle: false,
    playMode: 'sequence',
    nowPlaying: {
      title: 'Floating Song',
      artist: 'Floating Artist',
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  get state() {
    return this.transport
  }
}

class LyricsStub extends Service {
  private currentState = {
    status: 'ready' as const,
    offsetMs: 0,
    lyrics: {
      format: 'lrc' as const,
      content: '[00:01.00]First Floating Lyric\n[00:06.00]Second Floating Lyric',
      synced: true,
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'lyrics')
  }

  get state() {
    return this.currentState
  }
}

class DesktopLyricsStub extends Service {
  private currentState = {
    visible: true,
    showNextLine: true,
    fontSize: 22,
    opacity: 0.9,
    position: { x: 0, y: 0 },
    locked: false,
  }

  constructor(ctx: Context) {
    super(ctx, 'desktopLyrics')
  }

  get state() {
    return this.currentState
  }

  setVisible(v: boolean) {
    this.currentState.visible = v
    this.ctx.emit('desktop-lyrics/changed', this.currentState)
  }
}

async function createHarness() {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  await ctx.plugin(PlayerStub)
  await ctx.plugin(LyricsStub)
  await ctx.plugin(DesktopLyricsStub)
  await ctx.plugin(pluginDesktopLyricsUi)

  return { ctx }
}

describe('DesktopLyrics', () => {
  it('registers view with ui service upon load', async () => {
    const { ctx } = await createHarness()
    expect(ctx.ui.viewFor('desktop-lyrics.floating')).toBeDefined()
  })

  it('renders floating overlay and lyrics line', async () => {
    const { ctx } = await createHarness()
    const html = renderToStaticMarkup(h(DesktopLyrics, { ctx }))

    expect(html).toContain('Desktop lyrics overlay')
    expect(html).toContain('First Floating Lyric')
    expect(html).toContain('Second Floating Lyric')
  })

  it('returns null when invisible', async () => {
    const { ctx } = await createHarness()
    ctx.desktopLyrics.setVisible(false)

    const html = renderToStaticMarkup(h(DesktopLyrics, { ctx }))
    expect(html).toBe('')
  })
})
