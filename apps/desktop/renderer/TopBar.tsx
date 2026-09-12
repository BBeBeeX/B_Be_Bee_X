/**
 * Spotify-style in-app TopBar for the Desktop Electron Shell.
 *
 * Replaces the native OS window frame and menu bar:
 * - Left: More menu (⋯), History Back (←), History Forward (→)
 * - Center: Home (⌂), Search Bar
 * - Right: Avatar, Connected Window Controls (Minimize, Maximize/Restore, Close)
 *
 * Drag region is applied to the bar container (-webkit-app-region: drag),
 * while interactive controls opt out with no-drag.
 */

import { createElement as h, useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import type { Context } from 'cordis'

export interface ElectronCSSProperties extends CSSProperties {
  WebkitAppRegion?: 'drag' | 'no-drag'
}

export interface WindowControlsProps {
  style?: CSSProperties
}

export function WindowControls({ style }: WindowControlsProps = {}): ReactElement {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Read initial maximized state if available
    void window.BBeBee?.window?.isMaximized?.().then((max) => {
      if (typeof max === 'boolean') setIsMaximized(max)
    })
  }, [])

  const handleMinimize = () => {
    void window.BBeBee?.window?.minimize?.()
  }

  const handleMaximize = () => {
    void window.BBeBee?.window?.maximize?.().then(() => {
      setIsMaximized((prev) => !prev)
    })
  }

  const handleClose = () => {
    void window.BBeBee?.window?.close?.()
  }

  return h(
    'div',
    {
      role: 'group',
      'aria-label': 'Window controls',
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 48,
        WebkitAppRegion: 'no-drag',
        ...style,
      } as ElectronCSSProperties,
    },
    // Minimize Button (−)
    h(
      'button',
      {
        type: 'button',
        'aria-label': 'Minimize window',
        title: 'Minimize',
        onClick: handleMinimize,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 46,
          height: 48,
          border: 'none',
          background: 'transparent',
          color: '#A0A0AE',
          cursor: 'pointer',
          transition: 'background-color 0.1s ease, color 0.1s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
          e.currentTarget.style.color = '#F5F5F7'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = '#A0A0AE'
        },
      },
      h(
        'svg',
        { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true },
        h('line', {
          x1: '1',
          y1: '5',
          x2: '9',
          y2: '5',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
      ),
    ),
    // Maximize / Restore Button (□ / ❐)
    h(
      'button',
      {
        type: 'button',
        'aria-label': isMaximized ? 'Restore window' : 'Maximize window',
        title: isMaximized ? 'Restore' : 'Maximize',
        onClick: handleMaximize,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 46,
          height: 48,
          border: 'none',
          background: 'transparent',
          color: '#A0A0AE',
          cursor: 'pointer',
          transition: 'background-color 0.1s ease, color 0.1s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
          e.currentTarget.style.color = '#F5F5F7'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = '#A0A0AE'
        },
      },
      isMaximized
        ? h(
            'svg',
            { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', 'aria-hidden': true },
            h('rect', {
              x: '2.5',
              y: '2.5',
              width: '6',
              height: '6',
              stroke: 'currentColor',
              strokeWidth: 1.1,
            }),
            h('path', {
              d: 'M1.5 3.5V8.5H6.5',
              stroke: 'currentColor',
              strokeWidth: 1.1,
            }),
          )
        : h(
            'svg',
            { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', 'aria-hidden': true },
            h('rect', {
              x: '1.5',
              y: '1.5',
              width: '7',
              height: '7',
              stroke: 'currentColor',
              strokeWidth: 1.2,
            }),
          ),
    ),
    // Close Button (✕)
    h(
      'button',
      {
        type: 'button',
        'aria-label': 'Close window',
        title: 'Close',
        onClick: handleClose,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 46,
          height: 48,
          border: 'none',
          background: 'transparent',
          color: '#A0A0AE',
          cursor: 'pointer',
          transition: 'background-color 0.1s ease, color 0.1s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = '#E81123'
          e.currentTarget.style.color = '#FFFFFF'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = '#A0A0AE'
        },
      },
      h(
        'svg',
        { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true },
        h('line', {
          x1: '1.5',
          y1: '1.5',
          x2: '8.5',
          y2: '8.5',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('line', {
          x1: '8.5',
          y1: '1.5',
          x2: '1.5',
          y2: '8.5',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
      ),
    ),
  )
}

export interface TopBarProps {
  ctx: Context
  onHome?: () => void
  onSearch?: (query: string) => void
  onOpenSettings?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
}

export function TopBar({
  ctx: _ctx,
  onHome,
  onSearch,
  onOpenSettings,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
}: TopBarProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else if (typeof window !== 'undefined' && window.history) {
      window.history.back()
    }
  }

  const handleForward = () => {
    if (onForward) {
      onForward()
    } else if (typeof window !== 'undefined' && window.history) {
      window.history.forward()
    }
  }

  const noDragStyle: ElectronCSSProperties = {
    WebkitAppRegion: 'no-drag',
  }

  return h(
    'header',
    {
      role: 'banner',
      'aria-label': 'Application Header',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 48,
        minHeight: 48,
        maxHeight: 48,
        paddingLeft: 12,
        paddingRight: 0,
        background: '#000000',
        borderBottom: 'none',
        userSelect: 'none',
        WebkitAppRegion: 'drag',
        position: 'relative',
        zIndex: 50,
      } as ElectronCSSProperties,
    },
    // Left Group: More (⋯), Back (←), Forward (→)
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          ...noDragStyle,
        },
      },
      // More Menu (⋯)
      h(
        'div',
        { style: { position: 'relative' } },
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'More options',
            title: 'More',
            onClick: () => setMenuOpen((prev) => !prev),
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: menuOpen ? 'rgba(255, 255, 255, 0.14)' : 'transparent',
              color: '#F5F5F7',
              cursor: 'pointer',
              fontSize: 16,
              transition: 'background-color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              if (!menuOpen) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              if (!menuOpen) e.currentTarget.style.backgroundColor = 'transparent'
            },
          },
          h(
            'svg',
            {
              width: 16,
              height: 16,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2.2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': true,
            },
            h('circle', { cx: '5', cy: '12', r: '1.5', fill: 'currentColor' }),
            h('circle', { cx: '12', cy: '12', r: '1.5', fill: 'currentColor' }),
            h('circle', { cx: '19', cy: '12', r: '1.5', fill: 'currentColor' }),
          ),
        ),
        // Dropdown popup
        menuOpen
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  top: 38,
                  left: 0,
                  minWidth: 160,
                  background: '#1A1A24',
                  border: '1px solid #2D2D3A',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                  padding: 4,
                  zIndex: 100,
                },
              },
              h(
                'button',
                {
                  type: 'button',
                  style: {
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    color: '#F5F5F7',
                    fontSize: 13,
                    cursor: 'pointer',
                  },
                  onClick: () => {
                    setMenuOpen(false)
                    onHome?.()
                  },
                  onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.backgroundColor = '#2A2340'
                  },
                  onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  },
                },
                'Home',
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: {
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: 4,
                    border: 'none',
                    background: 'transparent',
                    color: '#F5F5F7',
                    fontSize: 13,
                    cursor: 'pointer',
                  },
                  onClick: () => {
                    setMenuOpen(false)
                    onOpenSettings?.()
                  },
                  onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.backgroundColor = '#2A2340'
                  },
                  onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  },
                },
                'Settings',
              ),
            )
          : null,
      ),
      // Back Button (←)
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'Go back',
          title: 'Back',
          disabled: !canGoBack,
          onClick: handleBack,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: canGoBack ? '#A0A0AE' : '#454550',
            cursor: canGoBack ? 'pointer' : 'default',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            if (canGoBack) {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
              e.currentTarget.style.color = '#F5F5F7'
            }
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            if (canGoBack) {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#A0A0AE'
            }
          },
        },
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2.2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          },
          h('polyline', { points: '15 18 9 12 15 6' }),
        ),
      ),
      // Forward Button (→)
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'Go forward',
          title: 'Forward',
          disabled: !canGoForward,
          onClick: handleForward,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: canGoForward ? '#A0A0AE' : '#454550',
            cursor: canGoForward ? 'pointer' : 'default',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            if (canGoForward) {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
              e.currentTarget.style.color = '#F5F5F7'
            }
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            if (canGoForward) {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#A0A0AE'
            }
          },
        },
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2.2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          },
          h('polyline', { points: '9 18 15 12 9 6' }),
        ),
      ),
    ),
    // Center Group: Home Button, Search Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flex: 1,
          justifyContent: 'center',
          maxWidth: 520,
          ...noDragStyle,
        },
      },
      // Home Button
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'Home',
          title: 'Home',
          onClick: onHome,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.08)',
            color: '#F5F5F7',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background-color 0.15s ease, transform 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.14)'
            e.currentTarget.style.transform = 'scale(1.04)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
            e.currentTarget.style.transform = 'scale(1)'
          },
        },
        h(
          'svg',
          {
            width: 18,
            height: 18,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2.2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          },
          h('path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }),
          h('polyline', { points: '9 22 9 12 15 12 15 22' }),
        ),
      ),
      // Search Bar Container
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            height: 36,
            borderRadius: 9999,
            background: searchFocused ? '#282834' : '#1F1F28',
            border: searchFocused ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid transparent',
            paddingLeft: 12,
            paddingRight: 10,
            gap: 8,
            transition: 'background-color 0.15s ease, border-color 0.15s ease',
          },
        },
        // Search icon
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: '#A0A0AE',
            strokeWidth: 2.2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            style: { flexShrink: 0 },
          },
          h('circle', { cx: '11', cy: '11', r: '8' }),
          h('line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' }),
        ),
        // Search input
        h('input', {
          type: 'text',
          'aria-label': 'Search',
          placeholder: 'What do you want to play?',
          value: searchQuery,
          onChange: (e: { target: { value: string } }) => {
            setSearchQuery(e.target.value)
            onSearch?.(e.target.value)
          },
          onFocus: () => setSearchFocused(true),
          onBlur: () => setSearchFocused(false),
          style: {
            flex: 1,
            minWidth: 0,
            height: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#F5F5F7',
            fontSize: 13,
          },
        }),
        // Clear query button
        searchQuery
          ? h(
              'button',
              {
                type: 'button',
                'aria-label': 'Clear search',
                onClick: () => {
                  setSearchQuery('')
                  onSearch?.('')
                },
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: '#A0A0AE',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                },
              },
              '×',
            )
          : null,
      ),
    ),
    // Right Group: Avatar, Window Controls (Minimize, Maximize/Restore, Close)
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          ...noDragStyle,
        },
      },
      // Avatar
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'User profile',
          title: 'Profile',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: '#2A2340',
            color: '#F5F5F7',
            cursor: 'pointer',
            padding: 0,
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.transform = 'scale(1.06)'
            e.currentTarget.style.boxShadow = '0 0 8px rgba(255, 255, 255, 0.2)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = 'none'
          },
        },
        h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          },
          h('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
          h('circle', { cx: '12', cy: '7', r: '4' }),
        ),
      ),
      // Contiguous Window Controls Group
      h(WindowControls, null),
    ),
  )
}
