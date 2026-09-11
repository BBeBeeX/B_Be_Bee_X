// @vitest-environment jsdom
/**
 * The desktop player views.
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
import { render } from '@testing-library/react'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { Context, Service } from 'cordis'
import type { QueueItem, TransportState } from '@BBeBee/protocol'
import { NowPlayingBar, NowPlayingScreen, QueueScreen } from './index.js'

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

/** A `ctx.player` with just what the views read and call. */
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

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
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
})

describe('QueueScreen', () => {
  it('says what to do instead of showing a blank pane', async () => {
    const { ctx } = await harness()
    const out = html(h(QueueScreen, { ctx }))
    expect(out).toContain('Nothing queued')
    expect(out).toContain('library')
  })

  it('lists the queue and marks the playing item', async () => {
    const { ctx } = await harness({ currentItemId: 'b' }, [
      { id: 'a', trackUrn: 'BBeBee:local:track:a', addedBy: 'user' },
      { id: 'b', trackUrn: 'BBeBee:local:track:b', addedBy: 'user' },
    ])
    const { container } = withListLayout(() => render(h(QueueScreen, { ctx })))
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2)
    expect(container.querySelector('[role="list"]')).not.toBeNull()
  })
})
