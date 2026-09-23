import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { formatDuration } from '@BBeBee/toolkit'
import {
  useDuration,
  usePosition,
  useTransport,
  useTransportAvailability,
} from '@BBeBee/plugin-player/hooks'
import { IconButton, Slider, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useServiceState } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from './NowPlayingBar.js'

const p = () => palettes.dark

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
      tablerIcon('chevron-down', { size: 26 }),
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
          h(PlayModeButton, { ctx, mode: state.playMode }),
          h(IconButton, {
            icon: 'skip-back',
            accessibilityLabel: 'Previous track',
            disabled: !can.canPrevious,
            onPress: () => void ctx.player.previous(),
          }),
          h(IconButton, {
            icon: can.canPause ? 'pause-filled' : 'play-filled',
            accessibilityLabel: can.canPause ? 'Pause' : 'Play',
            variant: 'primary',
            size: tokens.size.iconLarge,
            disabled: !can.canPlay && !can.canPause,
            onPress: () => ctx.player.togglePlay(),
          }),
          h(IconButton, {
            icon: 'skip-forward',
            accessibilityLabel: 'Next track',
            disabled: !can.canNext,
            onPress: () => void ctx.player.next(),
          }),
          h(VolumeControl, { ctx, volume: state.volume, muted: state.muted }),
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
