import { createElement as h, type ReactElement } from 'react'
import type { EffectNode } from '@BBeBee/plugin-inspector'
import type { PcbNode, ViewLevel } from './pcb-topology-types.js'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export const STATE_COLOR: Record<string, string> = {
  ACTIVE: '#3ECF8E',
  PENDING: '#FFB020',
  LOADING: '#FFB020',
  FAILED: '#FF5C5C',
  UNLOADING: '#8EA4CE',
  DISPOSED: '#5A5A68',
  UNKNOWN: '#5A5A68',
}

function EffectsList({ nodes, depth }: { nodes: EffectNode[]; depth: number }): ReactElement {
  return h(
    'ul',
    {
      style: {
        listStyle: 'none',
        margin: 0,
        paddingLeft: depth === 0 ? 0 : 12,
        borderLeft: depth === 0 ? 'none' : '1px solid rgba(142, 164, 206, 0.2)',
      },
    },
    ...nodes.map((node, i) =>
      h(
        'li',
        {
          key: `${node.label}-${i}`,
          style: {
            color: '#8EA4CE',
            fontSize: 11,
            margin: '2px 0',
            fontFamily: 'ui-monospace, monospace',
          },
        },
        h('span', { style: { color: '#596AFF', marginRight: 4 } }, '·'),
        node.label,
        node.children.length ? h(EffectsList, { nodes: node.children, depth: depth + 1 }) : null,
      ),
    ),
  )
}

export interface NodeDetailsPanelProps {
  node: PcbNode | null
  viewLevel?: ViewLevel
  onDrillDown?: (level: ViewLevel, nodeId: string) => void
  onClose: () => void
}

/**
 * High-tech side panel providing in-depth Cordis fiber inspection
 * formatted strictly in the requested technical monospace PCB HUD style.
 */
