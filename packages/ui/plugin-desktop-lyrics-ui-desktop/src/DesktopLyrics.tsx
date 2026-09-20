/**
 * DesktopLyrics — Lightweight floating lyrics overlay widget.
 *
 * Implements:
 * - Floating glassmorphism component with draggable positioning
 * - Synchronized current lyric and optional next lyric line
 * - Smooth CSS fade/slide transition between lines
 * - Hover toolbar: close, lock/unlock, font size, opacity, 1/2-line toggle, mini transport
 * - Dark mode modern aesthetics
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { useCurrentLyric } from '@BBeBee/plugin-lyrics/hooks'
import { useDesktopLyricsState } from '@BBeBee/plugin-desktop-lyrics/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { DEFAULT_APP_SETTINGS, type AppSettings, type SettingsService } from '@BBeBee/protocol'
import { tokens } from '@BBeBee/ui-tokens'

export interface DesktopLyricsProps {
  ctx: Context
}

interface DesktopLyricsActionPayload {
  type: string
  size?: number
}

interface WindowWithBridge {
  BBeBee?: {
    desktopLyrics?: {
      setVisible(visible: boolean): Promise<void>
      setLocked(locked: boolean): Promise<void>
      updateData(data: unknown): Promise<void>
      sendAction(action: unknown): Promise<void>
      onData(callback: (data: unknown) => void): () => void
      onAction(callback: (action: unknown) => void): () => void
    }
  }
}

function useDesktopLyricsSettings(ctx: Context) {
  const service = serviceOf<SettingsService>(ctx, 'settings')
  const [settings, setSettings] = useState<AppSettings>(() =>
    service ? service.getSync() : DEFAULT_APP_SETTINGS,
  )

  useEffect(() => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    if (!s) return
    void s.get().then((val) => setSettings(val))
    const off = ctx.on('settings/changed', (updated: AppSettings) => {
      setSettings(updated)
    })
    return () => off()
  }, [ctx])

  return settings.desktopLyrics
}

export function DesktopLyrics({ ctx }: DesktopLyricsProps): ReactElement | null {
  const {
    visible,
    showNextLine,
    fontSize,
    opacity,
    position,
    locked,
    setVisible,
    setFontSize,
    setOpacity,
    setShowNextLine,
    setPosition,
    setLocked,
  } = useDesktopLyricsState(ctx)

  const lyricsConfig = useDesktopLyricsSettings(ctx)
  const effectiveFontSize = lyricsConfig?.fontSize ?? fontSize
  const effectiveOpacity = lyricsConfig?.opacity ?? opacity
  const effectiveAlign = lyricsConfig?.align ?? 'center'
  const effectiveFontFamily = lyricsConfig?.fontFamily ?? 'system-ui'
  const effectiveTextColor = lyricsConfig?.textColor ?? '#FFFFFF'
  const isSingleLine = lyricsConfig?.lineMode === 'single'

  const { status, currentLine, nextLine, title, artist, isPlaying } = useCurrentLyric(ctx)
  const [hovered, setHovered] = useState(false)

  // Check if running in Electron environment with native desktopLyrics window support
  const bridge =
    typeof window !== 'undefined'
      ? (window as unknown as WindowWithBridge).BBeBee?.desktopLyrics
      : undefined
  const hasNativeBridge = Boolean(bridge)

  useEffect(() => {
    if (!hasNativeBridge || !bridge) return

    // 1. Sync visibility
    void bridge.setVisible(visible)
    // 2. Sync lock state
    void bridge.setLocked(locked)

    // 3. Sync data
    if (visible) {
      let lineText = currentLine?.text
      if (!lineText) {
        if (status === 'loading-song' || status === 'loading-lyrics') {
          lineText = '歌词加载中…'
        } else if (title) {
          lineText = `${title}${artist ? ` - ${artist}` : ''}`
        } else {
          lineText = 'BBeBee 音乐'
        }
      }

      void bridge.updateData({
        currentLine: lineText,
        nextLine: !isSingleLine && showNextLine && nextLine ? nextLine.text : undefined,
        fontSize: effectiveFontSize,
        opacity: effectiveOpacity,
        locked,
        playing: isPlaying,
        title,
        artist,
        align: effectiveAlign,
        fontFamily: effectiveFontFamily,
        textColor: effectiveTextColor,
        lineMode: lyricsConfig?.lineMode ?? (showNextLine ? 'double' : 'single'),
      })
    }
  }, [
    hasNativeBridge,
    bridge,
    visible,
    locked,
    currentLine?.text,
    nextLine?.text,
    showNextLine,
    effectiveFontSize,
    effectiveOpacity,
    effectiveAlign,
    effectiveFontFamily,
    effectiveTextColor,
    isSingleLine,
    lyricsConfig?.lineMode,
    isPlaying,
    title,
    artist,
    status,
  ])

  // Handle actions sent from the native desktop lyrics window
  useEffect(() => {
    if (!hasNativeBridge || !bridge?.onAction) return

    const off = bridge.onAction((rawAction: unknown) => {
      const action = rawAction as DesktopLyricsActionPayload
      if (action.type === 'toggle-lock') {
        setLocked(!locked)
      } else if (action.type === 'toggle-play') {
        ctx.player?.togglePlay?.()
      } else if (action.type === 'next-track') {
        void ctx.player?.next?.()
      } else if (action.type === 'prev-track') {
        void ctx.player?.previous?.()
      } else if (action.type === 'set-font-size' && typeof action.size === 'number') {
        setFontSize(action.size)
      } else if (action.type === 'close') {
        setVisible(false)
      }
    })

    return () => {
      off()
    }
  }, [hasNativeBridge, bridge, locked, setLocked, setFontSize, setVisible, ctx.player])

  if (hasNativeBridge) {
    return null
  }

  // Dragging state
  const isDragging = useRef(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 })

  const handleMouseDown = (e: React.MouseEvent) => {
    if (locked || (e.target as HTMLElement).closest('button')) return
    isDragging.current = true
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return
      const dx = moveEvent.clientX - dragStart.current.mouseX
      const dy = moveEvent.clientY - dragStart.current.mouseY
      setPosition({
        x: dragStart.current.posX + dx,
        y: dragStart.current.posY + dy,
      })
    }

    const handleMouseUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  if (!visible) return null

  // Determine displayText
  let displayText = currentLine?.text
  if (!displayText) {
    if (status === 'loading-song' || status === 'loading-lyrics') {
      displayText = 'Loading lyrics…'
    } else if (title) {
      displayText = `${title}${artist ? ` - ${artist}` : ''}`
    } else {
      displayText = 'BBeBee Music'
    }
  }

  const secondaryText = !isSingleLine && showNextLine && nextLine ? nextLine.text : undefined

  return h(
    'div',
    {
      role: 'complementary',
      'aria-label': 'Desktop lyrics overlay',
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onMouseDown: handleMouseDown,
      style: {
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
        zIndex: 9999,
        width: 'auto',
        minWidth: 420,
        maxWidth: '85vw',
        padding: `${tokens.space[3]}px ${tokens.space[5]}px`,
        borderRadius: 18,
        background: `rgba(14, 14, 20, ${effectiveOpacity})`,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 0 1px rgba(255, 255, 255, 0.2)',
        color: effectiveTextColor,
        cursor: locked ? 'default' : 'grab',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: effectiveAlign === 'left' ? 'flex-start' : effectiveAlign === 'right' ? 'flex-end' : 'center',
        justifyContent: 'center',
        transition: isDragging.current ? 'none' : 'box-shadow 0.2s ease',
      },
    },
    // Hover Controls Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: hovered ? 8 : 0,
          maxHeight: hovered ? 36 : 0,
          opacity: hovered ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.25s ease, opacity 0.2s ease, margin 0.2s ease',
        },
      },
      // Previous Track Button
      h(
        'button',
        {
          type: 'button',
          title: 'Previous track',
          'aria-label': 'Previous track',
          onClick: () => void ctx.player?.previous?.(),
          style: buttonStyle,
        },
        '⏮',
      ),
      // Play / Pause Button
      h(
        'button',
        {
          type: 'button',
          title: isPlaying ? 'Pause' : 'Play',
          'aria-label': isPlaying ? 'Pause' : 'Play',
          onClick: () => void ctx.player?.togglePlay?.(),
          style: { ...buttonStyle, color: '#A78BFA' },
        },
        isPlaying ? '⏸' : '▶',
      ),
      // Next Track Button
      h(
        'button',
        {
          type: 'button',
          title: 'Next track',
          'aria-label': 'Next track',
          onClick: () => void ctx.player?.next?.(),
          style: buttonStyle,
        },
        '⏭',
      ),
      // Separator
      h('span', { style: { color: 'rgba(255, 255, 255, 0.2)', margin: '0 4px' } }, '|'),
      // Font Size Controls
      h(
        'button',
        {
          type: 'button',
          title: 'Decrease font size',
          'aria-label': 'Decrease font size',
          onClick: () => setFontSize(fontSize - 2),
          style: buttonStyle,
        },
        'A-',
      ),
      h(
        'button',
        {
          type: 'button',
          title: 'Increase font size',
          'aria-label': 'Increase font size',
          onClick: () => setFontSize(fontSize + 2),
          style: buttonStyle,
        },
        'A+',
      ),
      // Opacity Controls
      h(
        'button',
        {
          type: 'button',
          title: 'Decrease opacity',
          'aria-label': 'Decrease opacity',
          onClick: () => setOpacity(Number((opacity - 0.1).toFixed(1))),
          style: buttonStyle,
        },
        '◐-',
      ),
      h(
        'button',
        {
          type: 'button',
          title: 'Increase opacity',
          'aria-label': 'Increase opacity',
          onClick: () => setOpacity(Number((opacity + 0.1).toFixed(1))),
          style: buttonStyle,
        },
        '◐+',
      ),
      // Toggle Next Line
      h(
        'button',
        {
          type: 'button',
          title: showNextLine ? 'Single line mode' : 'Double line mode',
          'aria-label': showNextLine ? 'Single line mode' : 'Double line mode',
          onClick: () => setShowNextLine(!showNextLine),
          style: {
            ...buttonStyle,
            color: showNextLine ? '#A78BFA' : 'rgba(255, 255, 255, 0.5)',
          },
        },
        '≡',
      ),
      // Lock Toggle
      h(
        'button',
        {
          type: 'button',
          title: locked ? 'Unlock position' : 'Lock position',
          'aria-label': locked ? 'Unlock position' : 'Lock position',
          onClick: () => setLocked(!locked),
          style: buttonStyle,
        },
        locked ? '🔒' : '🔓',
      ),
      // Close Button
      h(
        'button',
        {
          type: 'button',
          title: 'Hide desktop lyrics',
          'aria-label': 'Hide desktop lyrics',
          onClick: () => setVisible(false),
          style: { ...buttonStyle, color: '#F87171' },
        },
        '✕',
      ),
    ),

    // Current Lyric Line (Primary)
    h(
      'div',
      {
        key: displayText,
        style: {
          fontSize: effectiveFontSize,
          fontFamily: effectiveFontFamily,
          fontWeight: 700,
          color: effectiveTextColor,
          textAlign: effectiveAlign,
          lineHeight: 1.4,
          letterSpacing: 0.5,
          textShadow: '0 2px 12px rgba(0, 0, 0, 0.7), 0 0 20px rgba(167, 139, 250, 0.4)',
          animation: 'fadeInSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxWidth: '100%',
        },
      },
      displayText,
    ),

    // Next Lyric Line (Secondary, Optional)
    secondaryText
      ? h(
          'div',
          {
            key: `next-${secondaryText}`,
            style: {
              fontSize: Math.round(effectiveFontSize * 0.72),
              fontFamily: effectiveFontFamily,
              fontWeight: 400,
              color: effectiveTextColor,
              opacity: 0.65,
              marginTop: 6,
              textAlign: effectiveAlign,
              lineHeight: 1.3,
              textShadow: '0 1px 8px rgba(0, 0, 0, 0.6)',
              animation: 'fadeInSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxWidth: '100%',
            },
          },
          secondaryText,
        )
      : null,
  )
}

const buttonStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.1)',
  border: 'none',
  borderRadius: 6,
  color: '#FFFFFF',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 7px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 24,
  height: 24,
  transition: 'background-color 0.15s',
}
