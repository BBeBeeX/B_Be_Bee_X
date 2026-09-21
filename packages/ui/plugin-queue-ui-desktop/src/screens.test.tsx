// @vitest-environment jsdom
/**
 * The desktop queue screen.
 *
 * What is worth pinning is the behaviour a user would notice and that is easy
 * to get wrong in a view: a control that is present but does nothing, a
 * buffering state shown as paused, an unlabelled transport button.
 *
 * Static markup for most of it; the queue is a virtualised `List`, and a
 * virtualiser with nothing to measure renders an empty window, so that one
 * screen goes through the DOM with `withListLayout`.
 */

import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, fireEvent, render } from '@testing-library/react'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { Context, Service } from 'cordis'
import type { QueueItem, Track, TransportState } from '@BBeBee/protocol'
import { QueueScreen } from './index.js'

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element)

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

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  if (Object.keys(catalogue).length > 0) await ctx.plugin(SourcesStub)
  return { ctx, calls }
}

describe('QueueScreen', () => {
  it('says what to do instead of showing a blank pane', async () => {
    const { ctx } = await harness()
    const out = html(h(QueueScreen, { ctx }))
    expect(out).toContain('Nothing queued')
    expect(out).toContain('library')
  })

  it('lists the queue, marks the playing item, and jumps to a tapped row', async () => {
    const { ctx, calls } = await harness({ currentItemId: 'b' }, [
      { id: 'a', trackUrn: 'BBeBee:local:track:a', addedBy: 'user' },
      { id: 'b', trackUrn: 'BBeBee:local:track:b', addedBy: 'user' },
    ])
    const { container } = withListLayout(() => render(h(QueueScreen, { ctx })))
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2)
    expect(container.querySelector('[role="list"]')).not.toBeNull()

    const row = container.querySelector('[role="row"]') as HTMLElement
    expect(row, 'a queue row is tappable').toBeTruthy()
    row.click()
    // A tap means "play that one" — a jump, never a re-queue of one track.
    expect(calls).toContain('jump:BBeBee:local:track:a')
    expect(calls).not.toContain('playNow:BBeBee:local:track:a')
  })

  it('never shows the URN before the catalogue answers', async () => {
    // The queue resolves through the catalogue, and a URN is not a title. The
    // playing item borrows the transport's metadata — the player resolves it
    // for the lock screen whether or not the catalogue read has landed — and
    // a row still waiting says so rather than showing its key.
    const { ctx } = await harness(
      {
        status: 'playing',
        currentItemId: 'a',
        trackUrn: 'BBeBee:bili:track:1',
        nowPlaying: { title: '极端天气 MV', artist: 'UP主甲' },
      },
      [
        { id: 'a', trackUrn: 'BBeBee:bili:track:1', addedBy: 'user' },
        { id: 'b', trackUrn: 'BBeBee:bili:track:2', addedBy: 'user' },
      ],
    )
    const { container } = withListLayout(() => render(h(QueueScreen, { ctx })))

    expect(container.textContent).toContain('极端天气 MV')
    expect(container.textContent).toContain('UP主甲')
    expect(container.textContent).toContain('Loading…')
    expect(container.textContent, 'no raw URN in the queue, ever').not.toContain('BBeBee:bili:')
  })

  it('shows title and artist from the catalogue rather than the URN', async () => {
    // The rows resolve themselves through one catalogue read; a URN nothing
    // answers for falls back to showing itself (the neighbouring test pins
    // that path — here the answer has landed).
    const { ctx } = await harness(
      { currentItemId: 'a' },
      [{ id: 'a', trackUrn: 'BBeBee:local:track:a', addedBy: 'user' }],
      {
        'BBeBee:local:track:a': {
          urn: 'BBeBee:local:track:a',
          title: 'Jóga',
          artists: [{ urn: 'BBeBee:local:artist:bjork', name: 'Björk', role: 'main', ordinal: 0 }],
        },
      },
    )
    const { container } = withListLayout(() => render(h(QueueScreen, { ctx })))
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Jóga')
    expect(container.textContent).toContain('Björk')
    expect(container.textContent, 'the raw URN is gone once resolved').not.toContain(
      'BBeBee:local:track:a',
    )
  })
})


describe('the queue row menu', () => {
  it('opens on right-click with the actions the loaded services allow', async () => {
    const { ctx } = await harness({ status: 'playing' }, [
      { id: 'a', trackUrn: 'BBeBee:local:track:a', addedBy: 'user' },
    ])
    withListLayout(() => {
      const { container } = render(h(QueueScreen, { ctx }))
      const row = container.querySelector('[role="row"]') as HTMLElement
      expect(row, 'the row is on screen').toBeTruthy()

      act(() => {
        fireEvent.contextMenu(row, { clientX: 40, clientY: 60 })
      })

      // `ctx.player` is loaded, so "add to the play queue" is offered; no
      // library and no downloads here, so their items are absent instead of
      // present and throwing.
      expect(container.textContent).toContain('加入播放列表')
      expect(container.textContent).not.toContain('下载')
      expect(container.querySelector('[role="menu"]')).toBeTruthy()
    })
  })
})
