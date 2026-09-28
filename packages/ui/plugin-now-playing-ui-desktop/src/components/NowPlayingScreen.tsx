/**
 * The full-pane now-playing screen — desktop.
 *
 * Delegates layout to one of four style components (classic, full-cover,
 * vinyl, compact, cinematic) selected by `useNowPlayingStyle`. This file owns the
 * outer chrome (background, close button) and the data hooks;
 * the style components own spatial arrangement.
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
import { useServiceState, serviceOf, shallowArrayEqual } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import type { NowPlayingService, UiService } from '@BBeBee/protocol'
import { NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { useNowPlayingStyle } from '@BBeBee/plugin-now-playing/hooks'
import { NOW_PLAYING_LAYOUT_MAP, SandboxedLayout } from '../styles/index.js'

const p = () => palettes.dark

export interface NowPlayingScreenProps {
  ctx: Context
  onClose?: () => void
  showCloseButton?: boolean
}

/** The full-pane player view on desktop. */
export function NowPlayingScreen({
  ctx,
  onClose,
  showCloseButton = true,
}: NowPlayingScreenProps): ReactElement {
  const [seekingPosition, setSeekingPosition] = useState<number | undefined>(undefined)
  const [isTopHovered, setIsTopHovered] = useState(false)
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)
  const displayPosition = seekingPosition ?? position
  const { styleId } = useNowPlayingStyle(ctx)

  const allStyles = useServiceState(
    ctx,
    ['now-playing/registry-changed'],
    () => serviceOf<NowPlayingService>(ctx, 'nowPlaying')?.getStyles?.() ?? NOW_PLAYING_STYLES,
    { isEqual: shallowArrayEqual },
  )
  const currentMeta = allStyles.find((s) => s.id === styleId)
  const isSandboxed = currentMeta?.type === 'sandboxed'

  const PanelComponent = useServiceState(ctx, ['ui/changed'], () => {
    const ui = serviceOf<UiService>(ctx, 'ui')
    const panelSlots = ui?.slotsFor?.('now-playing.panel') ?? []
    if (panelSlots[0]) {
      return (ui?.viewFor?.(panelSlots[0].id) as React.ComponentType<{ ctx: Context }> | undefined) ?? null
    }
    return (ui?.viewFor?.('lyrics.panel') as React.ComponentType<{ ctx: Context }> | undefined) ?? null
  })

  const VisualizerComponent = useServiceState(ctx, ['ui/changed'], () => {
    const ui = serviceOf<UiService>(ctx, 'ui')
    const visualizerSlots = ui?.slotsFor?.('now-playing.visualizer') ?? []
    if (visualizerSlots[0]) {
      return (ui?.viewFor?.(visualizerSlots[0].id) as React.ComponentType<{ ctx: Context }> | undefined) ?? null
    }
    return (ui?.viewFor?.('visualizer.canvas') as React.ComponentType<{ ctx: Context }> | undefined) ?? null
  })

  const BuiltinLayout = NOW_PLAYING_LAYOUT_MAP[styleId as keyof typeof NOW_PLAYING_LAYOUT_MAP] ?? NOW_PLAYING_LAYOUT_MAP.classic

  return h(
    'div',
    {
      role: 'region',
      'aria-label': 'Now playing',
      onMouseMove: showCloseButton
        ? (e: React.MouseEvent) => {
            const isTop = e.clientY < 80
            if (isTop !== isTopHovered) setIsTopHovered(isTop)
          }
        : undefined,
      onMouseLeave: showCloseButton ? () => setIsTopHovered(false) : undefined,
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        minHeight: '100%',
        padding: 0,
        gap: 0,
        background: 'var(--bg-app, #05060B)',
        overflow: 'hidden',
        borderBottom: 'none',
      },
    },
    /* ── close button (top-left, only rendered when not in shell) ── */
    showCloseButton
      ? h(
          'button',
          {
            type: 'button',
            'aria-label': 'Close now playing',
            onClick: onClose,
            onMouseEnter: () => setIsTopHovered(true),
            style: {
              position: 'absolute',
              top: tokens.space[4],
              left: tokens.space[4],
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
              transform: isTopHovered ? 'translateY(0)' : 'translateY(-120%)',
              opacity: isTopHovered ? 1 : 0,
              visibility: isTopHovered ? 'visible' : 'hidden',
              transition: `background-color ${tokens.duration.fast}ms, transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, visibility 0.35s ease`,
              zIndex: 110,
              pointerEvents: isTopHovered ? 'auto' : 'none',
              WebkitAppRegion: 'no-drag' as unknown as undefined,
            },
          },
          tablerIcon('chevron-down', { size: 26 }),
        )
      : null,
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
