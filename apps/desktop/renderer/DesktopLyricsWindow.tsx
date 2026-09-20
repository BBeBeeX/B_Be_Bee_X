import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { DesktopLyricsPayload, DesktopLyricsAction } from './desktop-lyrics-types.js'

const DEFAULT_PAYLOAD: DesktopLyricsPayload = {
  currentLine: 'BBeBee 音乐',
  nextLine: '聆听高品质音乐',
  fontSize: 24,
  opacity: 0.95,
  locked: false,
  playing: false,
  align: 'center',
  fontFamily: 'system-ui',
  textColor: '#FFFFFF',
  lineMode: 'double',
}

export function DesktopLyricsWindow(): ReactElement {
  const [data, setData] = useState<DesktopLyricsPayload>(DEFAULT_PAYLOAD)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'

    const bridge = window.BBeBee?.desktopLyrics
    if (!bridge) return

    const off = bridge.onData((incoming: unknown) => {
      setData((prev) => ({ ...prev, ...(incoming as Partial<DesktopLyricsPayload>) }))
    })

    return () => {
      off()
    }
  }, [])

  const sendAction = (action: DesktopLyricsAction) => {
    void window.BBeBee?.desktopLyrics?.sendAction?.(action)
  }

  const {
    currentLine,
    nextLine,
    fontSize,
    opacity,
    locked,
    playing,
    align = 'center',
    fontFamily = 'system-ui',
    textColor = '#FFFFFF',
    lineMode = 'double',
  } = data

  return h(
    'div',
    {
      style: {
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: '8px 16px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: locked ? 'default' : 'move',
        WebkitAppRegion: 'drag',
        background: hovered && !locked ? 'rgba(15, 15, 22, 0.6)' : 'transparent',
        borderRadius: 12,
        border: hovered && !locked ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid transparent',
        boxShadow: hovered && !locked ? '0 8px 32px rgba(0, 0, 0, 0.5)' : 'none',
        backdropFilter: hovered && !locked ? 'blur(12px)' : 'none',
        transition: 'all 0.2s ease',
        overflow: 'hidden',
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
    // Toolbar (shown on hover when unlocked)
    (hovered || !locked) &&
      h(
        'div',
        {
          style: {
            position: 'absolute',
            top: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s ease',
            background: 'rgba(24, 24, 32, 0.85)',
            padding: '3px 8px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 100,
            WebkitAppRegion: 'no-drag',
          },
        },
        // Prev button
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: '上一首',
            onClick: () => sendAction({ type: 'prev-track' }),
          },
          '⏮',
        ),
        // Play/Pause button
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: playing ? '暂停' : '播放',
            onClick: () => sendAction({ type: 'toggle-play' }),
          },
          playing ? '⏸' : '▶',
        ),
        // Next button
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: '下一首',
            onClick: () => sendAction({ type: 'next-track' }),
          },
          '⏭',
        ),
        // Separator
        h('div', { style: separatorStyle }),
        // Smaller font
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: '缩小字体',
            onClick: () => sendAction({ type: 'set-font-size', size: Math.max(16, fontSize - 2) }),
          },
          'A-',
        ),
        // Larger font
        h(
          'button',
          {
            style: toolbarButtonStyle,
            title: '放大字体',
            onClick: () => sendAction({ type: 'set-font-size', size: Math.min(36, fontSize + 2) }),
          },
          'A+',
        ),
        // Separator
        h('div', { style: separatorStyle }),
        // Lock button
        h(
          'button',
          {
            style: { ...toolbarButtonStyle, color: locked ? '#A78BFA' : '#E0E0E0' },
            title: locked ? '解除锁定' : '锁定歌词 (鼠标穿透)',
            onClick: () => sendAction({ type: 'toggle-lock' }),
          },
          locked ? '🔒' : '🔓',
        ),
        // Close button
        h(
          'button',
          {
            style: { ...toolbarButtonStyle, color: '#EF4444' },
            title: '关闭桌面歌词',
            onClick: () => sendAction({ type: 'close' }),
          },
          '✕',
        ),
      ),
    // Current Line
    h(
      'div',
      {
        style: {
          fontSize,
          fontFamily,
          fontWeight: 700,
          textAlign: align,
          lineHeight: 1.3,
          letterSpacing: '0.04em',
          opacity,
          color: textColor,
          textShadow: '0 2px 4px rgba(0, 0, 0, 0.95), 0 0 12px rgba(124, 58, 237, 0.45)',
          maxWidth: '92%',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          transition: 'all 0.25s ease',
        },
      },
      currentLine || '...',
    ),
    // Next Line (if available and double line mode)
    lineMode !== 'single' &&
      nextLine &&
      h(
        'div',
        {
          style: {
            fontSize: Math.round(fontSize * 0.68),
            fontFamily,
            fontWeight: 500,
            textAlign: align,
            lineHeight: 1.2,
            marginTop: 4,
            opacity: opacity * 0.75,
            color: textColor,
            filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.9))',
            maxWidth: '85%',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            transition: 'all 0.25s ease',
          },
        },
        nextLine,
      ),
  )
}

const toolbarButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#FFFFFF',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 6px',
  borderRadius: 4,
  outline: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s ease',
}

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 12,
  background: 'rgba(255, 255, 255, 0.2)',
  margin: '0 2px',
}
