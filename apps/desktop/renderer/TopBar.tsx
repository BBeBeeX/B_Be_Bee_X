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

import { createElement as h, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useSearchSourceSelection, type SearchInterfaceKind } from '@BBeBee/plugin-sources/hooks'

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
      tablerIcon('minus', { size: 18 }),
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
        ? tablerIcon('copy', { size: 17 })
        : tablerIcon('square', { size: 17 }),
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
      tablerIcon('x', { size: 18 }),
    ),
  )
}

export interface TopBarProps {
  ctx: Context
  onHome?: () => void
  onSearch?: (
    query: string,
    opts?: {
      sourceIds?: readonly string[]
      typesBySource?: Readonly<Record<string, readonly SearchInterfaceKind[]>>
    },
  ) => void
  onOpenSettings?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
}

export function TopBar({
  ctx,
  onHome,
  onSearch,
  onOpenSettings,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
}: TopBarProps): ReactElement {
  const selection = useSearchSourceSelection(ctx)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)

  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage?.getItem('bbebee_search_history') : null
      return stored ? (JSON.parse(stored) as string[]) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (!searchActive) return
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchActive(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchActive(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [searchActive])

  const handleCommitSearch = (rawQuery: string) => {
    const trimmed = rawQuery.trim()
    if (!trimmed) return
    const nextHistory = [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, 10)
    setHistory(nextHistory)
    try {
      window.localStorage?.setItem('bbebee_search_history', JSON.stringify(nextHistory))
    } catch {
      // ignore storage errors
    }
    setSearchActive(false)
    onSearch?.(trimmed, {
      sourceIds: selection.selectedIds,
      typesBySource: selection.typesBySource,
    })
  }

  const handleClearHistory = () => {
    setHistory([])
    try {
      window.localStorage?.removeItem('bbebee_search_history')
    } catch {
      // ignore storage errors
    }
  }

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
          tablerIcon('dots', { size: 20 }),
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
        tablerIcon('chevron-left', { size: 20 }),
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
        tablerIcon('chevron-right', { size: 20 }),
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
        tablerIcon('home', { size: 22 }),
      ),
      // Search Bar Container with Dropdown
      h(
        'div',
        {
          ref: searchContainerRef,
          style: {
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            height: 36,
            borderRadius: 9999,
            background: searchActive ? '#282834' : '#1F1F28',
            border: searchActive ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid transparent',
            paddingLeft: searchActive ? 14 : 12,
            paddingRight: searchActive ? 6 : 10,
            gap: 8,
            transition: 'background-color 0.15s ease, border-color 0.15s ease',
          },
        },
        // When not active: Search icon at far left
        !searchActive
          ? tablerIcon('search', {
              size: 20,
              color: '#A0A0AE',
              style: { pointerEvents: 'none' },
            })
          : null,
        // Search input
        h('input', {
          type: 'text',
          'aria-label': 'Search',
          placeholder: 'What do you want to play?',
          value: searchQuery,
          onChange: (e: { target: { value: string } }) => {
            setSearchQuery(e.target.value)
          },
          onFocus: () => setSearchActive(true),
          onClick: () => setSearchActive(true),
          onKeyDown: (e: { key: string; currentTarget: HTMLInputElement }) => {
            if (e.key === 'Enter') {
              handleCommitSearch(e.currentTarget.value || searchQuery)
            }
          },
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
                onClick: (e: { stopPropagation: () => void }) => {
                  e.stopPropagation()
                  setSearchQuery('')
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
              tablerIcon('x', { size: 18 }),
            )
          : null,
        // When active: Search icon jumps to the far right as a clickable action button
        searchActive
          ? h(
              'button',
              {
                type: 'button',
                'aria-label': 'Submit search',
                title: 'Search',
                onClick: (e: { stopPropagation: () => void }) => {
                  e.stopPropagation()
                  const currentVal = (searchContainerRef.current?.querySelector('input') as HTMLInputElement)?.value
                  handleCommitSearch(currentVal || searchQuery)
                },
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: '#F5F5F7',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'background-color 0.15s ease, transform 0.15s ease',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.22)'
                  e.currentTarget.style.transform = 'scale(1.05)'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'
                  e.currentTarget.style.transform = 'scale(1)'
                },
              },
              tablerIcon('search', { size: 19 }),
            )
          : null,
        // 2×2 Matrix Dropdown Float
        searchActive
          ? h(
              'div',
              {
                'data-testid': 'search-matrix-panel',
                style: {
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  right: 0,
                  minWidth: 420,
                  background: '#181822',
                  borderRadius: 12,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65)',
                  backdropFilter: 'blur(16px)',
                  padding: 16,
                  zIndex: 200,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  columnGap: 20,
                  rowGap: 12,
                },
              },
              // Row 1 Left (1, 1): 搜索范围
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#A0A0AE',
                    letterSpacing: 0.5,
                  },
                },
                '搜索范围',
              ),
              // Row 1 Right (1, 2): 搜索历史 + 清空
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#A0A0AE',
                    letterSpacing: 0.5,
                  },
                },
                h('span', null, '搜索历史'),
                history.length > 0
                  ? h(
                      'button',
                      {
                        type: 'button',
                        'aria-label': '清空搜索历史',
                        onClick: (e: { stopPropagation: () => void }) => {
                          e.stopPropagation()
                          handleClearHistory()
                        },
                        style: {
                          background: 'transparent',
                          border: 'none',
                          padding: '2px 6px',
                          fontSize: 11,
                          color: 'rgba(255, 255, 255, 0.4)',
                          cursor: 'pointer',
                          borderRadius: 4,
                          transition: 'color 0.15s ease',
                        },
                        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                          e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)'
                        },
                        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                          e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'
                        },
                      },
                      '清空',
                    )
                  : null,
              ),
              // Row 2 Left (2, 1): 第三方源 toggle button
              h(
                'div',
                {
                  role: 'group',
                  'aria-label': '第三方搜索源选择',
                  style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'flex-start',
                    maxHeight: 180,
                    overflowY: 'auto',
                  },
                },
                selection.interfaces.length === 0
                  ? h(
                      'span',
                      { style: { fontSize: 12, color: 'rgba(255, 255, 255, 0.35)', padding: '4px 0' } },
                      '暂无第三方搜索源',
                    )
                  : [
                      ...selection.interfaces.map((iface) => {
                        const selected = selection.isInterfaceSelected(iface.id)
                        const disabled = !iface.searchable
                        const label = `${iface.sourceName} · ${iface.kind === 'track' ? '单曲' : '歌手'}`
                        return h(
                          'button',
                          {
                            key: iface.id,
                            type: 'button',
                            disabled,
                            'aria-pressed': selected,
                            'data-testid': `search-source-toggle-${iface.id}`,
                            onClick: (e: { stopPropagation: () => void }) => {
                              e.stopPropagation()
                              if (!disabled) selection.toggleInterface(iface.id)
                            },
                            style: {
                              minHeight: 24,
                              padding: '2px 10px',
                              borderRadius: 9999,
                              border: `1px solid ${
                                selected ? 'transparent' : 'rgba(255, 255, 255, 0.15)'
                              }`,
                              background: selected ? '#1DB954' : 'rgba(255, 255, 255, 0.05)',
                              color: selected
                                ? '#000000'
                                : disabled
                                  ? 'rgba(255, 255, 255, 0.3)'
                                  : 'rgba(255, 255, 255, 0.75)',
                              fontSize: 11,
                              fontWeight: selected ? 700 : 500,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              opacity: disabled ? 0.5 : 1,
                              transition: 'all 0.15s ease',
                            },
                            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                              if (!disabled) {
                                if (selected) {
                                  e.currentTarget.style.backgroundColor = '#1ED760'
                                } else {
                                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.35)'
                                  e.currentTarget.style.color = '#FFFFFF'
                                }
                              }
                            },
                            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                              if (!disabled) {
                                if (selected) {
                                  e.currentTarget.style.backgroundColor = '#1DB954'
                                } else {
                                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
                                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.75)'
                                }
                              }
                            },
                          },
                          label,
                        )
                      }),
                      selection.interfaces.some((iface) => iface.searchable)
                        ? h(
                            'button',
                            {
                              key: 'toggle-all',
                              type: 'button',
                              'data-testid': 'search-source-toggle-all',
                              onClick: (e: { stopPropagation: () => void }) => {
                                e.stopPropagation()
                                selection.toggleAll()
                              },
                              style: {
                                minHeight: 24,
                                padding: '2px 10px',
                                borderRadius: 9999,
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                background: 'transparent',
                                color: 'rgba(255, 255, 255, 0.6)',
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              },
                              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.35)'
                                e.currentTarget.style.color = '#FFFFFF'
                              },
                              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
                                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)'
                              },
                            },
                            selection.allSelected ? '全不选' : '全选',
                          )
                        : null,
                    ],
              ),
              // Row 2 Right (2, 2): 搜索历史 tags
              h(
                'div',
                {
                  role: 'group',
                  'aria-label': '搜索历史列表',
                  style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'flex-start',
                    maxHeight: 180,
                    overflowY: 'auto',
                  },
                },
                history.length === 0
                  ? h(
                      'span',
                      { style: { fontSize: 12, color: 'rgba(255, 255, 255, 0.35)', padding: '4px 0' } },
                      '暂无搜索历史',
                    )
                  : history.map((item) =>
                      h(
                        'button',
                        {
                          key: item,
                          type: 'button',
                          'data-testid': `search-history-item-${item}`,
                          onClick: (e: { stopPropagation: () => void }) => {
                            e.stopPropagation()
                            setSearchQuery(item)
                            handleCommitSearch(item)
                          },
                          style: {
                            minHeight: 24,
                            padding: '2px 10px',
                            borderRadius: 9999,
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            background: 'rgba(255, 255, 255, 0.06)',
                            color: 'rgba(255, 255, 255, 0.8)',
                            fontSize: 11,
                            cursor: 'pointer',
                            maxWidth: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          },
                          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)'
                            e.currentTarget.style.color = '#FFFFFF'
                          },
                          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'
                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)'
                          },
                        },
                        item,
                      ),
                    ),
              ),
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
          onClick: onOpenSettings,
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
        tablerIcon('user', { size: 20 }),
      ),
      // Contiguous Window Controls Group
      h(WindowControls, null),
    ),
  )
}
