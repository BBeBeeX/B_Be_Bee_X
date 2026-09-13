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
import type { QueueItem, TransportState } from '@BBeBee/protocol'
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

async function harness(state: Partial<TransportState> = {}, queue: QueueItem[] = []) {
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
  }

  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    navigate = (routeId: string) => void calls.push(`navigate:${routeId}`)
  }

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
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

  it('renders queue items when queue has tracks', async () => {
    const { ctx } = await harness(
      { currentItemId: 'q-1' },
      [{ id: 'q-1', trackUrn: 'BBeBee:local:track:1', addedBy: 'user' }],
    )
    const { container } = render(h(QueueScreen, { ctx }))
    expect(container.textContent).toContain('BBeBee:local:track:1')
  })
})
