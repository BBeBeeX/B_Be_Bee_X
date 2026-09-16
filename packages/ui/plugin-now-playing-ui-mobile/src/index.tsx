/**
 * React Native views for `@BBeBee/plugin-now-playing`.
 *
 * The same two surfaces as the desktop twin — the full-screen player and the
 * mini-player that opens it — transcribed onto the phone. Moved here together
 * from `plugin-player-ui-mobile`, because a bar with no page behind it is a
 * dead control.
 *
 * Layout, gestures and event wiring only: every value comes from
 * `@BBeBee/plugin-player/hooks`, and anything that would also be true on
 * desktop belongs in the headless package instead (docs/08 §1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { formatDuration } from '@BBeBee/toolkit'
import { NOW_PLAYING_VIEWS } from '@BBeBee/plugin-now-playing/views'
import {
  useDuration,
  usePosition,
  useTransport,
  useTransportAvailability,
} from '@BBeBee/plugin-player/hooks'
import { Artwork, IconButton, Slider, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 *
 * A component rather than a bare hook call at each site because both
 * surfaces render the same cover and the hook suppresses the remote URL while
 * the cache fetches, so the fallback paints instead of a second request.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

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
    h(CachedArtwork, { ctx,
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
    ctx.ui?.navigate?.(NOW_PLAYING_VIEWS.nowPlaying)
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
      h(CachedArtwork, { ctx,
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

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-now-playing-ui-mobile'

export const inject = ['ui', 'player']

/**
 * Register a component bound to **this** context, not the shell's — the same
 * rule as the desktop twin, and the reason this closure exists (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-now-playing-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.nowPlaying, bound(ctx, NowPlayingScreen))
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.bar, bound(ctx, NowPlayingBar))
  }, 'now-playing-ui-mobile')
}

export default { name, inject, apply }
