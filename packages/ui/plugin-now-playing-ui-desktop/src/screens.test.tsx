// @vitest-environment jsdom
/**
 * The desktop now-playing surfaces.
 *
 * What is worth pinning is the behaviour a user would notice and that is easy
 * to get wrong in a view: a control that is present but does nothing, a
 * buffering state shown as paused, an unlabelled transport button.
 *
 * Static markup, so the assertions stay about what the screen says rather
 * than about how it is mounted.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Context, Service } from 'cordis'
import { NOW_PLAYING_STYLES, type NowPlayingStyleId, type NowPlayingStyleMeta, type QueueItem, type Track, type TransportState } from '@BBeBee/protocol'
import { NowPlayingBar, NowPlayingScreen, StyleSwitcher } from './index.js'

afterEach(() => {
  cleanup()
})

const IDLE: TransportState = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  playMode: 'sequence',
}

/** A `ctx.player` with just what the views read and call, and an optional `ctx.sources`. */
async function harness(
  state: Partial<TransportState> = {},
  queue: QueueItem[] = [],
  catalogue: Record<string, Track> = {},
) {
  const calls: string[] = []
  const transport: TransportState = { ...IDLE, ...state }

  class PlayerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return transport
    }
    get queue() {
      return queue
    }
    togglePlay = () => void calls.push('togglePlay')
    next = async () => void calls.push('next')
    previous = async () => void calls.push('previous')
    seek = async (ms: number) => void calls.push(`seek:${ms}`)
    setVolume = (v: number) => void calls.push(`volume:${v}`)
    setMuted = (m: boolean) => void calls.push(`muted:${m}`)
    setRepeat = (r: any) => void calls.push(`repeat:${r}`)
    setShuffle = (s: boolean) => void calls.push(`shuffle:${s}`)
    setPlayMode = (m: any) => void calls.push(`playMode:${m}`)
    cyclePlayMode = () => {
      calls.push('cyclePlayMode')
      return 'list-loop'
    }
    playNow = async (urns: string[]) => void calls.push(`playNow:${urns.join(',')}`)
    playFromContext = async (urn: string, contextUrns: readonly string[] = []) =>
      void calls.push(`jump:${urn}${contextUrns.length ? `|${contextUrns.join(',')}` : ''}`)
  }

  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    getTracks = async (urns: readonly string[]) =>
      urns.map((urn) => catalogue[urn]).filter((t): t is Track => t !== undefined)
  }

  class LibraryStub extends Service {
    saved = new Set<string>()
    constructor(ctx: Context) {
      super(ctx, 'library')
    }
    isSaved = async (urn: string) => this.saved.has(urn)
    setSaved = async (urn: string, s: boolean) => {
      if (s) this.saved.add(urn)
      else this.saved.delete(urn)
      calls.push(`setSaved:${urn}:${s}`)
      this.ctx.emit('library/changed', 'track', [urn])
    }
    listPlaylists = async () => ({ items: [] })
    listCollections = async () => []
    listSaved = async () => ({ items: [] })
  }

  class UiStub extends Service {
    views = new Map<string, unknown>()
    slots = new Map<string, { id: string; slot: string }[]>()

    constructor(ctx: Context) {
      super(ctx, 'ui')
    }

    registerView(id: string, view: unknown) {
      this.views.set(id, view)
      return () => void this.views.delete(id)
    }

    viewFor(id: string) {
      return this.views.get(id)
    }

    slotsFor(slot: string) {
      return this.slots.get(slot) ?? []
    }

    navigate(id: string) {
      calls.push(`navigate:${id}`)
    }

    contribute(c: { kind: string; id: string; slot?: string }) {
      if (c.kind === 'slot' && c.slot) {
        const list = this.slots.get(c.slot) ?? []
        list.push({ id: c.id, slot: c.slot })
        this.slots.set(c.slot, list)
      }
    }
  }

  class NowPlayingStub extends Service {
    style: NowPlayingStyleId = 'classic'
    styles: NowPlayingStyleMeta[] = [...NOW_PLAYING_STYLES]
    constructor(ctx: Context) {
      super(ctx, 'nowPlaying')
    }
    getStyle = () => this.style
    setStyle = (s: NowPlayingStyleId) => {
      this.style = s
      calls.push(`setStyle:${s}`)
      this.ctx.emit('now-playing/style-changed', s)
    }
    getStyles = () => this.styles
    registerStyle = (meta: NowPlayingStyleMeta) => {
      this.styles.push(meta)
      this.ctx.emit('now-playing/registry-changed', this.styles)
      return () => {
        this.styles = this.styles.filter((s) => s.id !== meta.id)
        this.ctx.emit('now-playing/registry-changed', this.styles)
      }
    }
    removeStyle = (id: string) => {
      const idx = this.styles.findIndex((s) => s.id === id)
      if (idx === -1) return false
      this.styles.splice(idx, 1)
      this.ctx.emit('now-playing/registry-changed', this.styles)
      return true
    }
  }

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(LibraryStub)
  await ctx.plugin(UiStub)
  await ctx.plugin(NowPlayingStub)
  if (Object.keys(catalogue).length > 0) await ctx.plugin(SourcesStub)
  return { ctx, calls }
}

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element)
describe('NowPlayingBar', () => {
  it('names every transport control', async () => {
    // An unlabelled icon button is unusable with a screen reader, and the
    // transport is the one place every user reaches for (docs/08 §8).
    const { ctx } = await harness()
    const out = html(h(NowPlayingBar, { ctx }))
    for (const label of ['Previous track', 'Next track', 'Seek', 'Volume']) {
      expect(out, label).toContain(`aria-label="${label}"`)
    }
  })

  it('renders queue button and navigates to queue.view on click', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(NowPlayingBar, { ctx }))
    const btn = getByTestId('queue-button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toBe('播放队列')
    fireEvent.click(btn)
    expect(calls).toContain('navigate:queue.view')
  })

  it('shows one play/pause control that reflects the state', async () => {
    const idle = await harness({ status: 'paused' })
    expect(html(h(NowPlayingBar, { ctx: idle.ctx }))).toContain('aria-label="Play"')

    const playing = await harness({ status: 'playing' })
    const out = html(h(NowPlayingBar, { ctx: playing.ctx }))
    expect(out).toContain('aria-label="Pause"')
    expect(out, 'not two separate controls').not.toContain('aria-label="Play"')
  })

  it('says buffering rather than showing a paused player', async () => {
    // `stalled` is distinct from `paused`: the UI shows progress and the lock
    // screen keeps reporting playing, so neither flickers on an underrun.
    const { ctx } = await harness({ status: 'stalled' })
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toContain('Buffering')
    expect(out, 'still offers pause, because it is still playing').toContain('aria-label="Pause"')
  })

  it('disables seeking on a stream with no duration', async () => {
    // A live stream cannot be seeked, and a scrubber that does nothing is
    // worse than one that is visibly unavailable.
    const { ctx } = await harness({ status: 'playing', durationMs: 0 })
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toMatch(/aria-label="Seek"[^>]*disabled|disabled[^>]*aria-label="Seek"/)
  })

  it('disables next at the end of the queue', async () => {
    const { ctx } = await harness({ status: 'playing', currentItemId: 'b' }, [
      { id: 'a', trackUrn: 'BBeBee:local:track:a', addedBy: 'user' },
      { id: 'b', trackUrn: 'BBeBee:local:track:b', addedBy: 'user' },
    ])
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toMatch(/aria-label="Next track"[^>]*disabled|disabled[^>]*aria-label="Next track"/)
  })

  it('shows elapsed and total time', async () => {
    const { ctx } = await harness({ status: 'paused', positionMs: 65_000, durationMs: 245_000 })
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toContain('1:05')
    expect(out).toContain('4:05')
  })

  it('shows a placeholder duration rather than 0:00 for an unknown one', async () => {
    const { ctx } = await harness({ status: 'playing', durationMs: 0 })
    expect(html(h(NowPlayingBar, { ctx }))).toContain('--:--')
  })

  it('shows current track title and artist', async () => {
    const { ctx } = await harness({
      status: 'playing',
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: {
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        album: 'A Night at the Opera',
      },
    })
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toContain('Bohemian Rhapsody')
    expect(out).toContain('Queen')
  })

  it('provides an open now playing button on the cover', async () => {
    const { ctx } = await harness({ status: 'playing' })
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toContain('aria-label="Open now playing"')
  })

  it('renders a toggle button for desktop lyrics to the left of volume control', async () => {
    const { ctx } = await harness({ status: 'playing' })
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toContain('aria-label="显示桌面歌词"')
    expect(out).toContain('词')
  })

  it('synchronizes desktop lyrics toggle state with desktopLyrics service and settings', async () => {
    class DesktopLyricsStub extends Service {
      public state = {
        visible: true,
        fontSize: 24,
        opacity: 1,
        showNextLine: true,
        position: { x: -1, y: -1 },
        locked: false,
      }
      constructor(c: Context) {
        super(c, 'desktopLyrics')
      }
      toggleVisible() {
        this.state.visible = !this.state.visible
        this.ctx.emit('desktop-lyrics/changed', this.state)
      }
    }

    const { ctx } = await harness({ status: 'playing' })
    await ctx.plugin(DesktopLyricsStub)

    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toContain('aria-label="隐藏桌面歌词"')
  })

  it('places play mode button to the left of previous track and volume control to the right of next track', async () => {
    const { ctx } = await harness({ status: 'playing', playMode: 'sequence' })
    const out = html(h(NowPlayingBar, { ctx }))
    const playModeIdx = out.indexOf('播放模式: 顺序播放')
    const prevIdx = out.indexOf('aria-label="Previous track"')
    const nextIdx = out.indexOf('aria-label="Next track"')
    const volIdx = out.indexOf('aria-label="Volume"')

    expect(playModeIdx).toBeGreaterThan(-1)
    expect(prevIdx).toBeGreaterThan(playModeIdx)
    expect(nextIdx).toBeGreaterThan(prevIdx)
    expect(volIdx).toBeGreaterThan(nextIdx)
  })

  it('renders distinct labels and icons for each play mode', async () => {
    for (const mode of ['sequence', 'single-loop', 'list-loop', 'shuffle'] as const) {
      const { ctx } = await harness({ status: 'playing', playMode: mode })
      const out = html(h(NowPlayingBar, { ctx }))
      if (mode === 'single-loop') {
        expect(out).toContain('播放模式: 单曲循环')
        expect(out).toContain('data-icon="repeat-once"')
      } else if (mode === 'sequence') {
        expect(out).toContain('播放模式: 顺序播放')
        expect(out).toContain('data-icon="list-numbers"')
      } else if (mode === 'list-loop') {
        expect(out).toContain('播放模式: 列表循环')
        expect(out).toContain('data-icon="repeat"')
      } else if (mode === 'shuffle') {
        expect(out).toContain('播放模式: 随机播放')
        expect(out).toContain('data-icon="shuffle"')
      }
    }
  })

  it('renders mute icon with x when muted', async () => {
    const { ctx } = await harness({ status: 'playing', muted: true, volume: 0.8 })
    const out = html(h(NowPlayingBar, { ctx }))
    expect(out).toContain('data-icon="volume-off"')
    expect(out).toContain('title="已静音 (点击展开调节栏)"')
  })

  it('renders volume waves corresponding to volume level when unmuted', async () => {
    // 0 volume: volume-3
    const { ctx: ctx0 } = await harness({ status: 'playing', muted: false, volume: 0 })
    const out0 = html(h(NowPlayingBar, { ctx: ctx0 }))
    expect(out0).toContain('data-icon="volume-3"')

    // Low volume: volume-3
    const { ctx: ctxLow } = await harness({ status: 'playing', muted: false, volume: 0.2 })
    const outLow = html(h(NowPlayingBar, { ctx: ctxLow }))
    expect(outLow).toContain('data-icon="volume-3"')

    // Medium volume: volume-2
    const { ctx: ctxMed } = await harness({ status: 'playing', muted: false, volume: 0.5 })
    const outMed = html(h(NowPlayingBar, { ctx: ctxMed }))
    expect(outMed).toContain('data-icon="volume-2"')

    // High volume: volume
    const { ctx: ctxHigh } = await harness({ status: 'playing', muted: false, volume: 0.9 })
    const outHigh = html(h(NowPlayingBar, { ctx: ctxHigh }))
    expect(outHigh).toContain('data-icon="volume"')
  })

  it('cycles play mode when clicking play mode button', async () => {
    const { ctx, calls } = await harness({ status: 'playing', playMode: 'sequence' })
    const { container } = render(h(NowPlayingBar, { ctx }))
    const btn = container.querySelector('button[aria-label^="播放模式"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    fireEvent.click(btn)
    expect(calls).toContain('cyclePlayMode')
  })

  it('toggles volume popover and toggles mute from popover', async () => {
    const { ctx, calls } = await harness({ status: 'playing', muted: false, volume: 0.6 })
    const { container } = render(h(NowPlayingBar, { ctx }))
    const volBtn = container.querySelector('button[aria-label="Volume"]') as HTMLButtonElement
    expect(volBtn).not.toBeNull()

    // Popover is initially not open
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    // Click volume button to open popover
    fireEvent.click(volBtn)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('60%')

    // Mute toggle inside dialog
    const muteBtn = container.querySelector('button[aria-label="静音"]') as HTMLButtonElement
    expect(muteBtn).not.toBeNull()
    fireEvent.click(muteBtn)
    expect(calls).toContain('muted:true')
  })

  it('opens context menu when right-clicking on cover', async () => {
    const { ctx } = await harness({
      status: 'playing',
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: {
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
      },
    })
    const { getByLabelText, findByText } = render(h(NowPlayingBar, { ctx }))
    const coverBtn = getByLabelText('Open now playing')
    fireEvent.contextMenu(coverBtn)
    expect(await findByText('加入播放列表')).toBeTruthy()
  })

  it('renders favorite/playlist action button next to track name and toggles state', async () => {
    const { ctx, calls } = await harness({
      status: 'playing',
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: {
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
      },
    })
    const { getByTestId, findByText } = render(h(NowPlayingBar, { ctx }))
    const btn = getByTestId('track-library-action-btn')
    expect(btn.getAttribute('title')).toBe('加入最喜欢的音乐')
    expect(btn.getAttribute('aria-label')).toBe('Add Bohemian Rhapsody to favourites')

    // Click to add to favourites
    fireEvent.click(btn)
    expect(calls).toContain('setSaved:BBeBee:local:track:1:true')
    expect(btn.getAttribute('title')).toBe('加入歌单')
    expect(btn.getAttribute('aria-label')).toBe('Add Bohemian Rhapsody to playlist')

    // Click again to open playlist menu
    fireEvent.click(btn)
    expect(await findByText('添加到歌单')).toBeTruthy()
  })

  it('does not render library action button when nothing is playing', async () => {
    const { ctx } = await harness({ status: 'idle' })
    const { queryByTestId } = render(h(NowPlayingBar, { ctx }))
    expect(queryByTestId('track-library-action-btn')).toBeNull()
  })
})

