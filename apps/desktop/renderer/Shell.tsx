/**
 * The desktop shell: sidebar plus content pane.
 *
 * It knows nothing about any feature. It reads contributed routes from
 * `ctx.ui`, resolves each to a registered view, and renders it — the whole of
 * ADR-2's desktop half (docs/08 §3).
 */

import {
  Component,
  createElement as h,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { Context } from 'cordis'
import type { RouteContribution, SettingsContribution } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { SleepTimerIndicator, TopBar, WindowControls, type ElectronCSSProperties, type TopBarProps } from './TopBar.js'

/** What the sidebar can navigate to: a route, or a settings page. */
interface Entry {
  id: string
  title: string
  group: 'main' | 'settings'
}

/**
 * Re-read the registry whenever a plugin contributes or unloads.
 *
 * ⚠️ **Settings pages are navigable, not just routes.** `ctx.ui.settings` was
 * contributed by `plugin-local-scanner` and `plugin-sources` from the start
 * and read by nobody, so "Music folders" — the screen with *Add folder* and
 * *Scan now* on it — existed, had a view registered, and could not be reached
 * from either shell. A contribution nothing renders is a feature nobody has.
 */
function useEntries(ctx: Context): { routes: readonly RouteContribution[]; entries: Entry[] } {
  const read = () => ({
    routes: [...ctx.ui.routes] as readonly RouteContribution[],
    settings: [...ctx.ui.settings] as readonly SettingsContribution[],
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    // `read` is redefined per render but only ever closes over `ctx`, so
    // re-subscribing on `ctx` alone is correct and keeps one listener.
    const off = ctx.on('ui/changed', () =>
      setState({ routes: [...ctx.ui.routes], settings: [...ctx.ui.settings] }),
    )
    return () => void off()
  }, [ctx])

  const entries: Entry[] = [
    ...state.routes
      .filter((r) => {
        if (!(r.placement?.includes('sidebar') ?? true)) return false
        if (
          r.id === 'sources.search' ||
          r.id === 'search' ||
          r.id === 'settings.view' ||
          r.id === 'settings.main' ||
          r.id === 'settings' ||
          r.title === 'Search' ||
          r.title === '设置'
        ) {
          return false
        }
        return true
      })
      .map((r) => ({ id: r.id, title: r.title, group: 'main' as const })),
    /*
     * Settings pages that actually have a view.
     *
     * ⚠️ A different rule from routes, deliberately. A *route* with no view on
     * this target renders "not available on this platform", which is true and
     * worth saying — `plugin-inspector` is in exactly that state on mobile. A
     * settings page with no view on *either* target is not a platform gap, it
     * is a page nobody has written yet (`sources.settings` is one today), and
     * listing it advertises a screen that does not exist.
     */
    ...state.settings
      .filter((s) => {
        if (ctx.ui.viewFor(s.id) === undefined) return false
        // Exclude settings pages managed inside the Settings dashboard (dsp, sources, scanner, downloads)
        if (
          s.id === 'dsp.settings' ||
          s.id === 'settings.dsp' ||
          s.id === 'sources.settings' ||
          s.id === 'scanner.settings' ||
          s.id === 'downloads.page' ||
          s.id === 'settings.view' ||
          s.id === 'settings.main' ||
          s.id === 'settings' ||
          s.title === '设置'
        ) {
          return false
        }
        return true
      })
      .map((s) => ({ id: s.id, title: s.title, group: 'settings' as const })),
  ]
  return { routes: state.routes, entries }
}

class ViewBoundary extends Component<
  { title: string; onError: (error: Error) => void; resetKey?: string; children?: ReactNode },
  { error?: Error }
> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error)
  }

  override componentDidUpdate(prevProps: { title: string; resetKey?: string }): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined })
    }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return h(
      'div',
      { style: { padding: 24, color: 'var(--error, #EF4444)', fontFamily: 'ui-monospace, monospace' } },
      h('h2', { style: { fontSize: 16, margin: '0 0 8px' } }, `"${this.props.title}" failed to render`),
      h(
        'pre',
        { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--warning, #F59E0B)' } },
        error.stack ?? error.message,
      ),
    )
  }
}

interface HistoryItem {
  id: string
  params?: Record<string, unknown>
}

interface CachedPageItem {
  key: string
  id: string
  params?: Record<string, unknown>
}

