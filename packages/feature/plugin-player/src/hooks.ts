/**
 * View hooks for `ctx.player`.
 *
 * They live in the **headless** package, not in the two view packages, and
 * that is the whole reason ADR-2 stays affordable: the part with actual logic
 * — which events invalidate which state, how a position is interpolated —
 * is written once, and only the JSX is written twice (docs/08 4).
 *
 * If you are about to write the same `if` in both view packages, it belongs
 * here instead.
 */

import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import type { NowPlayingMeta, QueueItem, TransportState } from '@BBeBee/protocol'
import { shallowArrayEqual, useServiceState } from '@BBeBee/ui-core'

/** The transport, re-read whenever it changes. */
export function useTransport(ctx: Context): TransportState {
  return useServiceState(
    ctx,
    ['player/state-changed', 'player/track-changed'],
    () => ctx.player.state,
  )
}

/** The currently playing track's metadata (artwork, title, artist, album). */
export function useNowPlaying(ctx: Context): NowPlayingMeta | undefined {
  const state = useTransport(ctx)
  return state.nowPlaying
}

/**
 * The queue.
 *
 * Compared element-wise: `queue/changed` hands out a fresh array of the same
 * items, and re-rendering a 5,000-row list because the wrapper changed is the
 * difference between a scroll and a stutter.
 */
export function useQueue(ctx: Context): readonly QueueItem[] {
  return useServiceState(ctx, ['queue/changed'], () => ctx.player.queue, {
    isEqual: shallowArrayEqual,
  })
}

/**
 * Playback position, interpolated between the service's 1 Hz ticks.
 *
 * `player/position` fires once a second (docs/07 5) because at 60 Hz it would
 * dominate the event bus for no benefit. A progress bar driven straight off it
 * visibly steps. So the event resynchronises and `requestAnimationFrame`
 * fills the gap — which is why this is a hook and not a selector.
 *
 * ⚠️ It deliberately returns a number that changes ~60 times a second. Use it
 * for the scrubber and the elapsed-time label, never for a component that
 * renders a list.
 */
export function usePosition(ctx: Context): number {
  const state = useTransport(ctx)
  const [position, setPosition] = useState(state.positionMs)

  // The last authoritative reading, and when we received it.
  const anchor = useRef({ positionMs: state.positionMs, at: now() })

  useEffect(() => {
    const off = ctx.on('player/position', (positionMs: number) => {
      anchor.current = { positionMs, at: now() }
      setPosition(positionMs)
    })
    return () => void off()
  }, [ctx])

  // Re-anchor on any transport change: a seek, a pause, or a new track all
  // move the position without a tick, and interpolating from a stale anchor
  // shows time advancing through a paused track.
  useEffect(() => {
    anchor.current = { positionMs: state.positionMs, at: now() }
    setPosition(state.positionMs)
  }, [state.positionMs, state.trackUrn, state.status])

  useEffect(() => {
    if (state.status !== 'playing') return
    let frame = 0
    const tick = () => {
      const { positionMs, at } = anchor.current
      const elapsed = now() - at
      // Clamped to the duration: interpolating past the end shows a scrubber
      // overshooting in the moment before the track-change event lands.
      const bound = state.durationMs > 0 ? state.durationMs : Number.POSITIVE_INFINITY
      setPosition(Math.min(positionMs + elapsed, bound))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ctx, state.status, state.durationMs])

  return position
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Which transport controls are usable right now.
 *
 * Derived once here rather than as four `disabled=` expressions written twice.
 * A control that is present but does nothing is worse than an absent one.
 */
export interface TransportAvailability {
  canPlay: boolean
  canPause: boolean
  canSeek: boolean
  canNext: boolean
  canPrevious: boolean
}

/**
 * Whether the transport is playing, from the user's point of view.
 *
 * ⚠️ `stalled` counts. A buffer underrun is not a pause — docs/05 §2 keeps the
 * lock screen reporting *playing* through one precisely so nothing flickers —
 * and a bar that swapped to a play button mid-buffer would contradict the lock
 * screen a foot away from it. `loading` counts for the same reason: the user
 * pressed play and is waiting.
 */
export function isPlayingLike(status: TransportState['status']): boolean {
  return status === 'playing' || status === 'stalled' || status === 'loading'
}

export function useTransportAvailability(ctx: Context): TransportAvailability {
  const state = useTransport(ctx)
  const queue = useQueue(ctx)
  const index = queue.findIndex((item) => item.id === state.currentItemId)
  const playing = isPlayingLike(state.status)

  return {
    canPlay: !playing && queue.length > 0,
    canPause: playing,
    // A live stream has no duration to seek within.
    canSeek: state.durationMs > 0,
    canNext: queue.length > 0 && (state.repeat === 'all' || index < queue.length - 1),
    // `previous` restarts the current track before the threshold, so it is
    // available even on the first item — that is the behaviour, not a bug.
    canPrevious: queue.length > 0,
  }
}

/**
 * The track's duration, or `undefined` when there is not one.
 *
 * `TransportState.durationMs` is `0` both for "not known yet" and for a live
 * stream, and rendering that through `formatDuration` produces `0:00` — which
 * tells the user the stream is zero seconds long. The distinction is shared
 * logic, so it lives here rather than as a `|| undefined` written twice.
 */
export function useDuration(ctx: Context): number | undefined {
  const state = useTransport(ctx)
  return state.durationMs > 0 ? state.durationMs : undefined
}

