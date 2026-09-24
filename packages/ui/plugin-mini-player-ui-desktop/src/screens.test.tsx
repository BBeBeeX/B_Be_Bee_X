// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context, Service } from 'cordis'
import type { MiniPlayerData, MiniPlayerServiceState } from '@BBeBee/protocol'
import pluginMiniPlayerUi, { MiniPlayerFloating, MiniPlayerIsland, MiniPlayerButton } from './index.js'

class UiStub extends Service {
  public views = new Map<string, unknown>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: unknown) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

class MiniPlayerStub extends Service {
  public state: MiniPlayerServiceState = {
    visible: false,
    mode: 'normal',
    windowState: 'hidden',
  }

  constructor(ctx: Context) {
    super(ctx, 'miniPlayer')
  }

  get isSupported() {
    return true
  }

  toggle() {
    this.state.visible = !this.state.visible
    this.ctx.emit('mini-player/changed', this.state)
  }
}

const mockData: MiniPlayerData = {
  title: 'Test Island Song',
  artist: 'Island Artist',
  status: 'playing',
  positionMs: 45000,
  durationMs: 180000,
  canPlayOrPause: true,
  canPrevious: true,
  canNext: true,
  volume: 1,
  muted: false,
}

describe('plugin-mini-player-ui-desktop', () => {
  it('registers views in ui service', async () => {
    const ctx = new Context()
    await ctx.plugin(UiStub)
    await ctx.plugin(MiniPlayerStub)
    await ctx.plugin(pluginMiniPlayerUi)

    expect(ctx.ui.viewFor('mini-player.window')).toBeDefined()
    expect(ctx.ui.viewFor('mini-player.button')).toBeDefined()
  })

  it('renders floating mode static markup', () => {
    const html = renderToStaticMarkup(
      h(MiniPlayerFloating, {
        data: mockData,
        onAction: () => {},
        onSnapToTop: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain('Test Island Song')
    expect(html).toContain('Island Artist')
  })

  it('renders attached dynamic island capsule static markup', () => {
    const html = renderToStaticMarkup(
      h(MiniPlayerIsland, {
        data: mockData,
        isExpanded: false,
        onAction: () => {},
        onExpand: () => {},
        onCollapse: () => {},
        onDetach: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain('Test Island Song')
    expect(html).toContain('Island Artist')
  })

  it('renders expanded dynamic island card static markup', () => {
    const html = renderToStaticMarkup(
      h(MiniPlayerIsland, {
        data: mockData,
        isExpanded: true,
        onAction: () => {},
        onExpand: () => {},
        onCollapse: () => {},
        onDetach: () => {},
        onRestoreMain: () => {},
        onClose: () => {},
      }),
    )

    expect(html).toContain('Test Island Song')
    expect(html).toContain('恢复主窗口')
    expect(html).toContain('关闭小窗')
    expect(html).toContain('0:45')
    expect(html).toContain('3:00')
  })

  it('renders MiniPlayerButton static markup', () => {
    const ctx = new Context()
    ctx.plugin(MiniPlayerStub)

    const html = renderToStaticMarkup(h(MiniPlayerButton, { ctx }))
    expect(html).toContain('打开小窗模式 / 灵动岛')
  })
})
