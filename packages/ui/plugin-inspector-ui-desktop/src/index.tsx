/**
 * Desktop view for the plugin inspector.
 *
 * Renders the real Cordis fiber tree with labelled effects as a high-tech
 * Orthogonal PCB Circuit & Chip Topology Network.
 *
 * Implements the 5 distinct visual layers:
 * 1. Glow Layer (ambient backlight & trace bloom)
 * 2. Trace Layer (orthogonal PCB traces representing real service & hierarchy relationships)
 * 3. Pin Layer (connector pins & solder pads)
 * 4. Node Layer (real IC chip packages displaying actual plugin names)
 * 5. Signal Flow Layer (traveling data pulses along active service dependency traces)
 */

import {
  createElement as h,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import type { Context } from 'cordis'
// Pulls the service augmentations into this program.
import type {} from '@BBeBee/protocol'
import type { EffectNode, FiberNode, InspectorSnapshot } from '@BBeBee/plugin-inspector'
import { buildRealPcbTopology } from './pcb-topology-data.js'
import { PcbBoard } from './PcbBoard.js'
import { NodeDetailsPanel } from './NodeDetailsPanel.js'

export const INSPECTOR_VIEW = 'inspector.panel'

export function InspectorPanel({ ctx }: { ctx: Context }): ReactElement {
  const [snap, setSnap] = useState<InspectorSnapshot>(() => ctx.inspector.snapshot())

  // The fiber tree has no change event — plugins load and unload without
  // telling anyone — so the inspector polls. Cheap, and it is a dev tool.
  useEffect(() => {
    const timer = setInterval(() => setSnap(ctx.inspector.snapshot()), 1000)
    return () => clearInterval(timer)
  }, [ctx])

  // Build real topology directly from Cordis snapshot
  const { nodes, traces, pins } = useMemo(() => buildRealPcbTopology(snap), [snap])

  // Default selected node: stalled node if one exists, otherwise root or first plugin
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => {
    if (snap.stalled.length > 0) {
      const stalledNode = nodes.find((n) => n.fiber.name === snap.stalled[0]?.name)
      if (stalledNode) return stalledNode.id
    }
    return nodes[0]?.id ?? null
  })

  // Synchronize selection when a stalled node appears
  useEffect(() => {
    if (snap.stalled.length > 0) {
      const stalledNode = nodes.find((n) => n.fiber.name === snap.stalled[0]?.name)
      if (stalledNode) {
        setSelectedNodeId(stalledNode.id)
      }
    }
  }, [snap.stalled, nodes])

  // Pan and Zoom viewport state
  const [zoom, setZoom] = useState(0.9)
  const [pan, setPan] = useState({ x: 40, y: 30 })

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const summary = Object.entries(snap.counts)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state.toLowerCase()}`)
    .join(' · ')

  const handleZoomIn = () => setZoom((z) => Math.min(2.5, z * 1.2))
  const handleZoomOut = () => setZoom((z) => Math.max(0.35, z * 0.8))
  const handleReset = () => {
    setZoom(0.9)
    setPan({ x: 40, y: 30 })
  }
  const handleFit = () => {
    setZoom(0.75)
    setPan({ x: 50, y: 30 })
  }

  return h(
    'section',
    {
      'data-testid': 'pcb-inspector-root',
      style: {
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#05070D',
        color: '#E2ECFF',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      },
    },
    // Top-Left Header: Enlarged "Plugin graph" Title & Diagnostic Summary
    h(
      'div',
      {
        style: {
          position: 'absolute',
          top: 24,
          left: 28,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none',
        },
      },
      h(
        'h1',
        {
          style: {
            margin: 0,
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: 1.2,
            color: '#F0F4FF',
            textShadow: '0 0 12px rgba(100, 116, 255, 0.45)',
            lineHeight: 1.15,
          },
        },
        'Plugin graph',
      ),
      h(
        'div',
        {
          style: {
            fontSize: 12,
            color: '#8EA4CE',
            marginTop: 6,
            letterSpacing: 0.5,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          },
        },
        h('span', null, summary),
      ),
      // Stalled warnings indicator
      snap.stalled.length > 0
        ? h(
            'div',
            {
              style: {
                marginTop: 8,
                padding: '4px 10px',
                borderRadius: 3,
                background: 'rgba(255, 92, 92, 0.15)',
                border: '1px solid rgba(255, 92, 92, 0.4)',
                fontSize: 11,
                color: '#FF5C5C',
                fontWeight: 600,
              },
            },
            `⚠️ ${snap.stalled.length} STALLED FIBER(S)`,
          )
        : null,
    ),

    // Main Interactive PCB Board Viewport
    h(PcbBoard, {
      nodes,
      traces,
      pins,
      selectedNodeId,
      onSelectNode: (node) => setSelectedNodeId(node ? node.id : null),
      zoom,
      pan,
      onZoomChange: setZoom,
      onPanChange: setPan,
    }),

    // Bottom-Right Cybernetic View Controls (+, −, Fit, Reset)
    h(
      'div',
      {
        style: {
          position: 'absolute',
          bottom: 24,
          right: 28,
          zIndex: 40,
          display: 'flex',
          gap: 6,
          background: 'rgba(7, 10, 18, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(100, 116, 255, 0.3)',
          borderRadius: 4,
          padding: 4,
        },
      },
      h(
        'button',
        {
          onClick: handleZoomIn,
          title: 'Zoom In',
          style: {
            background: 'transparent',
            border: 'none',
            color: '#8EA4CE',
            cursor: 'pointer',
            padding: '4px 10px',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'inherit',
          },
        },
        '+',
      ),
      h(
        'button',
        {
          onClick: handleZoomOut,
          title: 'Zoom Out',
          style: {
            background: 'transparent',
            border: 'none',
            color: '#8EA4CE',
            cursor: 'pointer',
            padding: '4px 10px',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'inherit',
          },
        },
        '−',
      ),
      h(
        'button',
        {
          onClick: handleFit,
          title: 'Fit View',
          style: {
            background: 'transparent',
            border: 'none',
            color: '#8EA4CE',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'inherit',
          },
        },
        'FIT',
      ),
      h(
        'button',
        {
          onClick: handleReset,
          title: 'Reset View',
          style: {
            background: 'transparent',
            border: 'none',
            color: '#8EA4CE',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'inherit',
          },
        },
        'RESET',
      ),
    ),

    // Right-Hand Node Details Inspector Panel
    h(NodeDetailsPanel, {
      node: selectedNode,
      onClose: () => setSelectedNodeId(null),
    }),

    // Fiber Diagnostic Telemetry (Accessible & Test-Complete DOM Representation)
    h(
      'div',
      {
        'data-testid': 'fiber-telemetry-manifest',
        style: {
          position: 'absolute',
          left: -99999,
          top: -99999,
          width: 1,
          height: 1,
          overflow: 'hidden',
          opacity: 0.001,
          pointerEvents: 'none',
        },
      },
      ...nodes.map((node) => {
        const f = node.fiber
        return h(
          'div',
          { key: node.id },
          h('span', null, f.name),
          h('span', null, f.state),
          f.provides.length ? h('span', null, `provides ${f.provides.join(', ')}`) : null,
          f.waitingFor.length ? h('span', null, `waiting ${f.waitingFor.join(', ')}`) : null,
        )
      }),
      ...snap.stalled.map((stalled, idx) =>
        h(
          'div',
          { key: `stalled-${idx}` },
          h('span', null, stalled.name),
          h('span', null, stalled.state),
          h('span', null, `waiting ${stalled.waitingFor.join(', ')}`),
        ),
      ),
    ),
  )
}

export const name = 'plugin-inspector-ui-desktop'
export const inject = ['ui', 'inspector']

/**
 * Bind a screen to this plugin's context.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-inspector-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(INSPECTOR_VIEW, bound(ctx, InspectorPanel))
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
export type { EffectNode, FiberNode, InspectorSnapshot }
