// @vitest-environment jsdom
/**
 * The mobile player views.
 *
 * Tests the mobile transport surfaces: NowPlayingBar, NowPlayingScreen, and QueueScreen.
 * Verifies that controls are properly labelled, callbacks fire, and state changes reflect.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { QueueItem, Track, TransportState } from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { NowPlayingBar, NowPlayingScreen, QueueScreen } from './index.js'

afterEach(cleanup)

function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (e: { stopPropagation: () => void }) => {
          e.stopPropagation()
          ;(onPress as () => void)()
        } : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList', 'data-label': props.accessibilityLabel, role: 'list' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
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
}

/** A `ctx.player` with what the views read and call, and an optional `ctx.sources`. */
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

  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    navigate = (routeId: string) => void calls.push(`navigate:${routeId}`)
  }

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  if (Object.keys(catalogue).length > 0) await ctx.plugin(SourcesStub)
  await ctx.plugin(UiStub)
  return { ctx, calls }
}

describe('NowPlayingBar on mobile', () => {
  it('renders track title, artist and play/pause control', async () => {
    const { ctx } = await harness({
      trackUrn: 'BBeBee:local:track:1',
      nowPlaying: { title: 'Solar', artist: 'Miles Davis', album: 'Walkin' },
      status: 'playing',
    })
    const { container } = render(h(NowPlayingBar, { ctx }))
    expect(container.textContent).toContain('Solar')
    expect(container.textContent).toContain('Miles Davis')

    const pauseBtn = container.querySelector('[data-label="Pause"]') as HTMLElement | null
    expect(pauseBtn).toBeTruthy()
  })

  it('triggers togglePlay and onOpenNowPlaying callback', async () => {
    let opened = false
    const queue: QueueItem[] = [
      { id: 'q-1', trackUrn: 'BBeBee:local:track:1', addedBy: 'user' },
      { id: 'q-2', trackUrn: 'BBeBee:local:track:2', addedBy: 'user' },
    ]
    const { ctx, calls } = await harness(
      {
        trackUrn: 'BBeBee:local:track:1',
        currentItemId: 'q-1',
        nowPlaying: { title: 'Solar', artist: 'Miles Davis' },
        status: 'paused',
      },
      queue,
    )
    const { container } = render(
      h(NowPlayingBar, { ctx, onOpenNowPlaying: () => { opened = true } }),
    )

    const playBtn = container.querySelector('[data-label="Play"]') as HTMLElement
    expect(playBtn).toBeTruthy()
    await act(async () => {
      playBtn.click()
    })
    expect(calls).toContain('togglePlay')

    const bar = container.querySelector('[data-label="Open now playing"]') as HTMLElement
    expect(bar).toBeTruthy()
    await act(async () => {
      bar.click()
    })
    expect(opened).toBe(true)
    expect(calls).toContain('navigate:player.now-playing')
  })
})

describe('NowPlayingScreen on mobile', () => {
  it('renders full screen player details and transport buttons', async () => {
    let closed = false
    const queue: QueueItem[] = [
      { id: 'q-1', trackUrn: 'BBeBee:local:track:1', addedBy: 'user' },
      { id: 'q-2', trackUrn: 'BBeBee:local:track:2', addedBy: 'user' },
    ]
    const { ctx, calls } = await harness(
      {
        trackUrn: 'BBeBee:local:track:1',
        currentItemId: 'q-1',
        nowPlaying: { title: 'Solar', artist: 'Miles Davis', album: 'Walkin' },
        status: 'playing',
        durationMs: 180_000,
      },
      queue,
    )
    const { container } = render(
      h(NowPlayingScreen, { ctx, onClose: () => { closed = true } }),
    )

    expect(container.textContent).toContain('Solar')
    expect(container.textContent).toContain('Miles Davis')
    expect(container.textContent).toContain('Walkin')

    const closeBtn = container.querySelector('[data-label="Close player"]') as HTMLElement
    expect(closeBtn).toBeTruthy()
    await act(async () => {
      closeBtn.click()
    })
    expect(closed).toBe(true)

    const nextBtn = container.querySelector('[data-label="Next track"]') as HTMLElement
    expect(nextBtn).toBeTruthy()
    await act(async () => {
      nextBtn.click()
    })
    expect(calls).toContain('next')
  })
})

describe('QueueScreen on mobile', () => {
  it('renders empty queue state when empty', async () => {
    const { ctx } = await harness({}, [])
    const { container } = render(h(QueueScreen, { ctx }))
    expect(container.textContent).toContain('Nothing queued')
  })

  it('renders queue items and jumps to a tapped row instead of re-queueing it', async () => {
    const { ctx, calls } = await harness(
      { currentItemId: 'q-1' },
      [
        { id: 'q-1', trackUrn: 'BBeBee:local:track:1', addedBy: 'user' },
        { id: 'q-2', trackUrn: 'BBeBee:local:track:2', addedBy: 'user' },
      ],
    )
    const { container } = render(h(QueueScreen, { ctx }))
    // No catalogue answer and no transport metadata: the row waits instead of
    // showing its URN.
    expect(container.textContent).toContain('Loading…')
    expect(container.textContent).not.toContain('BBeBee:local:track:1')

    const row = container.querySelector('[role="listitem"] [data-host]') as HTMLElement
    expect(row, 'the queue row is tappable').toBeTruthy()
    await act(async () => {
      row.click()
    })
    expect(calls).toContain('jump:BBeBee:local:track:1')
  })

  it('borrows the transport metadata for the playing item before the catalogue answers', async () => {
    const { ctx } = await harness(
      {
        status: 'playing',
        currentItemId: 'q-1',
        trackUrn: 'BBeBee:bili:track:1',
        nowPlaying: { title: '极端天气 MV', artist: 'UP主甲' },
      },
      [{ id: 'q-1', trackUrn: 'BBeBee:bili:track:1', addedBy: 'user' }],
    )
    const { container } = render(h(QueueScreen, { ctx }))
    expect(container.textContent).toContain('极端天气 MV')
    expect(container.textContent).toContain('UP主甲')
    expect(container.textContent, 'no raw URN in the queue, ever').not.toContain('BBeBee:bili:')
  })

  it('shows title and artist from the catalogue rather than the URN', async () => {
    // The rows resolve themselves through one catalogue read; the fallback for
    // a URN nothing answers for is `queueTrackFallback`, never the URN itself.
    const { ctx } = await harness(
      { currentItemId: 'q-1' },
      [{ id: 'q-1', trackUrn: 'BBeBee:local:track:1', addedBy: 'user' }],
      {
        'BBeBee:local:track:1': {
          urn: 'BBeBee:local:track:1',
          title: 'Jóga',
          artists: [{ urn: 'BBeBee:local:artist:bjork', name: 'Björk', role: 'main', ordinal: 0 }],
        },
      },
    )
    const { container } = render(h(QueueScreen, { ctx }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Jóga')
    expect(container.textContent).toContain('Björk')
    expect(container.textContent, 'the raw URN is gone once resolved').not.toContain(
      'BBeBee:local:track:1',
    )
  })
})
