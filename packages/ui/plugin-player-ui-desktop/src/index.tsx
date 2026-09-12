/**
 * React DOM views for `plugin-player`.
 *
 * Layout, gestures and event wiring — nothing else. Every value comes from a
 * hook in the headless package, and if an `if` here also belongs in the mobile
 * view, it belongs in `plugin-player/hooks` instead (docs/08 1).
 *
 * On desktop the "now playing" surface is a persistent bottom bar rather than
 * a screen: that difference is genuinely platform-shaped, which is why ADR-2
 * accepts writing the view twice.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { QueueItem, Track } from '@BBeBee/protocol'
import { formatDuration } from '@BBeBee/toolkit'
import { PLAYER_VIEWS } from '@BBeBee/plugin-player/views'
import {
  usePosition,
  useDuration,
  useQueue,
  useTransport,
  useTransportAvailability,
} from '@BBeBee/plugin-player/hooks'
import {
  Artwork,
  EmptyState,
  IconButton,
  List,
  Slider,
  Text,
  TrackRow,
} from '@BBeBee/ui-kit-desktop'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

export interface NowPlayingBarProps {
  ctx: Context
  onOpenNowPlaying?: () => void
}

/** The persistent transport bar. Desktop's answer to "now playing". */
export function NowPlayingBar({ ctx, onOpenNowPlaying }: NowPlayingBarProps): ReactElement {
  const [coverHovered, setCoverHovered] = useState(false)
  const [seekingPosition, setSeekingPosition] = useState<number | undefined>(undefined)
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)
  const displayPosition = seekingPosition ?? position

  const handleOpenNowPlaying = () => {
    onOpenNowPlaying?.()
    ctx.ui?.navigate?.(PLAYER_VIEWS.nowPlaying)
  }

  return h(
    'div',
    {
      role: 'region',
      'aria-label': 'Now playing',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[4],
        padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
        borderTop: 'none',
        background: '#000000',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[3],
          width: 240,
          minWidth: 180,
          overflow: 'hidden',
        },
      },
      h(
        'div',
        {
          role: 'button',
          tabIndex: 0,
          'aria-label': 'Open now playing',
          onClick: handleOpenNowPlaying,
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleOpenNowPlaying()
            }
          },
          onMouseEnter: () => setCoverHovered(true),
          onMouseLeave: () => setCoverHovered(false),
          style: {
            position: 'relative',
            width: tokens.size.artworkThumb,
            height: tokens.size.artworkThumb,
            borderRadius: tokens.radius.sm,
            overflow: 'hidden',
            cursor: 'pointer',
            flexShrink: 0,
          },
        },
        h(Artwork, {
          artwork: state.nowPlaying?.artwork,
          seed: state.trackUrn,
          size: tokens.size.artworkThumb,
          radius: tokens.radius.sm,
        }),
        h(
          'div',
          {
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.5)',
              opacity: coverHovered ? 1 : 0,
              transition: `opacity ${tokens.duration.fast}ms ease`,
              pointerEvents: 'none',
            },
          },
          h(
            'svg',
            {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: '#FFFFFF',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': true,
            },
            h('polyline', { points: '15 3 21 3 21 9' }),
            h('polyline', { points: '9 21 3 21 3 15' }),
            h('line', { x1: '21', y1: '3', x2: '14', y2: '10' }),
            h('line', { x1: '3', y1: '21', x2: '10', y2: '14' }),
          ),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          },
        },
        h(Text, {
          variant: 'sm',
          numberOfLines: 1,
          children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
        }),
        state.nowPlaying?.artist
          ? h(Text, {
              variant: 'xs',
              tone: 'muted',
              numberOfLines: 1,
              children: state.nowPlaying.artist,
            })
          : null,
      ),
    ),
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space[1],
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
        h(IconButton, {
          icon: '⏮',
          accessibilityLabel: 'Previous track',
          disabled: !can.canPrevious,
          onPress: () => void ctx.player.previous(),
        }),
        h(IconButton, {
          // One control, two states: a play button that is sometimes a pause
          // button is what every player has, and two controls would be wrong.
          icon: can.canPause ? '⏸' : '▶',
          accessibilityLabel: can.canPause ? 'Pause' : 'Play',
          variant: 'primary',
          disabled: !can.canPlay && !can.canPause,
          onPress: () => ctx.player.togglePlay(),
        }),
        h(IconButton, {
          icon: '⏭',
          accessibilityLabel: 'Next track',
          disabled: !can.canNext,
          onPress: () => void ctx.player.next(),
        }),
      ),
      h(
        'div',
        {
          style: {
            width: '100%',
            maxWidth: 560,
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
          },
        },
        // `stalled` is not `paused`: the UI says buffering and the lock screen
        // keeps reporting playing, so neither flickers on an underrun.
        state.status === 'stalled'
          ? h(Text, { variant: 'xs', tone: 'muted', children: 'Buffering…' })
          : null,
        h(
          'span',
          { style: { minWidth: 36, textAlign: 'right', display: 'inline-block' } },
          h(Text, {
            variant: 'xs',
            tone: 'muted',
            children: formatDuration(displayPosition),
          }),
        ),
        h(Slider, {
          value: duration ? Math.min(displayPosition, duration) : displayPosition,
          max: duration ?? 0,
          disabled: !can.canSeek,
          accessibilityLabel: 'Seek',
          onChange: (value: number) => setSeekingPosition(value),
          onCommit: (value: number) => {
            setSeekingPosition(undefined)
            void ctx.player.seek(value)
          },
        }),
        h(
          'span',
          { style: { minWidth: 36, display: 'inline-block' } },
          h(Text, {
            variant: 'xs',
            tone: 'muted',
            children: formatDuration(duration),
          }),
        ),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: tokens.space[2],
          width: 240,
          minWidth: 180,
        },
      },
      h(IconButton, {
        icon: state.muted ? '🔇' : '🔊',
        accessibilityLabel: state.muted ? 'Unmute' : 'Mute',
        onPress: () => ctx.player.setMuted(!state.muted),
      }),
      h(Slider, {
        value: Math.round(state.volume * 100),
        max: 100,
        accessibilityLabel: 'Volume',
        onCommit: (value: number) => ctx.player.setVolume(value / 100),
      }),
    ),
  )
}

