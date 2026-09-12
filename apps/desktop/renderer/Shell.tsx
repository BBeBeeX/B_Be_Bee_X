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
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import type { Context } from 'cordis'
import type { RouteContribution, SettingsContribution } from '@BBeBee/protocol'
import { TopBar, WindowControls, type ElectronCSSProperties } from './TopBar.js'

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
      .filter((r) => r.placement?.includes('sidebar') ?? true)
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
      .filter((s) => ctx.ui.viewFor(s.id) !== undefined)
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
      { style: { padding: 24, color: '#FF5C5C', fontFamily: 'ui-monospace, monospace' } },
      h('h2', { style: { fontSize: 16, margin: '0 0 8px' } }, `"${this.props.title}" failed to render`),
      h(
        'pre',
        { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: '#FFB020' } },
        error.stack ?? error.message,
      ),
    )
  }
}

export function Shell({ ctx }: { ctx: Context }) {
  const { entries } = useEntries(ctx)
  const [activeId, setActiveId] = useState<string | undefined>()
  const [isFullscreenNowPlaying, setIsFullscreenNowPlaying] = useState(false)
  const [isBottomBarHovered, setIsBottomBarHovered] = useState(false)

  useEffect(() => {
    const off = ctx.on('ui/navigate', (routeId: string) => {
      if (routeId === 'player.now-playing') {
        setIsFullscreenNowPlaying(true)
      } else {
        setIsFullscreenNowPlaying(false)
        setActiveId(routeId)
      }
    })
    return () => void off()
  }, [ctx])

  const defaultEntry = entries.find((e) => e.id !== 'player.now-playing') ?? entries[0]
  const active = entries.find((e) => e.id === activeId) ?? defaultEntry
  const View = active
    ? (ctx.ui.viewFor(active.id) as ComponentType<{ ctx: Context }> | undefined)
    : undefined
  const BottomBar = ctx.ui.viewFor('player.now-playing-bar') as
    | ComponentType<{ ctx: Context; onOpenNowPlaying?: () => void }>
    | undefined

  if (isFullscreenNowPlaying) {
    const NowPlayingView = ctx.ui.viewFor('player.now-playing') as
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
          background: '#000000',
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
            paddingLeft: 12,
            paddingRight: 0,
            background: 'transparent',
            WebkitAppRegion: 'drag',
            position: 'absolute',
            top: 0,
            left: 0,
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
              { style: { padding: 24, color: '#A0A0AE' } },
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
              h(BottomBar, { ctx }),
            ),
          )
        : null,
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
      },
    },
    h(TopBar, {
      ctx,
      onHome: () => {
        setIsFullscreenNowPlaying(false)
        setActiveId(defaultEntry?.id)
      },
      onOpenSettings: () => {
        const settingsEntry = entries.find((e) => e.group === 'settings')
        if (settingsEntry) {
          setIsFullscreenNowPlaying(false)
          setActiveId(settingsEntry.id)
        }
      },
    }),
    h(
      'div',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: '220px 1fr',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        },
      },
      h(
        'nav',
        {
          style: {
            borderRight: '1px solid #1E1E28',
            padding: 12,
            background: '#000000',
            minHeight: 0,
            overflowY: 'auto',
          },
        },
        h(
          'div',
          { style: { fontSize: 12, color: '#5A5A68', padding: '8px 10px', letterSpacing: 1 } },
          'BBeBee',
        ),
        ...entries.map((entry, index) =>
          h(
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
                      color: '#5A5A68',
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
                  if (entry.id === 'player.now-playing') {
                    setIsFullscreenNowPlaying(true)
                  } else {
                    setActiveId(entry.id)
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
                  background: active?.id === entry.id ? '#2A2340' : 'transparent',
                  color: active?.id === entry.id ? '#F5F5F7' : '#A0A0AE',
                  font: 'inherit',
                },
              },
              entry.title,
            ),
          ),
        ),
      ),
      h(
        'main',
        { style: { overflow: 'auto', minHeight: 0 } },
        View
          ? h(
              ViewBoundary,
              {
                // Remounts on navigation, which is what clears a failed view once
                // the user goes somewhere else and comes back.
                key: active?.id,
                title: active?.title ?? 'This view',
                onError: (error) =>
                  ctx.logger.error(`ui: view "${active?.id}" threw: ${error.stack ?? error.message}`),
              },
              h(View, { ctx }),
            )
          : h(
              'div',
              { style: { padding: 24, color: '#A0A0AE' } },
              active
                ? // A contribution with no view on this target is a normal
                  // state, not an error — the direct cost of ADR-2 (docs/08 §3).
                  `"${active.title}" has no desktop view.`
                : 'No plugin has contributed a route.',
            ),
      ),
    ),
    BottomBar
      ? h(
          'footer',
          null,
          h(BottomBar, {
            ctx,
            onOpenNowPlaying: () => setIsFullscreenNowPlaying(true),
          }),
        )
      : null,
  )
}
