/**
 * Desktop view for the plugin inspector.
 *
 * Renders the fiber tree with labelled effects — M0's last exit criterion.
 * Structure only; the data comes entirely from `ctx.inspector`.
 */

import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
// Pulls the service augmentations (`ctx.db`, `ctx.ui`, …) into this program.
// Without it a consumer compiling this package in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import type { EffectNode, FiberNode, InspectorSnapshot } from '@BBeBee/plugin-inspector'

export const INSPECTOR_VIEW = 'inspector.panel'

const STATE_COLOR: Record<string, string> = {
  ACTIVE: '#3ECF8E',
  PENDING: '#FFB020',
  LOADING: '#FFB020',
  FAILED: '#FF5C5C',
  UNLOADING: '#A0A0AE',
  DISPOSED: '#5A5A68',
  UNKNOWN: '#5A5A68',
}

function Effects({ nodes, depth }: { nodes: EffectNode[]; depth: number }): ReactElement {
  return h(
    'ul',
    { style: { listStyle: 'none', margin: 0, paddingLeft: 16 } },
    ...nodes.map((node, i) =>
      h(
        'li',
        { key: `${node.label}-${i}`, style: { color: '#A0A0AE', fontSize: 12 } },
        `· ${node.label}`,
        node.children.length ? h(Effects, { nodes: node.children, depth: depth + 1 }) : null,
      ),
    ),
  )
}

function Fiber({ node }: { node: FiberNode }): ReactElement {
  return h(
    'li',
    { style: { margin: '2px 0' } },
    h(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
      h('span', { style: { fontWeight: 600 } }, node.name),
      h(
        'span',
        { style: { color: STATE_COLOR[node.state] ?? '#5A5A68', fontSize: 11 } },
        node.state,
      ),
      node.provides.length
        ? h('span', { style: { color: '#7C5CFF', fontSize: 11 } }, `provides ${node.provides.join(', ')}`)
        : null,
      node.waitingFor.length
        ? h('span', { style: { color: '#FFB020', fontSize: 11 } }, `waiting ${node.waitingFor.join(', ')}`)
        : null,
    ),
    node.effects.length ? h(Effects, { nodes: node.effects, depth: 0 }) : null,
    node.children.length
      ? h(
          'ul',
          { style: { listStyle: 'none', margin: 0, paddingLeft: 16, borderLeft: '1px solid #2A2A34' } },
          ...node.children.map((child, i) => h(Fiber, { key: `${child.name}-${i}`, node: child })),
        )
      : null,
  )
}

export function InspectorPanel({ ctx }: { ctx: Context }) {
  const [snap, setSnap] = useState<InspectorSnapshot>(() => ctx.inspector.snapshot())
  // The fiber tree has no change event — plugins load and unload without
  // telling anyone — so the inspector polls. Cheap, and it is a dev tool.
  useEffect(() => {
    const timer = setInterval(() => setSnap(ctx.inspector.snapshot()), 1000)
    return () => clearInterval(timer)
  }, [ctx])

  const summary = Object.entries(snap.counts)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state.toLowerCase()}`)
    .join(' · ')

  return h(
    'section',
    { style: { padding: 24, fontFamily: 'ui-monospace, monospace', fontSize: 13 } },
    h('h1', { style: { fontSize: 20, margin: '0 0 4px' } }, 'Plugin graph'),
    h('p', { style: { margin: '0 0 16px', color: '#A0A0AE' } }, summary),
    h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, h(Fiber, { node: snap.root })),
  )
}

export const name = 'plugin-inspector-ui-desktop'
export const inject = ['ui', 'inspector']

/**
 * ⚠️ `async` is load-bearing, not decoration.
 *
 * Cordis decides "is this a class?" with `!!func.prototype`. A plain
 * `function apply(…)` has one, so it is `new`-ed as if it were a service and
 * the disposer it returns is discarded — the plugin loads, works, and never
 * unloads. An async function has no prototype. `conventions.test.ts` fails the
 * build on the other shape (docs/03 §2).
 */
export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(INSPECTOR_VIEW, ({ ctx: viewCtx }: { ctx: Context }) =>
      h(InspectorPanel, { ctx: viewCtx }),
    )
    yield ctx.ui.contribute({
      kind: 'route',
      id: INSPECTOR_VIEW,
      path: '/inspector',
      title: 'Inspector',
      icon: 'bug',
      placement: ['sidebar'],
      order: 900,
    })
  }, 'inspector-ui')
}

export default { name, inject, apply }
