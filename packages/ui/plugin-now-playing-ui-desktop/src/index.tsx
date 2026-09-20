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

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  DesktopLyricsService,
  DesktopLyricsSettings,
  PlayMode,
  SettingsService,
} from '@BBeBee/protocol'
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
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/**
 * Toggle button for floating desktop lyrics.
 * Synchronized bidirectionally with ctx.desktopLyrics and ctx.settings.
 */
function DesktopLyricsToggle({ ctx }: { ctx: Context }): ReactElement {
  const isVisible = useServiceState<boolean>(
    ctx,
    ['desktop-lyrics/changed', 'settings/changed'],
    () => {
      const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
      if (dl) return dl.state.visible
      const settings = serviceOf<SettingsService>(ctx, 'settings')
      return settings?.getSync()?.desktopLyrics?.enabled ?? false
    },
  )

  const handleToggle = () => {
    const service = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
    if (service) {
      service.toggleVisible()
    } else {
      const settings = serviceOf<SettingsService>(ctx, 'settings')
      if (settings) {
        const cur = settings.getSync()?.desktopLyrics
        void settings.update({
          desktopLyrics: {
            ...cur,
            enabled: !(cur?.enabled ?? false),
          } as DesktopLyricsSettings,
        })
      }
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

const PLAY_MODE_INFO: Record<PlayMode, { label: string; next: string }> = {
  sequence: { label: '顺序播放', next: '切换为列表循环' },
  'list-loop': { label: '列表循环', next: '切换为单曲循环' },
  'single-loop': { label: '单曲循环', next: '切换为随机播放' },
  shuffle: { label: '随机播放', next: '切换为顺序播放' },
}

function renderPlayModeIcon(mode: PlayMode): ReactElement {
  switch (mode) {
    case 'shuffle':
      return h(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('polyline', { points: '16 3 21 3 21 8' }),
        h('line', { x1: '4', y1: '20', x2: '21', y2: '3' }),
        h('polyline', { points: '21 16 21 21 16 21' }),
        h('line', { x1: '15', y1: '15', x2: '21', y2: '21' }),
        h('line', { x1: '4', y1: '4', x2: '9', y2: '9' }),
      )
    case 'single-loop':
      return h(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M17 2l4 4-4 4' }),
        h('path', { d: 'M3 11v-1a4 4 0 0 1 4-4h14' }),
        h('path', { d: 'M7 22l-4-4 4-4' }),
        h('path', { d: 'M21 13v1a4 4 0 0 1-4 4H3' }),
        h(
          'text',
          {
            x: '12',
            y: '15',
            textAnchor: 'middle',
            fontSize: '9',
            fontWeight: 'bold',
            fill: 'currentColor',
            stroke: 'none',
          },
          '1',
        ),
      )
    case 'list-loop':
      return h(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M17 2l4 4-4 4' }),
        h('path', { d: 'M3 11v-1a4 4 0 0 1 4-4h14' }),
        h('path', { d: 'M7 22l-4-4 4-4' }),
        h('path', { d: 'M21 13v1a4 4 0 0 1-4 4H3' }),
      )
    case 'sequence':
    default:
      return h(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('line', { x1: '3', y1: '6', x2: '17', y2: '6' }),
        h('line', { x1: '3', y1: '12', x2: '17', y2: '12' }),
        h('line', { x1: '3', y1: '18', x2: '13', y2: '18' }),
        h('polyline', { points: '16 15 19 18 16 21' }),
      )
  }
}

function renderMuteIcon(size = 18): ReactElement {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5', fill: 'currentColor' }),
    h('line', { x1: '23', y1: '9', x2: '17', y2: '15' }),
    h('line', { x1: '17', y1: '9', x2: '23', y2: '15' }),
  )
}

function renderVolumeIcon(volume: number, muted: boolean, size = 18): ReactElement {
  if (muted) {
    return renderMuteIcon(size)
  }
  if (volume <= 0) {
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5', fill: 'currentColor' }),
    )
  }
  if (volume <= 0.33) {
    // 1 wave (low)
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5', fill: 'currentColor' }),
      h('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }),
    )
  }
  if (volume <= 0.66) {
    // 2 waves (medium)
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5', fill: 'currentColor' }),
      h('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }),
      h('path', { d: 'M18.36 5.64a9 9 0 0 1 0 12.72' }),
    )
  }
  // 3 waves (high)
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5', fill: 'currentColor' }),
    h('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }),
    h('path', { d: 'M18.36 5.64a9 9 0 0 1 0 12.72' }),
    h('path', { d: 'M21.19 2.81a13 13 0 0 1 0 18.38' }),
  )
}

function VerticalSlider({
  value,
  onChange,
}: {
  value: number
  onChange: (val: number) => void
}): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const updateFromPointer = (clientY: number) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = 1 - (clientY - rect.top) / rect.height
    const clamped = Math.max(0, Math.min(100, Math.round(ratio * 100)))
    onChange(clamped)
  }

  const handlePointerDown = (e: { clientY: number; preventDefault: () => void }) => {
    e.preventDefault()
    isDragging.current = true
    updateFromPointer(e.clientY)

    const onPointerMove = (ev: MouseEvent) => {
      if (isDragging.current) {
        updateFromPointer(ev.clientY)
      }
    }
    const onPointerUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', onPointerUp)
    }
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
  }

  return h(
    'div',
    {
      ref: trackRef,
      role: 'slider',
      tabIndex: 0,
      'aria-label': 'Vertical volume slider',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': value,
      'aria-orientation': 'vertical',
      onMouseDown: handlePointerDown,
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault()
          onChange(Math.min(100, value + 5))
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault()
          onChange(Math.max(0, value - 5))
        }
      },
      style: {
        position: 'relative',
        width: 20,
        height: 100,
        display: 'flex',
        justifyContent: 'center',
        cursor: 'pointer',
        touchAction: 'none',
        outline: 'none',
      },
    },
    // Track rail
    h('div', {
      style: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.18)',
      },
    }),
    // Filled bar
    h('div', {
      style: {
        position: 'absolute',
        bottom: 0,
        width: 4,
        height: `${value}%`,
        borderRadius: 2,
        backgroundColor: '#A78BFA',
      },
    }),
    // Thumb
    h('div', {
      style: {
        position: 'absolute',
        bottom: `calc(${value}% - 6px)`,
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: '#FFFFFF',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.4)',
        transition: 'transform 0.1s ease',
      },
    }),
  )
}