describe('NowPlayingScreen', () => {
  it('displays track title, artist, and album', async () => {
    const { ctx } = await harness({
      status: 'playing',
      trackUrn: 'BBeBee:local:track:1',
      durationMs: 354_000,
      positionMs: 60_000,
      nowPlaying: {
        title: 'Hotel California',
        artist: 'Eagles',
        album: 'Hotel California',
      },
    })
    const out = html(h(NowPlayingScreen, { ctx }))
    expect(out).toContain('Hotel California')
    expect(out).toContain('Eagles')
    expect(out).toContain('aria-label="Now playing"')
    expect(out).toContain('aria-label="Pause"')
    expect(out).toContain('1:00')
    expect(out).toContain('5:54')
  })

  it('provides a close button in the top-left corner', async () => {
    const { ctx } = await harness({ status: 'playing' })
    const out = html(h(NowPlayingScreen, { ctx }))
    expect(out).toContain('aria-label="Close now playing"')
  })

  it('renders lyrics panel slot when available', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.ui.registerView('lyrics.panel', () =>
      h('div', { 'data-testid': 'mock-lyrics-panel' }, 'Mock Lyrics'),
    )
    const out = html(h(NowPlayingScreen, { ctx }))
    expect(out).toContain('data-testid="mock-lyrics-panel"')
    expect(out).toContain('Mock Lyrics')
  })

  it('renders visualizer slot when available', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.ui.registerView('visualizer.canvas', () =>
      h('div', { 'data-testid': 'mock-visualizer' }, 'Mock Visualizer'),
    )
    const out = html(h(NowPlayingScreen, { ctx }))
    expect(out).toContain('data-testid="mock-visualizer"')
    expect(out).toContain('Mock Visualizer')
  })

  it('renders style switcher button and opens dropdown menu', async () => {
    const { ctx } = await harness({ status: 'playing' })
    let currentStyle = 'classic'
    const { container } = render(
      h(StyleSwitcher, {
        ctx,
        styleId: currentStyle,
        onStyleChange: (next) => {
          currentStyle = next
        },
      }),
    )
    const switcherBtn = container.querySelector('[data-testid="style-switcher-button"]') as HTMLButtonElement
    expect(switcherBtn).toBeTruthy()
    expect(switcherBtn.getAttribute('aria-label')).toBe('切换播放页样式')

    // Popover is initially closed
    expect(container.querySelector('[role="menu"]')).toBeNull()

    // Click to open popover
    fireEvent.click(switcherBtn)
    const menu = container.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    expect(menu?.getAttribute('aria-label')).toBe('播放页样式')

    // Options for all 5 templates exist
    for (const styleId of ['classic', 'full-cover', 'vinyl', 'compact', 'cinematic']) {
      expect(container.querySelector(`[data-testid="style-option-${styleId}"]`)).toBeTruthy()
    }

    // NowPlayingScreen does not render style switcher button anymore
    const screenRender = render(h(NowPlayingScreen, { ctx }))
    expect(screenRender.container.querySelector('[data-testid="style-switcher-button"]')).toBeNull()
  })

  it('renders full-cover layout when style is full-cover', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.setStyle('full-cover')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-testid="layout-full-cover"]')).toBeTruthy()
  })

  it('renders vinyl layout with spinning record when style is vinyl', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.setStyle('vinyl')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-testid="layout-vinyl"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Vinyl disc"]')).toBeTruthy()
  })

  it('renders compact layout when style is compact', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.setStyle('compact')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-testid="layout-compact"]')).toBeTruthy()
  })

  it('renders cinematic layout with waveform and lyrics when style is cinematic', async () => {
    const { ctx } = await harness({
      status: 'playing',
      trackUrn: 'BBeBee:local:track:1',
      positionMs: 60_000,
      durationMs: 240_000,
      nowPlaying: {
        title: 'Cinematic Track',
        artist: 'Cinematic Artist',
      },
    })
    ctx.nowPlaying.setStyle('cinematic')
    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-testid="layout-cinematic"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="cinematic-waveform"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="cinematic-lyrics-block"]')).toBeTruthy()
    expect(container.textContent).toContain('Cinematic Track')
    expect(container.textContent).toContain('Cinematic Artist')
    expect(container.textContent).toContain('1:00')
    expect(container.textContent).toContain('4:00')
  })

  it('switches layout dynamically when selecting an option from style switcher', async () => {
    const { ctx, calls } = await harness({ status: 'playing' })
    let currentStyle = 'classic'
    const { container } = render(
      h(StyleSwitcher, {
        ctx,
        styleId: currentStyle,
        onStyleChange: (next) => {
          currentStyle = next
          ctx.nowPlaying.setStyle(next)
        },
      }),
    )

    // Open style switcher
    const switcherBtn = container.querySelector('[data-testid="style-switcher-button"]') as HTMLButtonElement
    fireEvent.click(switcherBtn)

    // Select vinyl layout
    const vinylOption = container.querySelector('[data-testid="style-option-vinyl"]') as HTMLButtonElement
    fireEvent.click(vinylOption)

    expect(calls).toContain('setStyle:vinyl')
    expect(currentStyle).toBe('vinyl')
  })

  it('renders sandboxed layout iframe when style is sandboxed plugin', async () => {
    const { ctx } = await harness({ status: 'playing' })
    ctx.nowPlaying.registerStyle({
      id: 'custom-sandboxed-test',
      name: 'Custom Sandboxed',
      description: 'Test sandbox',
      icon: 'sparkles',
      type: 'sandboxed',
      htmlContent: '<div id="plugin-test">Plugin Active</div>',
    })
    ctx.nowPlaying.setStyle('custom-sandboxed-test')

    const { container } = render(h(NowPlayingScreen, { ctx }))
    expect(container.querySelector('[data-testid="layout-sandboxed"]')).toBeTruthy()
    const iframe = container.querySelector('[data-testid="sandbox-iframe"]') as HTMLIFrameElement
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('srcdoc')).toContain('Plugin Active')
    expect(iframe.getAttribute('srcdoc')).toContain('window.BBeBeePlayer')
  })
})
