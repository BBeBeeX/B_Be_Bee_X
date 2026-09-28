/**
 * The full-pane now-playing screen — desktop.
 *
 * Delegates layout to one of four style components (classic, full-cover,
 * vinyl, compact) selected by `useNowPlayingStyle`.  This file owns the
 * outer chrome (background, close button, style switcher) and the data
 * hooks; the style components own only spatial arrangement.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import {
  useDuration,
  usePosition,
  useTransport,
  useTransportAvailability,
} from '@BBeBee/plugin-player/hooks'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useServiceState } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { useNowPlayingStyle } from '@BBeBee/plugin-now-playing/hooks'
import { NOW_PLAYING_LAYOUT_MAP, SandboxedLayout } from '../styles/index.js'
import { StyleSwitcher } from './StyleSwitcher.js'

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
  const { styleId, setStyle } = useNowPlayingStyle(ctx)

  const allStyles = useServiceState(
    ctx,
    ['now-playing/registry-changed'],
    () => ctx.nowPlaying?.getStyles?.() ?? NOW_PLAYING_STYLES,
  )
  const currentMeta = allStyles.find((s) => s.id === styleId)
  const isSandboxed = currentMeta?.type === 'sandboxed'

  const PanelComponent = useServiceState(ctx, ['ui/changed'], () => {
    const panelSlots = ctx.ui?.slotsFor?.('now-playing.panel') ?? []
    if (panelSlots[0]) {
      return (ctx.ui?.viewFor?.(panelSlots[0].id) as React.ComponentType<{ ctx: Context }> | undefined) ?? null
    }
    return (ctx.ui?.viewFor?.('lyrics.panel') as React.ComponentType<{ ctx: Context }> | undefined) ?? null
  })

  const VisualizerComponent = useServiceState(ctx, ['ui/changed'], () => {
    const visualizerSlots = ctx.ui?.slotsFor?.('now-playing.visualizer') ?? []
    if (visualizerSlots[0]) {
      return (ctx.ui?.viewFor?.(visualizerSlots[0].id) as React.ComponentType<{ ctx: Context }> | undefined) ?? null
    }
    return (ctx.ui?.viewFor?.('visualizer.canvas') as React.ComponentType<{ ctx: Context }> | undefined) ?? null
  })

  const BuiltinLayout = NOW_PLAYING_LAYOUT_MAP[styleId as keyof typeof NOW_PLAYING_LAYOUT_MAP] ?? NOW_PLAYING_LAYOUT_MAP.classic

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
        background: 'var(--bg-app, #05060B)',
        overflowX: 'hidden',
        borderBottom: 'none',
      },
    },
    /* ── close button (top-left) ──────────────────────────────────── */
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
    /* ── style switcher (top-right) ───────────────────────────────── */
    h(StyleSwitcher, { ctx, styleId, onStyleChange: setStyle }),
    /* ── layout body ──────────────────────────────────────────────── */
    isSandboxed && currentMeta
      ? h(SandboxedLayout, {
          ctx,
          onClose,
          state,
          position,
          displayPosition,
          duration,
          can,
          seekingPosition,
          onSeekChange: (value: number) => setSeekingPosition(value),
          onSeekCommit: (value: number) => {
            setSeekingPosition(undefined)
            void ctx.player.seek(value)
          },
          PanelComponent,
          VisualizerComponent,
          meta: currentMeta,
        })
      : h(BuiltinLayout, {
          ctx,
          onClose,
          state,
          position,
          displayPosition,
          duration,
          can,
          seekingPosition,
          onSeekChange: (value: number) => setSeekingPosition(value),
          onSeekCommit: (value: number) => {
            setSeekingPosition(undefined)
            void ctx.player.seek(value)
          },
          PanelComponent,
          VisualizerComponent,
        }),
  )
}
