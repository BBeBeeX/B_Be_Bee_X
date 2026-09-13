/**
 * React Native views for `plugin-player`.
 *
 * The same hooks, the same view ids, the same behaviour — only the elements
 * and the *shape* differ. On mobile "now playing" is a full screen rather
 * than a bar, which is the platform difference ADR-2 accepts paying for.
 *
 * Layout and event wiring only. Anything here that would also be true on
 * desktop belongs in `plugin-player/hooks` (docs/08 1).
 */

import { createElement as h } from 'react'
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
  nativePrimitives,
} from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

export interface NowPlayingScreenProps {
  ctx: Context
  onClose?: () => void
}

/** The full-screen player. */
export function NowPlayingScreen({ ctx, onClose }: NowPlayingScreenProps): ReactElement {
  const native = nativePrimitives()
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)

  return h(
    native.View as never,
    {
      accessibilityLabel: 'Now playing',
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[5],
        padding: tokens.space[5],
        backgroundColor: p().bg.base,
      },
    },
    onClose
      ? h(
          native.Pressable as never,
          {
            accessibilityRole: 'button',
            accessibilityLabel: 'Close player',
            onPress: onClose,
            style: {
              alignSelf: 'flex-start',
              paddingVertical: tokens.space[1],
              paddingHorizontal: tokens.space[3],
              borderRadius: tokens.radius.pill,
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            },
          },
          h(Text, { variant: 'lg', children: '⌄' }),
        )
      : null,
    // Artwork first and large: on a phone this screen is mostly the artwork,
    // which is the one thing a bottom bar cannot do.
    h(Artwork, {
      artwork: state.nowPlaying?.artwork,
      seed: state.trackUrn,
      size: 280,
      radius: tokens.radius.lg,
    }),
    h(
      native.View as never,
      { style: { alignItems: 'center', gap: tokens.space[1], maxWidth: '90%' } },
      h(Text, {
        variant: 'xl',
        numberOfLines: 1,
        children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
      }),
      state.nowPlaying?.artist
        ? h(Text, { variant: 'md', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.artist })
        : null,
      state.nowPlaying?.album
        ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.album })
        : null,
    ),
    state.status === 'stalled'
      ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' })
      : null,
    h(
      native.View as never,
      { style: { alignSelf: 'stretch', gap: tokens.space[1] } },
      h(Slider, {
        value: duration ? Math.min(position, duration) : position,
        max: duration ?? 0,
        disabled: !can.canSeek,
        accessibilityLabel: 'Seek',
        onCommit: (value: number) => void ctx.player.seek(value),
      }),
      h(
        native.View as never,
        { style: { flexDirection: 'row', justifyContent: 'space-between' } },
        h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(position) }),
        h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(duration) }),
      ),
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[4] } },
      h(IconButton, {
        icon: '⏮',
        accessibilityLabel: 'Previous track',
        disabled: !can.canPrevious,
        onPress: () => void ctx.player.previous(),
      }),
      h(IconButton, {
        // One control with two states, exactly as on desktop.
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
        track: { urn: item.trackUrn, title: item.trackUrn, artists: [] } as Track,
        active: item.id === state.currentItemId,
        // Same narrowing as desktop: there is no "jump to this queue item" on
        // PlayerService yet, and an affordance that quietly does something
        // else is worse than one that does less.
        onPress: () => void ctx.player.playNow([item.trackUrn]),
      }),
  })
}

export interface NowPlayingBarProps {
  ctx: Context
  onOpenNowPlaying?: () => void
}

/** The persistent transport bar on mobile. */
export function NowPlayingBar({ ctx, onOpenNowPlaying }: NowPlayingBarProps): ReactElement {
  const native = nativePrimitives()
  const state = useTransport(ctx)
  const can = useTransportAvailability(ctx)

  const handleOpen = () => {
    onOpenNowPlaying?.()
    ctx.ui?.navigate?.(PLAYER_VIEWS.nowPlaying)
  }

  if (!state.trackUrn && state.status === 'idle') {
    return h(native.View as never, { style: { display: 'none' } })
  }

  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: 'Open now playing',
      onPress: handleOpen,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: tokens.space[3],
        paddingVertical: tokens.space[2],
        backgroundColor: '#181822',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.08)',
      },
    },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space[3],
          flex: 1,
          minWidth: 0,
          marginRight: tokens.space[2],
        },
      },
      h(Artwork, {
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: tokens.size.artworkThumb,
        radius: tokens.radius.sm,
      }),
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
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
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center' } },
      h(IconButton, {
        icon: can.canPause ? '⏸' : '▶',
        accessibilityLabel: can.canPause ? 'Pause' : 'Play',
        variant: 'ghost',
        size: tokens.size.icon,
        disabled: !can.canPlay && !can.canPause,
        onPress: () => ctx.player.togglePlay(),
      }),
    ),
  )
}

export const name = 'plugin-player-ui-mobile'

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
  return ctx.effect(function* () {
    yield ctx.ui.registerView(PLAYER_VIEWS.nowPlaying, bound(ctx, NowPlayingScreen))
    yield ctx.ui.registerView(PLAYER_VIEWS.nowPlayingBar, bound(ctx, NowPlayingBar))
    yield ctx.ui.registerView(PLAYER_VIEWS.queue, bound(ctx, QueueScreen))
  }, 'player-ui-mobile')
}

export default { name, inject, apply }