/** The up-next list. */
export function QueueScreen({ ctx }: { ctx: Context }): ReactElement {
  const queue = useQueue(ctx)
  const state = useTransport(ctx)

  if (queue.length === 0) {
    return h(EmptyState, {
      icon: '🎵',
      title: 'Nothing queued',
      description: 'Play something from your library and it will show up here.',
    })
  }

  return h(List<QueueItem>, {
    items: queue,
    accessibilityLabel: 'Queue',
    estimatedItemSize: tokens.size.row,
    keyExtractor: (item) => item.id,
    renderItem: (item) =>
      h(TrackRow, {
        // The queue holds URNs, not tracks; the title arrives with the
        // catalogue read the row does for itself in a later milestone.
        track: { urn: item.trackUrn, title: item.trackUrn, artists: [] } as Track,
        active: item.id === state.currentItemId,
        // `PlayerService` has no "jump to this queue item" today, so the row
        // plays its track rather than pretending to reposition the queue —
        // an affordance that silently does the wrong thing is worse than a
        // narrower one that does the right thing.
        onPress: () => void ctx.player.playNow([item.trackUrn]),
      }),
  })
}

export interface NowPlayingScreenProps {
  ctx: Context
  onClose?: () => void
}

/** The full-pane player view on desktop. */
export function NowPlayingScreen({ ctx, onClose }: NowPlayingScreenProps): ReactElement {
  const [seekingPosition, setSeekingPosition] = useState<number | undefined>(undefined)
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)
  const displayPosition = seekingPosition ?? position

  return h(
    'div',
    {
      role: 'region',
      'aria-label': 'Now playing',
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: `${tokens.space[6]}px ${tokens.space[4]}px`,
        gap: tokens.space[5],
        background: p().bg.base,
      },
    },
    h(
      'button',
      {
        type: 'button',
        'aria-label': 'Close now playing',
        onClick: onClose,
        style: {
          position: 'absolute',
          top: tokens.space[5],
          left: tokens.space[5],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: tokens.radius.pill,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'rgba(255, 255, 255, 0.08)',
          color: p().text.primary,
          cursor: 'pointer',
          transition: `background-color ${tokens.duration.fast}ms, transform ${tokens.duration.fast}ms`,
          zIndex: 10,
          WebkitAppRegion: 'no-drag' as unknown as undefined,
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.16)'
          e.currentTarget.style.transform = 'scale(1.06)'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.transform = 'scale(1)'
        },
      },
      h(
        'svg',
        {
          width: 22,
          height: 22,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('polyline', { points: '6 9 12 15 18 9' }),
      ),
    ),
    h(Artwork, {
      artwork: state.nowPlaying?.artwork,
      seed: state.trackUrn,
      size: 280,
      radius: tokens.radius.lg,
    }),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: tokens.space[1],
          maxWidth: 480,
          textAlign: 'center',
        },
      },
      h(Text, {
        variant: 'xl',
        numberOfLines: 1,
        children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
      }),
      state.nowPlaying?.artist
        ? h(Text, {
            variant: 'md',
            tone: 'muted',
            numberOfLines: 1,
            children: state.nowPlaying.artist,
          })
        : null,
      state.nowPlaying?.album
        ? h(Text, {
            variant: 'sm',
            tone: 'muted',
            numberOfLines: 1,
            children: state.nowPlaying.album,
          })
        : null,
    ),
    state.status === 'stalled'
      ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' })
      : null,
    h(
      'div',
      {
        style: {
          width: '100%',
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[1],
        },
      },
      h(Slider, {
        value: duration ? Math.min(displayPosition, duration) : displayPosition,
        max: duration ?? 0,
        disabled: !can.canSeek,
        accessibilityLabel: 'Seek',
        onChange: (value: number) => setSeekingPosition(value),
        onCommit: (value: number) => {
          setSeekingPosition(undefined)
          void ctx.player.seek(value)
        },
      }),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between' } },
        h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(displayPosition) }),
        h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(duration) }),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[4] } },
      h(IconButton, {
        icon: '⏮',
        accessibilityLabel: 'Previous track',
        disabled: !can.canPrevious,
        onPress: () => void ctx.player.previous(),
      }),
      h(IconButton, {
        icon: can.canPause ? '⏸' : '▶',
        accessibilityLabel: can.canPause ? 'Pause' : 'Play',
        variant: 'primary',
        size: tokens.size.iconLarge,
        disabled: !can.canPlay && !can.canPause,
        onPress: () => ctx.player.togglePlay(),
      }),
      h(IconButton, {
        icon: '⏭',
        accessibilityLabel: 'Next track',
        disabled: !can.canNext,
        onPress: () => void ctx.player.next(),
      }),
    ),
  )
}

