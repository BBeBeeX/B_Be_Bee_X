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

function filterEffects(nodes: EffectNode[]): EffectNode[] {
  return nodes
    .filter((node) => !node.label.startsWith('ctx.plugin'))
    .map((node) => ({
      ...node,
      children: filterEffects(node.children),
    }))
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
        width: 340,
        maxHeight: 'calc(100% - 48px)',
        overflowY: 'auto',
        background: 'rgba(7, 10, 18, 0.94)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(100, 116, 255, 0.35)',
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
        { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h(
          'span',
          { style: { fontSize: 14, fontWeight: 700, color: '#F0F4FF' } },
          node.displayName,
        ),
        h(
          'span',
          { style: { fontSize: 11, color: '#8EA4CE' } },
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

    // Status, UID & Role Badges
    h(
      'div',
      { style: { display: 'flex', gap: 14, marginBottom: 14, fontSize: 12 } },
      h(
        'div',
        null,
        h('span', { style: { color: 'rgba(142, 164, 206, 0.6)', fontSize: 10, display: 'block' } }, 'STATE'),
        h('span', { style: { color: stateColor, fontWeight: 700 } }, state),
      ),
      h(
        'div',
        null,
        h('span', { style: { color: 'rgba(142, 164, 206, 0.6)', fontSize: 10, display: 'block' } }, 'UID'),
        h(
          'span',
          { style: { color: '#8EA4CE' } },
          fiber?.uid !== null && fiber?.uid !== undefined ? `#${fiber.uid}` : 'N/A',
        ),
      ),
      h(
        'div',
        null,
        h('span', { style: { color: 'rgba(142, 164, 206, 0.6)', fontSize: 10, display: 'block' } }, 'ROLE'),
        h(
          'span',
          {
            style: {
              color: node.role === 'service' ? '#38BDF8' : node.role === 'scope' ? '#A78BFA' : '#6474FF',
              fontWeight: 600,
            },
          },
          node.role.toUpperCase(),
        ),
      ),
    ),

    // 1. LOADED IN (Where this plugin is loaded / Parent Host)
    h(
      'div',
      {
        style: {
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(142, 164, 206, 0.18)',
          borderRadius: 3,
          padding: '8px 10px',
          marginBottom: 14,
        },
      },
      h(
        'div',
        {
          style: {
            fontSize: 10,
            color: 'rgba(142, 164, 206, 0.6)',
            marginBottom: 3,
            fontWeight: 700,
            letterSpacing: 0.5,
          },
        },
        'LOADED IN (PARENT CONTEXT)',
      ),
      h(
        'div',
        { style: { fontSize: 12, fontWeight: 600, color: '#E2ECFF' } },
        node.parentName ? node.parentName : 'Kernel Root (Root Application Context)',
      ),
      node.role === 'scope'
        ? h(
            'div',
            { style: { fontSize: 10, color: '#A78BFA', marginTop: 3 } },
            'Isolated child inject scope spawned by parent plugin',
          )
        : node.role === 'service'
          ? h(
              'div',
              { style: { fontSize: 10, color: '#38BDF8', marginTop: 3 } },
              'Service instance mounted by parent plugin',
            )
          : null,
    ),

    // Stalled notice (if waiting for services)
    fiber?.waitingFor && fiber.waitingFor.length > 0
      ? h(
          'div',
          {
            style: {
              background: 'rgba(255, 176, 32, 0.12)',
              border: '1px solid rgba(255, 176, 32, 0.45)',
              borderRadius: 3,
              padding: '8px 10px',
              marginBottom: 14,
              fontSize: 11,
              color: '#FFB020',
            },
          },
          h('strong', null, 'STALLED (MISSING DEPENDENCY): '),
          `waiting ${fiber.waitingFor.join(', ')}`,
        )
      : null,

    // 2. REQUIRED DEPENDENCIES (What services & plugins this node needs)
    h(
      'div',
      { style: { marginBottom: 14 } },
      h(
        'div',
        {
          style: {
            fontSize: 10,
            color: 'rgba(142, 164, 206, 0.6)',
            marginBottom: 6,
            fontWeight: 700,
            letterSpacing: 0.5,
          },
        },
        `DEPENDENCIES / REQUIRED SERVICES (${node.dependencies.length})`,
      ),
      node.dependencies.length > 0
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            ...node.dependencies.map((dep) =>
              h(
                'div',
                {
                  key: dep.service,
                  style: {
                    padding: '6px 8px',
                    background: dep.isWaiting
                      ? 'rgba(255, 176, 32, 0.08)'
                      : 'rgba(100, 116, 255, 0.06)',
                    border: `1px solid ${
                      dep.isWaiting ? 'rgba(255, 176, 32, 0.3)' : 'rgba(100, 116, 255, 0.25)'
                    }`,
                    borderRadius: 3,
                    fontSize: 11,
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  h('span', { style: { fontWeight: 700, color: '#6474FF' } }, `ctx.${dep.service}`),
                  dep.isWaiting
                    ? h('span', { style: { fontSize: 10, color: '#FFB020', fontWeight: 600 } }, 'WAITING')
                    : h('span', { style: { fontSize: 10, color: '#3ECF8E', fontWeight: 600 } }, 'RESOLVED'),
                ),
                h(
                  'div',
                  { style: { fontSize: 10, color: '#8EA4CE', marginTop: 3 } },
                  dep.providerName
                    ? `Provided by plugin: ${dep.providerName}`
                    : 'No registered plugin provides this service',
                ),
              ),
            ),
          )
        : h(
            'div',
            { style: { fontSize: 11, color: 'rgba(142, 164, 206, 0.4)', fontStyle: 'italic' } },
            'No external service dependencies required',
          ),
    ),

    // 3. PROVIDES SERVICES (What services this plugin registers)
    fiber?.provides && fiber.provides.length > 0
      ? h(
          'div',
          { style: { marginBottom: 14 } },
          h(
            'div',
            {
              style: {
                fontSize: 10,
                color: 'rgba(142, 164, 206, 0.6)',
                marginBottom: 6,
                fontWeight: 700,
                letterSpacing: 0.5,
              },
            },
            `PROVIDES SERVICES (${fiber.provides.length})`,
          ),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } },
            ...fiber.provides.map((p) =>
              h(
                'span',
                {
                  key: p,
                  style: {
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    color: '#38BDF8',
                    fontSize: 11,
                    padding: '3px 7px',
                    borderRadius: 2,
                    fontWeight: 600,
                  },
                },
                `ctx.${p}`,
              ),
            ),
          ),
        )
      : null,

    // 4. CONSUMED BY (Plugins that depend on this plugin's services)
    node.consumedBy.length > 0
      ? h(
          'div',
          { style: { marginBottom: 14 } },
          h(
            'div',
            {
              style: {
                fontSize: 10,
                color: 'rgba(142, 164, 206, 0.6)',
                marginBottom: 6,
                fontWeight: 700,
                letterSpacing: 0.5,
              },
            },
            `CONSUMED BY (${node.consumedBy.length} PLUGINS)`,
          ),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
            ...node.consumedBy.map((c) =>
              h(
                'span',
                {
                  key: c,
                  style: {
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(142, 164, 206, 0.2)',
                    color: '#8EA4CE',
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 2,
                  },
                },
                c,
              ),
            ),
          ),
        )
      : null,

    // 5. LOADED CHILD PLUGINS
    fiber?.children && fiber.children.length > 0
      ? h(
          'div',
          { style: { marginBottom: 14 } },
          h(
            'div',
            {
              style: {
                fontSize: 10,
                color: 'rgba(142, 164, 206, 0.6)',
                marginBottom: 6,
                fontWeight: 700,
                letterSpacing: 0.5,
              },
            },
            `LOADED PLUGINS (${fiber.children.length})`,
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            ...fiber.children.map((child, idx) =>
              h(
                'div',
                {
                  key: `${child.name}-${idx}`,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    background: 'rgba(100, 116, 255, 0.08)',
                    border: '1px solid rgba(100, 116, 255, 0.25)',
                    borderRadius: 3,
                    fontSize: 11,
                  },
                },
                h('span', { style: { fontWeight: 600, color: '#E2ECFF' } }, child.name),
                h(
                  'span',
                  {
                    style: {
                      fontSize: 10,
                      fontWeight: 700,
                      color: STATE_COLOR[child.state] ?? '#8EA4CE',
                    },
                  },
                  child.state,
                ),
              ),
            ),
          ),
        )
      : null,

    // 6. Meaningful Labelled Effects (internal ctx.plugin() calls filtered out)
    (() => {
      const meaningfulEffects = filterEffects(fiber?.effects ?? [])
      return h(
        'div',
        { style: { marginTop: 14 } },
        h(
          'div',
          { style: { fontSize: 10, color: 'rgba(142, 164, 206, 0.6)', marginBottom: 6, fontWeight: 700 } },
          `REGISTERED EFFECTS (${meaningfulEffects.length})`,
        ),
        meaningfulEffects.length > 0
          ? h(EffectsList, { nodes: meaningfulEffects, depth: 0 })
          : h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: 'rgba(142, 164, 206, 0.4)',
                  fontStyle: 'italic',
                },
              },
              'No active side-effects registered',
            ),
      )
    })(),
  )
}