export function NodeDetailsPanel({
  node,
  viewLevel = 1,
  onDrillDown,
  onClose,
}: NodeDetailsPanelProps): ReactElement | null {
  if (!node) return null

  const fiber = node.fiber
  const state = fiber?.state ?? 'UNKNOWN'
  const stateColor = STATE_COLOR[state] ?? '#8EA4CE'
  const childrenCount = fiber?.childrenCount ?? 0

  return h(
    'aside',
    {
      'data-testid': 'node-details-panel',
      style: {
        position: 'absolute',
        top: 24,
        right: 24,
        width: 320,
        maxHeight: 'calc(100% - 48px)',
        overflowY: 'auto',
        background: 'rgba(5, 7, 13, 0.94)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(89, 106, 255, 0.35)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.85), 0 0 16px rgba(89, 106, 255, 0.15)',
        padding: 18,
        color: '#D1DCF0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        zIndex: 50,
      },
    },
    // Header
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(89, 106, 255, 0.25)',
          paddingBottom: 10,
          marginBottom: 14,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h(
          'span',
          {
            style: {
              background: '#8598B2',
              color: '#0A1220',
              fontWeight: 800,
              fontSize: 11,
              padding: '2px 7px',
              borderRadius: 2,
              letterSpacing: 0.5,
            },
          },
          node.code.toUpperCase(),
        ),
        h(
          'span',
          { style: { fontSize: 13, fontWeight: 700, color: '#F0F4FF' } },
          node.name ?? fiber?.name ?? node.id,
        ),
      ),
      h(
        'button',
        {
          onClick: onClose,
          title: 'Close panel',
          style: {
            background: 'transparent',
            border: 'none',
            color: '#8EA4CE',
            cursor: 'pointer',
            fontSize: 16,
            padding: 4,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
        tablerIcon('x', { size: 18 }),
      ),
    ),

    // Stalled / Waiting Notice
    fiber?.waitingFor && fiber.waitingFor.length > 0
      ? h(
          'div',
          {
            style: {
              background: 'rgba(255, 92, 92, 0.15)',
              border: '1px solid rgba(255, 92, 92, 0.45)',
              borderRadius: 3,
              padding: '8px 10px',
              marginBottom: 14,
              fontSize: 11,
              color: '#FF5C5C',
            },
          },
          h('strong', null, 'STALLED: '),
          `waiting ${fiber.waitingFor.join(', ')}`,
        )
      : null,

    // NODE / UID
    h(
      'div',
      { style: { marginBottom: 12 } },
      h(
        'div',
        { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2 } },
        'NODE',
      ),
      h('div', { style: { fontSize: 13, fontWeight: 700, color: '#F0F4FF' } }, fiber?.name ?? node.id),
      h(
        'div',
        { style: { fontSize: 11, color: '#8EA4CE' } },
        fiber?.uid !== null && fiber?.uid !== undefined ? `UID ${fiber.uid}` : 'UID null',
      ),
    ),

    // LAYER & SUBSYSTEM
    h(
      'div',
      { style: { display: 'flex', gap: 20, marginBottom: 12 } },
      h(
        'div',
        null,
        h(
          'div',
          { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2 } },
          'LAYER',
        ),
        h(
          'div',
          { style: { fontSize: 13, fontWeight: 700, color: '#596AFF' } },
          node.layer ? `Layer ${node.layer}` : 'Layer 4',
        ),
      ),
      h(
        'div',
        null,
        h(
          'div',
          { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2 } },
          'STATE',
        ),
        h('div', { style: { fontSize: 12, fontWeight: 700, color: stateColor } }, state),
      ),
      node.subsystem
        ? h(
            'div',
            null,
            h(
              'div',
              { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2 } },
              'ZONE',
            ),
            h(
              'div',
              { style: { fontSize: 11, fontWeight: 600, color: '#8EA4CE' } },
              node.subsystem.toUpperCase(),
            ),
          )
        : null,
    ),

    // PROVIDES
    h(
      'div',
      { style: { marginBottom: 12 } },
      h(
        'div',
        { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2, marginBottom: 4 } },
        'PROVIDES',
      ),
      fiber?.provides && fiber.provides.length > 0
        ? h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
            ...fiber.provides.map((p) =>
              h(
                'span',
                {
                  key: p,
                  style: {
                    background: 'rgba(89, 106, 255, 0.15)',
                    border: '1px solid rgba(89, 106, 255, 0.4)',
                    color: '#9AA6FF',
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 2,
                  },
                },
                p,
              ),
            ),
          )
        : h(
            'div',
            { style: { fontSize: 11, color: 'rgba(142, 164, 206, 0.4)' } },
            'none',
          ),
    ),

    // INJECTS
    h(
      'div',
      { style: { marginBottom: 12 } },
      h(
        'div',
        { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2, marginBottom: 4 } },
        'INJECTS',
      ),
      fiber?.inject && fiber.inject.length > 0
        ? h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
            ...fiber.inject.map((inj) =>
              h(
                'span',
                {
                  key: inj,
                  style: {
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(142, 164, 206, 0.2)',
                    color: '#8EA4CE',
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 2,
                  },
                },
                inj,
              ),
            ),
          )
        : h(
            'div',
            { style: { fontSize: 11, color: 'rgba(142, 164, 206, 0.4)' } },
            'none',
          ),
    ),

    // PARENT & CHILDREN
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 12 } },
      h(
        'div',
        null,
        h(
          'div',
          { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2 } },
          'PARENT',
        ),
        h(
          'div',
          { style: { fontSize: 11, color: '#8EA4CE' } },
          node.parentPluginId ?? 'root',
        ),
      ),
      h(
        'div',
        null,
        h(
          'div',
          { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2 } },
          'CHILDREN',
        ),
        h(
          'div',
          { style: { fontSize: 12, fontWeight: 700, color: '#F0F4FF', textAlign: 'right' } },
          childrenCount,
        ),
      ),
    ),

    // Action button to drill down into satellite child fibers (Level 3)
    childrenCount > 0 && viewLevel !== 3
      ? h(
          'button',
          {
            onClick: () => onDrillDown?.(3, node.id),
            style: {
              width: '100%',
              marginBottom: 14,
              padding: '6px 12px',
              background: 'rgba(89, 106, 255, 0.2)',
              border: '1px solid #596AFF',
              borderRadius: 3,
              color: '#E2ECFF',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            },
          },
          `EXPAND ${childrenCount} CHILD FIBERS (L3)`,
        )
      : null,

    // Labelled Effects
    h(
      'div',
      { style: { marginTop: 12, borderTop: '1px solid rgba(89, 106, 255, 0.2)', paddingTop: 10 } },
      h(
        'div',
        { style: { fontSize: 9, color: 'rgba(142, 164, 206, 0.5)', letterSpacing: 1.2, marginBottom: 6 } },
        `EFFECTS (${fiber?.effects?.length ?? 0})`,
      ),
      fiber?.effects && fiber.effects.length > 0
        ? h(EffectsList, { nodes: fiber.effects, depth: 0 })
        : h(
            'div',
            { style: { fontSize: 11, color: 'rgba(142, 164, 206, 0.35)', fontStyle: 'italic' } },
            'No active side-effects registered',
          ),
    ),
  )
}

