import { createElement as h, type ReactElement } from 'react'
import type { EffectNode } from '@BBeBee/plugin-inspector'
import type { PcbNode } from './pcb-topology-types.js'

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
        h('span', { style: { color: '#6474FF', marginRight: 4 } }, '·'),
        node.label,
        node.children.length ? h(EffectsList, { nodes: node.children, depth: depth + 1 }) : null,
      ),
    ),
  )
}

export interface NodeDetailsPanelProps {
  node: PcbNode | null
  onClose: () => void
}

/**
 * High-tech side panel providing in-depth Cordis fiber inspection
 * when an IC chip node is clicked/selected.
 */
export function NodeDetailsPanel({ node, onClose }: NodeDetailsPanelProps): ReactElement | null {
  if (!node) return null

  const fiber = node.fiber
  const state = fiber?.state ?? 'UNKNOWN'
  const stateColor = STATE_COLOR[state] ?? '#8EA4CE'

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
        background: 'rgba(7, 10, 18, 0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(100, 116, 255, 0.3)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), 0 0 16px rgba(100, 116, 255, 0.15)',
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
          borderBottom: '1px solid rgba(142, 164, 206, 0.2)',
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
              fontWeight: 700,
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 3,
            },
          },
          node.code.toUpperCase(),
        ),
        h(
          'span',
          { style: { fontSize: 13, fontWeight: 600, color: '#F0F4FF' } },
          fiber?.name ?? node.id,
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
          },
        },
        '✕',
      ),
    ),
    // Status & UID
    h(
      'div',
      { style: { display: 'flex', gap: 12, marginBottom: 12, fontSize: 12 } },
      h(
        'div',
        null,
        h('span', { style: { color: 'rgba(142, 164, 206, 0.6)', fontSize: 10 } }, 'STATE\n'),
        h('span', { style: { color: stateColor, fontWeight: 700 } }, state),
      ),
      h(
        'div',
        null,
        h('span', { style: { color: 'rgba(142, 164, 206, 0.6)', fontSize: 10 } }, 'UID\n'),
        h(
          'span',
          { style: { color: '#8EA4CE' } },
          fiber?.uid !== null && fiber?.uid !== undefined ? `#${fiber.uid}` : 'N/A',
        ),
      ),
      h(
        'div',
        null,
        h('span', { style: { color: 'rgba(142, 164, 206, 0.6)', fontSize: 10 } }, 'KIND\n'),
        h('span', { style: { color: '#6474FF' } }, node.kind.toUpperCase()),
      ),
    ),
    // Waiting For (Stalled notice)
    fiber?.waitingFor && fiber.waitingFor.length > 0
      ? h(
          'div',
          {
            style: {
              background: 'rgba(255, 176, 32, 0.1)',
              border: '1px solid rgba(255, 176, 32, 0.4)',
              borderRadius: 3,
              padding: '8px 10px',
              marginBottom: 12,
              fontSize: 11,
              color: '#FFB020',
            },
          },
          h('strong', null, 'STALLED: '),
          `waiting ${fiber.waitingFor.join(', ')}`,
        )
      : null,
    // Provides
    fiber?.provides && fiber.provides.length > 0
      ? h(
          'div',
          { style: { marginBottom: 12 } },
          h(
            'div',
            { style: { fontSize: 10, color: 'rgba(142, 164, 206, 0.6)', marginBottom: 4 } },
            'PROVIDES SERVICES',
          ),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
            ...fiber.provides.map((p) =>
              h(
                'span',
                {
                  key: p,
                  style: {
                    background: 'rgba(100, 116, 255, 0.15)',
                    border: '1px solid rgba(100, 116, 255, 0.4)',
                    color: '#8EA4CE',
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 2,
                  },
                },
                `ctx.${p}`,
              ),
            ),
          ),
        )
      : null,
    // Injected Dependencies
    fiber?.inject && fiber.inject.length > 0
      ? h(
          'div',
          { style: { marginBottom: 12 } },
          h(
            'div',
            { style: { fontSize: 10, color: 'rgba(142, 164, 206, 0.6)', marginBottom: 4 } },
            'INJECTED DEPENDENCIES',
          ),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
            ...fiber.inject.map((inj) =>
              h(
                'span',
                {
                  key: inj,
                  style: {
                    background: 'rgba(255, 255, 255, 0.05)',
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
          ),
        )
      : null,
    // Labelled Effects
    h(
      'div',
      { style: { marginTop: 14 } },
      h(
        'div',
        { style: { fontSize: 10, color: 'rgba(142, 164, 206, 0.6)', marginBottom: 6 } },
        `EFFECTS (${fiber?.effects?.length ?? 0})`,
      ),
      fiber?.effects && fiber.effects.length > 0
        ? h(EffectsList, { nodes: fiber.effects, depth: 0 })
        : h(
            'div',
            { style: { fontSize: 11, color: 'rgba(142, 164, 206, 0.4)', fontStyle: 'italic' } },
            'No active side-effects registered',
          ),
    ),
  )
}
