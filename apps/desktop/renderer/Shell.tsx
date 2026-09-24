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
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import type { Context } from 'cordis'
import type { RouteContribution, SettingsContribution } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { TopBar, WindowControls, type ElectronCSSProperties, type TopBarProps } from './TopBar.js'

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
  { title: string; onError: (error: Error) => void; children?: ReactNode },
  { error?: Error }
> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error)
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

export function Shell({ ctx }: { ctx: Context }) {
  const { entries } = useEntries(ctx)
  const defaultEntry = entries.find((e) => e.id !== 'now-playing.view') ?? entries[0]
  const [isFullscreenNowPlaying, setIsFullscreenNowPlaying] = useState(false)
  const [isBottomBarHovered, setIsBottomBarHovered] = useState(false)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [libraryMode, setLibraryMode] = useState<'collapsed' | 'sidebar' | 'expanded'>('sidebar')

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

  const active =
    entries.find((e) => e.id === currentId) ??
    (currentId ? { id: currentId, title: currentId, group: 'main' as const } : defaultEntry)
  const View = currentId
    ? (ctx.ui.viewFor(currentId) as
        | ComponentType<{
            ctx: Context
            onOpenAlbum?: (urn: string) => void
            [key: string]: unknown
          }>
        | undefined)
    : undefined
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
          height: '100vh',
          width: '100vw',
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

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
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
        style: {
          display: 'grid',
          gridTemplateColumns:
            libraryMode === 'expanded'
              ? isQueueOpen
                ? '1fr minmax(260px, 28%)'
                : '1fr'
              : libraryMode === 'collapsed'
                ? isQueueOpen
                  ? '72px 1fr minmax(260px, 28%)'
                  : '72px 1fr'
                : isQueueOpen
                  ? '280px 1fr minmax(260px, 28%)'
                  : '280px 1fr',
          gap: 8,
          padding: 8,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          transition: 'grid-template-columns 0.28s cubic-bezier(0.2, 0, 0, 1)',
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
                overflow: 'auto',
                minHeight: 0,
              },
            },
            View
              ? currentId === 'library.home' && LibraryView
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
                      // Remounts on navigation, which is what clears a failed view once
                      // the user goes somewhere else and comes back.
                      key: currentId + (currentParams ? `:${JSON.stringify(currentParams)}` : ''),
                      title: active?.title ?? currentId ?? 'This view',
                      onError: (error) =>
                        ctx.logger.error(
                          `ui: view "${currentId}" threw: ${error.stack ?? error.message}`,
                        ),
                    },
                    h(View, {
                      ctx,
                      ...currentParams,
                      onOpenAlbum: (urn: string) => navigateTo('album.view', { urn }),
                    }),
                  )
              : h(
                  'div',
                  { style: { padding: 24, color: 'var(--text-tertiary, #8B92A6)' } },
                  active
                    ? // A contribution with no view on this target is a normal
                      // state, not an error — the direct cost of ADR-2 (docs/08 §3).
                      `"${active.title}" has no desktop view.`
                    : 'No plugin has contributed a route.',
                ),
          ),
      isQueueOpen && QueueView
        ? h(
            'aside',
            {
              'data-testid': 'queue-sidebar-panel',
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
    ),
    BottomBar
      ? h(
          'footer',
          { style: { background: 'var(--player-bg, #000000)' } },
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