function getPageKey(id: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return id
  }
  const sortedKeys = Object.keys(params).sort()
  const sortedParams: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    sortedParams[k] = params[k]
  }
  return `${id}:${JSON.stringify(sortedParams)}`
}

function Splitter({
  position,
  isDragging,
  onMouseDown,
  onDoubleClick,
  'data-testid': testId,
}: {
  position: { left?: number | string; right?: number | string }
  isDragging: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  'data-testid'?: string
}): ReactElement {
  const [hovered, setHovered] = useState(false)
  return h(
    'div',
    {
      'data-testid': testId,
      role: 'separator',
      'aria-orientation': 'vertical',
      tabIndex: 0,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onMouseDown,
      onDoubleClick,
      style: {
        position: 'absolute',
        top: 8,
        bottom: 8,
        ...position,
        width: 8,
        cursor: 'col-resize',
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      },
    },
    h('div', {
      style: {
        width: 2,
        height: '100%',
        borderRadius: 1,
        backgroundColor:
          isDragging || hovered
            ? 'var(--color-primary, #5F87FF)'
            : 'transparent',
        transition: isDragging ? 'none' : 'background-color 0.15s ease',
      },
    }),
  )
}

export function Shell({ ctx }: { ctx: Context }) {
  const { entries } = useEntries(ctx)
  const defaultEntry = entries.find((e) => e.id !== 'now-playing.view') ?? entries[0]
  const [isFullscreenNowPlaying, setIsFullscreenNowPlaying] = useState(false)
  const [isBottomBarHovered, setIsBottomBarHovered] = useState(false)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [libraryMode, setLibraryMode] = useState<'collapsed' | 'sidebar' | 'expanded'>('sidebar')
  const [sidebarWidth, setSidebarWidth] = useState<number>(280)
  const [queueWidth, setQueueWidth] = useState<number | null>(null)
  const [measuredAsideWidth, setMeasuredAsideWidth] = useState<number>(300)
  const [isDragging, setIsDragging] = useState<'sidebar' | 'queue' | null>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging('sidebar')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const newWidth = Math.round(moveEvent.clientX - (rect.left + 8))
      if (newWidth < 120) {
        setLibraryMode('collapsed')
      } else {
        setLibraryMode('sidebar')
        setSidebarWidth(Math.min(480, Math.max(180, newWidth)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  const handleQueueMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging('queue')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const newWidth = Math.round((rect.right - 8) - moveEvent.clientX)
      setQueueWidth(Math.min(560, Math.max(240, newWidth)))
    }

    const handleMouseUp = () => {
      setIsDragging(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const [navState, setNavState] = useState<{ history: HistoryItem[]; index: number }>({
    history: [],
    index: 0,
  })

  const navigateTo = useCallback(
    (id: string, params?: Record<string, unknown>) => {
      setIsFullscreenNowPlaying(false)
      if (id !== 'library.home') {
        setLibraryMode((m) => (m === 'expanded' ? 'sidebar' : m))
      }
      setNavState((prev) => {
        const base =
          prev.history.length === 0 && defaultEntry ? [{ id: defaultEntry.id }] : prev.history
        const current = base[prev.index]
        if (
          current &&
          current.id === id &&
          JSON.stringify(current.params) === JSON.stringify(params)
        ) {
          return prev
        }
        const nextHistory = base.slice(0, prev.index + 1)
        nextHistory.push({ id, params })
        return {
          history: nextHistory,
          index: nextHistory.length - 1,
        }
      })
    },
    [defaultEntry],
  )

  const canGoBack = navState.index > 0
  const canGoForward = navState.index < navState.history.length - 1

  const handleBack = useCallback(() => {
    setIsFullscreenNowPlaying(false)
    setNavState((prev) => {
      if (prev.index > 0) {
        return { ...prev, index: prev.index - 1 }
      }
      return prev
    })
  }, [])

  const handleForward = useCallback(() => {
    setIsFullscreenNowPlaying(false)
    setNavState((prev) => {
      if (prev.index < prev.history.length - 1) {
        return { ...prev, index: prev.index + 1 }
      }
      return prev
    })
  }, [])

  const handleHome = useCallback(() => {
    if (defaultEntry) {
      navigateTo(defaultEntry.id)
    }
  }, [defaultEntry, navigateTo])

  useEffect(() => {
    const off = ctx.on('ui/navigate', (routeId: string, params?: Record<string, unknown>) => {
      if (routeId === 'now-playing.view') {
        setIsFullscreenNowPlaying(true)
      } else if (routeId === 'queue.view') {
        setIsFullscreenNowPlaying(false)
        setIsQueueOpen((prev) => !prev)
      } else {
        navigateTo(routeId, params)
      }
    })
    return () => void off()
  }, [ctx, navigateTo])

  const currentItem: HistoryItem | undefined =
    navState.history[navState.index] ?? (defaultEntry ? { id: defaultEntry.id } : undefined)
  const currentId = currentItem?.id
  const currentParams = currentItem?.params
  const currentKey = currentId ? getPageKey(currentId, currentParams) : ''

  const [cachedPages, setCachedPages] = useState<Map<string, CachedPageItem>>(() => {
    const map = new Map<string, CachedPageItem>()
    if (currentKey && currentId) {
      map.set(currentKey, { key: currentKey, id: currentId, params: currentParams })
    }
    return map
  })

  const pagesToRender = useMemo(() => {
    const map = new Map(cachedPages)
    if (currentKey && currentId && !map.has(currentKey)) {
      map.set(currentKey, { key: currentKey, id: currentId, params: currentParams })
    }
    return map
  }, [cachedPages, currentKey, currentId, currentParams])

  useEffect(() => {
    if (currentKey && currentId) {
      setCachedPages((prev) => {
        if (prev.has(currentKey)) return prev
        const next = new Map(prev)
        next.set(currentKey, { key: currentKey, id: currentId, params: currentParams })
        if (next.size > 20) {
          const firstKey = next.keys().next().value
          if (firstKey && firstKey !== currentKey) {
            next.delete(firstKey)
          }
        }
        return next
      })
    }
  }, [currentKey, currentId, currentParams])

  const scrollPositionsRef = useRef<Map<string, { el: HTMLElement; top: number; left: number }[]>>(new Map())
  const pageContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const prevKeyRef = useRef<string>(currentKey)

  useEffect(() => {
    const prevKey = prevKeyRef.current
    if (prevKey && prevKey !== currentKey) {
      const prevContainer = pageContainerRefs.current.get(prevKey)
      if (prevContainer) {
        const records: { el: HTMLElement; top: number; left: number }[] = []
        if (prevContainer.scrollTop > 0 || prevContainer.scrollLeft > 0) {
          records.push({ el: prevContainer, top: prevContainer.scrollTop, left: prevContainer.scrollLeft })
        }
        const scrollables = prevContainer.querySelectorAll<HTMLElement>('*')
        for (let i = 0; i < scrollables.length; i++) {
          const el = scrollables[i]
          if (el && (el.scrollTop > 0 || el.scrollLeft > 0)) {
            records.push({ el, top: el.scrollTop, left: el.scrollLeft })
          }
        }
        scrollPositionsRef.current.set(prevKey, records)
      }
    }

    if (currentKey) {
      const records = scrollPositionsRef.current.get(currentKey)
      if (records && records.length > 0) {
        requestAnimationFrame(() => {
          for (const rec of records) {
            if (rec.el && rec.el.isConnected) {
              rec.el.scrollTop = rec.top
              rec.el.scrollLeft = rec.left
            }
          }
        })
      }
    }

    prevKeyRef.current = currentKey
  }, [currentKey])

  const active =
    entries.find((e) => e.id === currentId) ??
    (currentId ? { id: currentId, title: currentId, group: 'main' as const } : defaultEntry)
  const QueueView = ctx.ui.viewFor('queue.view') as
    | ComponentType<{
        ctx: Context
        onClose?: () => void
        [key: string]: unknown
      }>
    | undefined
  const BottomBar = ctx.ui.viewFor('now-playing.bar') as
    | ComponentType<{ ctx: Context; currentRoute?: string; onOpenNowPlaying?: () => void }>
    | undefined
  const DesktopLyrics = ctx.ui.viewFor('desktop-lyrics.floating') as
    | ComponentType<{ ctx: Context }>
    | undefined
  const LibraryView = ctx.ui.viewFor('library.home') as
    | ComponentType<{
        ctx: Context
        mode?: 'collapsed' | 'sidebar' | 'expanded'
        onModeChange?: (mode: 'collapsed' | 'sidebar' | 'expanded') => void
        onOpenAlbum?: (urn: string) => void
        [key: string]: unknown
      }>
    | undefined

  if (isFullscreenNowPlaying) {
    const NowPlayingView = ctx.ui.viewFor('now-playing.view') as
      | ComponentType<{ ctx: Context; onClose?: () => void }>
      | undefined

    return h(
      'div',
      {
        'data-testid': 'fullscreen-now-playing',
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: 'var(--bg-app, #05060B)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          border: 'none',
          outline: 'none',
          margin: 0,
          padding: 0,
        },
      },
      // Fullscreen top bar for dragging and window controls
      h(
        'div',
        {
          'data-testid': 'fullscreen-top-bar',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            height: 48,
            minHeight: 48,
            paddingRight: 0,
            background: 'transparent',
            WebkitAppRegion: 'drag',
            position: 'absolute',
            top: 0,
            left: 88,
            right: 0,
            zIndex: 150,
            userSelect: 'none',
          } as ElectronCSSProperties,
        },
        h(SleepTimerIndicator, { ctx }),
        h(WindowControls, null),
      ),
      h(
        'div',
        {
          className: 'no-scrollbar',
          style: { flex: 1, position: 'relative', overflow: 'auto', minHeight: 0 },
        },
        NowPlayingView
          ? h(
              ViewBoundary,
              {
                title: 'Now playing',
                onError: (error) =>
                  ctx.logger.error(`ui: now playing threw: ${error.stack ?? error.message}`),
              },
              h(NowPlayingView, {
                ctx,
                onClose: () => setIsFullscreenNowPlaying(false),
              }),
            )
          : h(
              'div',
              { style: { padding: 24, color: 'var(--text-tertiary, #8B92A6)' } },
              '"Now playing" has no desktop view.',
            ),
      ),
      BottomBar
        ? h(
            'div',
            {
              'data-testid': 'hover-bottom-bar-container',
              style: {
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 200,
                overflow: 'hidden',
              },
              onMouseEnter: () => setIsBottomBarHovered(true),
              onMouseLeave: () => setIsBottomBarHovered(false),
            },
            h('div', {
              style: {
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 48,
                pointerEvents: isBottomBarHovered ? 'none' : 'auto',
              },
            }),
            h(
              'footer',
              {
                style: {
                  transform: isBottomBarHovered ? 'translateY(0)' : 'translateY(100%)',
                  opacity: isBottomBarHovered ? 1 : 0,
                  transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
                  boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.6)',
                  pointerEvents: isBottomBarHovered ? 'auto' : 'none',
                  border: 'none',
                  borderTop: 'none',
                  borderBottom: 'none',
                  outline: 'none',
                },
              },
              h(BottomBar, {
                ctx,
                currentRoute: isQueueOpen ? 'queue.view' : currentId,
              }),
            ),
          )
        : null,
      DesktopLyrics ? h(DesktopLyrics, { ctx }) : null,
    )
  }

  const queueCol = queueWidth !== null ? `${queueWidth}px` : 'minmax(260px, 28%)'
  const sidebarCol =
    libraryMode === 'expanded'
      ? '1fr'
      : libraryMode === 'collapsed'
        ? '72px'
        : `${sidebarWidth}px`

  const gridColumns =
    libraryMode === 'expanded'
      ? isQueueOpen
        ? `1fr ${queueCol}`
        : '1fr'
      : isQueueOpen
        ? `${sidebarCol} 1fr ${queueCol}`
        : `${sidebarCol} 1fr`

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg-app, #05060B)',
      },
    },
    h(TopBar, {
      ctx,
      canGoBack,
      canGoForward,
      onBack: handleBack,
      onForward: handleForward,
      onHome: handleHome,
      onSearch: (
        query: string,
        opts?: Parameters<NonNullable<TopBarProps['onSearch']>>[1],
      ) => {
        navigateTo('sources.search', { query, ...opts, searchTimestamp: Date.now() })
      },
      onOpenSettings: () => {
        navigateTo('settings.view')
      },
    }),
    h(
      'div',
      {
        ref: workspaceRef,
        style: {
          display: 'grid',
          position: 'relative',
          gridTemplateColumns: gridColumns,
          gap: 8,
          padding: 8,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          transition: isDragging ? 'none' : 'grid-template-columns 0.28s cubic-bezier(0.2, 0, 0, 1)',
        },
      },
      h(
        'nav',
        {
          style: {
            borderRadius: 8,
            padding: LibraryView ? 0 : 12,
            background: 'var(--bg-primary, #080A12)',
            border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        },
        h(
          'div',
          {
            style: LibraryView
              ? {
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }
              : { fontSize: 12, color: 'var(--text-muted, #626A80)', padding: '8px 10px', letterSpacing: 1 },
          },
          'BBeBee',
        ),
        LibraryView
          ? h(
              'div',
              { style: { height: '100%', width: '100%', display: 'flex', flexDirection: 'column' } },
              h('span', { style: { display: 'none' } }, 'Library'),
              h(LibraryView, {
                ctx,
                mode: libraryMode,
                onModeChange: setLibraryMode,
                onOpenAlbum: (urn: string) => navigateTo('album.view', { urn }),
              }),
              entries
                .filter((e) => e.group === 'settings')
                .map((entry) =>
                  h(
                    'button',
                    {
                      key: entry.id,
                      onClick: () => navigateTo(entry.id),
                      style: {
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        marginBottom: 2,
                        borderRadius: 6,
                        border: 'none',
                        cursor: 'pointer',
                        background: currentId === entry.id ? 'var(--sidebar-item-active, var(--surface-selected, rgba(95, 135, 255, 0.15)))' : 'transparent',
                        color: currentId === entry.id ? 'var(--sidebar-item-text-active, var(--text-primary, #F2F5FF))' : 'var(--sidebar-item-text, var(--text-tertiary, #8B95B0))',
                        font: 'inherit',
                      },
                    },
                    entry.title,
                  ),
                ),
            )
          : entries.map((entry, index) => {
              const isActive =
                currentId === entry.id ||
                (currentId === 'album.view' && entry.id === 'library.home')
              return h(
                'div',
                { key: entry.id },
                // One heading, above the first settings page. Without the divide the
                // sidebar reads as one flat list and "Music folders" looks like a
                // library section rather than a setting.
                entry.group === 'settings' && entries[index - 1]?.group !== 'settings'
                  ? h(
                      'div',
                      {
                        style: {
                          fontSize: 11,
                          color: 'var(--text-muted, #626A80)',
                          padding: '14px 10px 4px',
                          letterSpacing: 1,
                          textTransform: 'uppercase',
                        },
                      },
                      'Settings',
                    )
                  : null,
                h(
                  'button',
                  {
                    onClick: () => {
                      if (entry.id === 'now-playing.view') {
                        setIsFullscreenNowPlaying(true)
                      } else {
                        navigateTo(entry.id)
                      }
                    },
                    style: {
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      marginBottom: 2,
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      background: isActive ? 'var(--sidebar-item-active, var(--surface-selected, rgba(95, 135, 255, 0.15)))' : 'transparent',
                      color: isActive ? 'var(--sidebar-item-text-active, var(--text-primary, #F2F5FF))' : 'var(--sidebar-item-text, var(--text-tertiary, #8B95B0))',
                      font: 'inherit',
                    },
                  },
                  entry.title,
                ),
              )
            }),
      ),
      libraryMode === 'expanded'
        ? null
        : h(
            'main',
            {
              style: {
                borderRadius: 8,
                background: 'var(--bg-primary, #080A12)',
                border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
                overflow: 'hidden',
                minHeight: 0,
                position: 'relative',
              },
            },
            pagesToRender.size === 0
              ? h(
                  'div',
                  { style: { padding: 24, color: 'var(--text-tertiary, #8B92A6)' } },
                  active
                    ? `"${active.title}" has no desktop view.`
                    : 'No plugin has contributed a route.',
                )
              : Array.from(pagesToRender.values()).map((page) => {
                  const isCurrent = page.key === currentKey
                  const pageView = page.id
                    ? (ctx.ui.viewFor(page.id) as
                        | ComponentType<{
                            ctx: Context
                            onOpenAlbum?: (urn: string) => void
                            [key: string]: unknown
                          }>
                        | undefined)
                    : undefined
                  const pageActive =
                    entries.find((e) => e.id === page.id) ??
                    (page.id ? { id: page.id, title: page.id, group: 'main' as const } : defaultEntry)

                  return h(
                    'div',
                    {
                      key: page.key,
                      'data-testid': `view-page-${page.id}`,
                      ref: (el: HTMLDivElement | null) => {
                        if (el) pageContainerRefs.current.set(page.key, el)
                        else pageContainerRefs.current.delete(page.key)
                      },
                      style: {
                        display: isCurrent ? 'flex' : 'none',
                        flexDirection: 'column',
                        height: '100%',
                        width: '100%',
                        minHeight: 0,
                        overflow: 'auto',
                      },
                    },
                    pageView
                      ? page.id === 'library.home' && LibraryView
                        ? h(
                            'div',
                            {
                              style: {
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                color: 'var(--text-tertiary, #8B92A6)',
                                gap: 12,
                              },
                            },
                            tablerIcon('music', { size: 52, style: { opacity: 0.6 } }),
                            h('div', { style: { fontSize: 15, fontWeight: 500 } }, '选择歌单或专辑开始播放'),
                          )
                        : h(
                            ViewBoundary,
                            {
                              title: pageActive?.title ?? page.id ?? 'This view',
                              resetKey: isCurrent ? 'active' : 'inactive',
                              onError: (error) =>
                                ctx.logger.error(
                                  `ui: view "${page.id}" threw: ${error.stack ?? error.message}`,
                                ),
                            },
                            h(pageView, {
                              ctx,
                              ...page.params,
                              onOpenAlbum: (urn: string) => navigateTo('album.view', { urn }),
                            }),
                          )
                      : h(
                          'div',
                          { style: { padding: 24, color: 'var(--text-tertiary, #8B92A6)' } },
                          pageActive
                            ? `"${pageActive.title}" has no desktop view.`
                            : 'No plugin has contributed a route.',
                        ),
                  )
                }),
          ),
      isQueueOpen && QueueView
        ? h(
            'aside',
            {
              'data-testid': 'queue-sidebar-panel',
              ref: (el: HTMLElement | null) => {
                if (el && queueWidth === null && el.offsetWidth > 0) {
                  setMeasuredAsideWidth(el.offsetWidth)
                }
              },
              style: {
                borderRadius: 8,
                background: 'var(--bg-primary, #080A12)',
                border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
                overflow: 'hidden',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              },
            },
            h(
              ViewBoundary,
              {
                title: 'Queue',
                onError: (error) =>
                  ctx.logger.error(`ui: queue panel threw: ${error.stack ?? error.message}`),
              },
              h(QueueView, {
                ctx,
                onClose: () => setIsQueueOpen(false),
              }),
            ),
          )
        : null,
      // Left Splitter (between nav and main)
      libraryMode !== 'expanded'
        ? h(Splitter, {
            'data-testid': 'sidebar-splitter',
            position: {
              left: 8 + (libraryMode === 'collapsed' ? 72 : sidebarWidth),
            },
            isDragging: isDragging === 'sidebar',
            onMouseDown: handleSidebarMouseDown,
            onDoubleClick: () => {
              if (libraryMode === 'collapsed') {
                setLibraryMode('sidebar')
                setSidebarWidth(280)
              } else {
                setSidebarWidth(280)
              }
            },
          })
        : null,
      // Right Splitter (between main and aside)
      isQueueOpen && QueueView
        ? h(Splitter, {
            'data-testid': 'queue-splitter',
            position: {
              right: 8 + (queueWidth ?? measuredAsideWidth),
            },
            isDragging: isDragging === 'queue',
            onMouseDown: handleQueueMouseDown,
            onDoubleClick: () => setQueueWidth(null),
          })
        : null,
    ),
    BottomBar
      ? h(
          'footer',
          {
            style: {
              background: 'var(--player-bg, var(--bg-app, #05060B))',
              border: 'none',
              borderTop: 'none',
              borderBottom: 'none',
              margin: 0,
              padding: 0,
              outline: 'none',
            },
          },
          h(BottomBar, {
            ctx,
            currentRoute: isQueueOpen ? 'queue.view' : currentId,
            onOpenNowPlaying: () => setIsFullscreenNowPlaying(true),
          }),
        )
      : null,
    DesktopLyrics ? h(DesktopLyrics, { ctx }) : null,
  )
}
