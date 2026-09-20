/**
 * React DOM views for `@BBeBee/plugin-now-playing`.
 *
 * Two surfaces, moved here together from `plugin-player-ui-desktop`: the
 * persistent bottom bar, and the full-pane player it opens. They are one
 * presentation — a bar with no page behind it is a dead control, and the
 * page's close button returns to the bar.
 *
 * Layout, gestures and event wiring only: every value comes from
 * `@BBeBee/plugin-player/hooks`, and anything that would also be true on
 * mobile belongs in the headless package instead (docs/08 §1).
 */

import { createElement as h, useState } from 'react'
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
import { Artwork, IconButton, Slider, Text } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { serviceOf, useServiceState, type ArtworkProps } from '@BBeBee/ui-core'
import type { DesktopLyricsService } from '@BBeBee/protocol'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/**
 * Toggle button for floating desktop lyrics.
 */
function DesktopLyricsToggle({ ctx }: { ctx: Context }): ReactElement {
  const isVisible = useServiceState<boolean>(
    ctx,
    ['desktop-lyrics/changed'],
    () => serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')?.state.visible ?? false,
  )

  const handleToggle = () => {
    const service = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
    if (service) {
      service.toggleVisible()
    } else {
      void ctx.ui?.runCommand?.('desktop-lyrics.toggle')
    }
  }

  return h(
    'button',
    {
      type: 'button',
      'aria-label': isVisible ? '隐藏桌面歌词' : '显示桌面歌词',
      title: isVisible ? '隐藏桌面歌词' : '显示桌面歌词',
      onClick: handleToggle,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: tokens.radius.sm,
        border: isVisible ? '1px solid #A78BFA' : '1px solid rgba(255, 255, 255, 0.16)',
        background: isVisible ? 'rgba(124, 58, 237, 0.3)' : 'transparent',
        color: isVisible ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none',
        flexShrink: 0,
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isVisible ? '#A78BFA' : 'rgba(255, 255, 255, 0.4)'
        e.currentTarget.style.color = '#FFFFFF'
        e.currentTarget.style.transform = 'scale(1.05)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isVisible ? '#A78BFA' : 'rgba(255, 255, 255, 0.16)'
        e.currentTarget.style.color = isVisible ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)'
        e.currentTarget.style.transform = 'scale(1)'
      },
    },
    '词',
  )
}

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
    ctx.ui?.navigate?.(NOW_PLAYING_VIEWS.nowPlaying)
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
        h(CachedArtwork, { ctx,
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
      h(DesktopLyricsToggle, { ctx }),
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

  const PanelComponent = useServiceState(ctx, ['ui/changed'], () => {
    const panelSlots = ctx.ui?.slotsFor?.('now-playing.panel') ?? []
    if (panelSlots[0]) {
      return (ctx.ui?.viewFor?.(panelSlots[0].id) as React.ComponentType<{ ctx: Context }> | undefined) ?? null
    }
    return (ctx.ui?.viewFor?.('lyrics.panel') as React.ComponentType<{ ctx: Context }> | undefined) ?? null
  })

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
    (() => {
      const playerMain = h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens.space[5],
            maxWidth: 480,
            width: '100%',
          },
        },
        h(CachedArtwork, {
          ctx,
          artwork: state.nowPlaying?.artwork,
          seed: state.trackUrn,
          size: PanelComponent ? 240 : 280,
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

      if (!PanelComponent) {
        return playerMain
      }

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            maxWidth: 1100,
            gap: tokens.space[6],
            flex: 1,
            minHeight: 0,
            height: '100%',
            boxSizing: 'border-box',
          },
        },
        h(
          'div',
          {
            style: {
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 320,
              maxWidth: 460,
            },
          },
          playerMain,
        ),
        h(
          'div',
          {
            style: {
              flex: 1.2,
              display: 'flex',
              height: '80vh',
              maxHeight: '80vh',
              minWidth: 340,
              maxWidth: 600,
              minHeight: 0,
              borderRadius: tokens.radius.lg,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            },
          },
          h(PanelComponent, { ctx }),
        ),
      )
    })(),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-now-playing-ui-desktop'

export const inject = ['ui', 'player']

/**
 * Register a component bound to **this** context, not the shell's.
 *
 * The shell renders views with the context it was mounted on, and a Cordis
 * context throws for any property outside its inject list; every view package
 * closes over its own plugin context for exactly this reason (docs/08 §3).
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
  ctx.logger.info('plugin-now-playing-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.nowPlaying, bound(ctx, NowPlayingScreen))
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.bar, bound(ctx, NowPlayingBar))
  }, 'now-playing-ui-desktop')
}

export default { name, inject, apply }