function PlayModeButton({ ctx, mode }: { ctx: Context; mode?: PlayMode }): ReactElement {
  const currentMode = mode ?? 'sequence'
  const info = PLAY_MODE_INFO[currentMode] ?? PLAY_MODE_INFO.sequence
  const handleClick = () => {
    ctx.player.cyclePlayMode()
  }

  return h(
    'button',
    {
      type: 'button',
      'aria-label': `播放模式: ${info.label}`,
      title: `${info.label} (${info.next})`,
      onClick: handleClick,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: tokens.radius.pill,
        border: 'none',
        background: 'transparent',
        color: 'rgba(255, 255, 255, 0.7)',
        cursor: 'pointer',
        transition: 'color 0.15s ease, transform 0.15s ease',
        outline: 'none',
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.color = '#FFFFFF'
        e.currentTarget.style.transform = 'scale(1.1)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
        e.currentTarget.style.transform = 'scale(1)'
      },
    },
    renderPlayModeIcon(currentMode),
  )
}

function VolumeControl({
  ctx,
  volume,
  muted,
}: {
  ctx: Context
  volume: number
  muted: boolean
}): ReactElement {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const percent = Math.round(volume * 100)

  return h(
    'div',
    {
      ref: containerRef,
      style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
    },
    h(
      'button',
      {
        type: 'button',
        'aria-label': 'Volume',
        title: muted ? '已静音 (点击展开调节栏)' : `音量 ${percent}% (点击展开调节栏)`,
        onClick: () => setOpen((prev) => !prev),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: tokens.radius.pill,
          border: 'none',
          background: open ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
          color: muted ? '#A0A0AE' : 'rgba(255, 255, 255, 0.8)',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          outline: 'none',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.color = '#FFFFFF'
          e.currentTarget.style.transform = 'scale(1.1)'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.color = muted ? '#A0A0AE' : 'rgba(255, 255, 255, 0.8)'
          e.currentTarget.style.transform = 'scale(1)'
        },
      },
      renderVolumeIcon(volume, muted),
    ),
    open
      ? h(
          'div',
          {
            role: 'dialog',
            'aria-label': 'Volume control popover',
            style: {
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginBottom: 10,
              width: 44,
              padding: '10px 4px 8px',
              borderRadius: 10,
              backgroundColor: '#1A1A22',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              zIndex: 100,
            },
          },
          h(
            'span',
            { style: { fontSize: 11, color: '#A0A0AE', userSelect: 'none', minHeight: 14 } },
            `${percent}%`,
          ),
          h(VerticalSlider, {
            value: percent,
            onChange: (val) => {
              if (muted) ctx.player.setMuted(false)
              ctx.player.setVolume(val / 100)
            },
          }),
          h(
            'button',
            {
              type: 'button',
              'aria-label': muted ? '恢复声音' : '静音',
              title: muted ? '恢复声音' : '静音',
              onClick: () => ctx.player.setMuted(!muted),
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: tokens.radius.pill,
                border: 'none',
                background: muted ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                color: muted ? '#F87171' : 'rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              },
            },
            muted ? renderMuteIcon(16) : renderVolumeIcon(volume, false, 16),
          ),
        )
      : null,
  )
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
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
        h(PlayModeButton, { ctx, mode: state.playMode }),
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
        h(VolumeControl, { ctx, volume: state.volume, muted: state.muted }),
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
          h(PlayModeButton, { ctx, mode: state.playMode }),
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