export const name = 'plugin-player-ui-desktop'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.player` through its hooks threw
 * `cannot get property "player" without inject` on a device while every
 * test passed, because tests built a root context where that read answers
 * `undefined` instead.
 *
 * Registering a closure over the context this plugin was applied with is the
 * fix, and it is what every view package here does: the screen runs on a
 * context with exactly what this package's `inject` declares. The shell's
 * props are still forwarded, so a view that takes more than `ctx` keeps
 * working.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  // `h(Screen, …)`, not `Screen(…)`: calling a component as a function splices
  // its hooks into this one's list, which works right up until someone renders
  // it conditionally. An element keeps them separate.
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export const inject = ['ui', 'player']

export async function apply(ctx: Context) {
  // Bind components to the ids the headless package contributed. A view
  // registered for an id nobody contributed is dead; a contribution with no
  // view renders a placeholder — both are normal, neither is an error.
  return ctx.effect(function* () {
    yield ctx.ui.registerView(PLAYER_VIEWS.nowPlaying, bound(ctx, NowPlayingScreen))
    yield ctx.ui.registerView(PLAYER_VIEWS.nowPlayingBar, bound(ctx, NowPlayingBar))
    yield ctx.ui.registerView(PLAYER_VIEWS.queue, bound(ctx, QueueScreen))
  }, 'player-ui-desktop')
}

export default { name, inject, apply }
