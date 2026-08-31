/**
 * The desktop shell: sidebar plus content pane.
 *
 * It knows nothing about any feature. It reads contributed routes from
 * `ctx.ui`, resolves each to a registered view, and renders it — the whole of
 * ADR-2's desktop half (docs/08 §3).
 */

import { createElement as h, useEffect, useState, type ComponentType } from 'react'
import type { Context } from 'cordis'
import type { RouteContribution } from '@BBeBee/protocol'

/** Re-read the registry whenever a plugin contributes or unloads. */
function useRoutes(ctx: Context): readonly RouteContribution[] {
  const [routes, setRoutes] = useState<readonly RouteContribution[]>(() => ctx.ui.routes)
  useEffect(() => {
    const off = ctx.on('ui/changed', () => setRoutes([...ctx.ui.routes]))
    return () => void off()
  }, [ctx])
  return routes
}

export function Shell({ ctx }: { ctx: Context }) {
  const routes = useRoutes(ctx)
  const [activeId, setActiveId] = useState<string | undefined>()

  const sidebarRoutes = routes.filter((r) => r.placement?.includes('sidebar') ?? true)
  const active = routes.find((r) => r.id === activeId) ?? sidebarRoutes[0]
  const View = active
    ? (ctx.ui.viewFor(active.id) as ComponentType<{ ctx: Context }> | undefined)
    : undefined

  return h(
    'div',
    { style: { display: 'grid', gridTemplateColumns: '220px 1fr', height: '100vh' } },
    h(
      'nav',
      { style: { borderRight: '1px solid #1E1E28', padding: 12, background: '#0E0E14' } },
      h(
        'div',
        { style: { fontSize: 12, color: '#5A5A68', padding: '8px 10px', letterSpacing: 1 } },
        'BBeBee',
      ),
      ...sidebarRoutes.map((route) =>
        h(
          'button',
          {
            key: route.id,
            onClick: () => setActiveId(route.id),
            style: {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              marginBottom: 2,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: active?.id === route.id ? '#2A2340' : 'transparent',
              color: active?.id === route.id ? '#F5F5F7' : '#A0A0AE',
              font: 'inherit',
            },
          },
          route.title,
        ),
      ),
    ),
    h(
      'main',
      { style: { overflow: 'auto' } },
      View
        ? h(View, { ctx })
        : h(
            'div',
            { style: { padding: 24, color: '#A0A0AE' } },
            active
              ? // A contributed route with no view on this target is a normal
                // state, not an error — the direct cost of ADR-2 (docs/08 §3).
                `"${active.title}" has no desktop view.`
              : 'No plugin has contributed a route.',
          ),
    ),
  )
}
