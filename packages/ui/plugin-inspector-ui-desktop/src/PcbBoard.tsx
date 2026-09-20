import {
  createElement as h,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { PcbNode, PcbPin, PcbTrace } from './pcb-topology-types.js'

export interface PcbBoardProps {
  nodes: PcbNode[]
  traces: PcbTrace[]
  pins: PcbPin[]
  selectedNodeId: string | null
  onSelectNode: (node: PcbNode | null) => void
  onHoverNode?: (nodeId: string | null) => void
  zoom: number
  pan: { x: number; y: number }
  onZoomChange: (zoom: number) => void
  onPanChange: (pan: { x: number; y: number }) => void
}

const RELATION_COLORS: Record<string, string> = {
  service: '#6474FF',
  hierarchy: '#8EA4CE',
  waiting: '#FFB020',
}

/**
 * Splits a plugin/scope display name across multiple lines so it fits neatly inside
 * geometric shapes (circle, square, triangle).
 */
export function splitDisplayName(name: string, maxLen = 14): string[] {
  if (name.length <= maxLen) return [name]

  if (name.includes(' (')) {
    const idx = name.indexOf(' (')
    return [name.slice(0, idx), name.slice(idx + 1)]
  }

  if (name.includes(' ')) {
    return name.split(' ')
  }

  if (name.includes('-')) {
    const parts = name.split('-')
    const lines: string[] = []
    let current = ''
    for (const p of parts) {
      if (!current) {
        current = p
      } else if ((current + '-' + p).length <= maxLen) {
        current += '-' + p
      } else {
        lines.push(current + '-')
        current = p
      }
    }
    if (current) lines.push(current)
    return lines
  }

  const lines: string[] = []
  for (let i = 0; i < name.length; i += maxLen) {
    lines.push(name.slice(i, i + maxLen))
  }
  return lines
}

/**
 * Renders an array of text lines centered vertically around cy.
 */
function renderTextLines(
  lines: string[],
  cx: number,
  cy: number,
  baseFontSize = 11.5,
): ReactElement[] {
  const lineHeight = 13.5
  const totalOffset = ((lines.length - 1) * lineHeight) / 2
  return lines.map((line, i) => {
    const y = cy - totalOffset + i * lineHeight + 4
    return h(
      'text',
      {
        key: `line-${i}-${line}`,
        x: cx,
        y,
        textAnchor: 'middle',
        fill: '#0A1220',
        fontSize: baseFontSize,
        fontWeight: 700,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        letterSpacing: -0.2,
      },
      line,
    )
  })
}

export function PcbBoard({
  nodes,
  traces,
  pins,
  selectedNodeId,
  onSelectNode,
  onHoverNode,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
}: PcbBoardProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasGroupRef = useRef<SVGGElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const currentPanRef = useRef(pan)
  const rafIdRef = useRef<number | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  // Keep currentPanRef in sync with external pan updates
  useEffect(() => {
    currentPanRef.current = pan
  }, [pan])

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      isDraggingRef.current = true
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: currentPanRef.current.x,
        panY: currentPanRef.current.y,
      }
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      currentPanRef.current = {
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      }

      // 120fps direct hardware transform without triggering React re-renders
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          if (canvasGroupRef.current) {
            canvasGroupRef.current.setAttribute(
              'transform',
              `translate(${currentPanRef.current.x}, ${currentPanRef.current.y}) scale(${zoom})`,
            )
          }
        })
      }
    },
    [zoom],
  )

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      onPanChange(currentPanRef.current)
    }
  }, [onPanChange])

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9
      const newZoom = Math.max(0.35, Math.min(2.5, zoom * zoomFactor))

      if (!containerRef.current) {
        onZoomChange(newZoom)
        return
      }

      const rect = containerRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const newPanX = mouseX - ((mouseX - pan.x) / zoom) * newZoom
      const newPanY = mouseY - ((mouseY - pan.y) / zoom) * newZoom

      onZoomChange(newZoom)
      onPanChange({ x: newPanX, y: newPanY })
    },
    [zoom, pan, onZoomChange, onPanChange],
  )

  useEffect(() => {
    onHoverNode?.(hoveredNodeId)
  }, [hoveredNodeId, onHoverNode])

  // Focus graph: connected traces for active node
  const activeNodeId = hoveredNodeId ?? selectedNodeId
  const connectedTraceIds = new Set<string>()
  if (activeNodeId) {
    for (const t of traces) {
      if (t.fromNodeId === activeNodeId || t.toNodeId === activeNodeId) {
        connectedTraceIds.add(t.id)
      }
    }
  }

  return h(
    'div',
    {
      ref: containerRef,
      'data-testid': 'pcb-board-viewport',
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onWheel: handleWheel,
      style: {
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
        background: '#05070D',
        userSelect: 'none',
      },
    },
    // Keyframes for signal pulses & breathing halos
    h(
      'style',
      null,
      `
      @keyframes pcbSignalPulse {
        0% { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: -400; }
      }
      @keyframes nodeBreathing {
        0%, 100% { filter: drop-shadow(0 0 4px rgba(100, 116, 255, 0.3)); }
        50% { filter: drop-shadow(0 0 12px rgba(100, 116, 255, 0.7)); }
      }
      .signal-flow-path {
        stroke-dasharray: 12 180;
        animation: pcbSignalPulse 10s linear infinite;
      }
      .selected-halo {
        animation: nodeBreathing 3s ease-in-out infinite;
      }
    `,
    ),
    h(
      'svg',
      {
        width: '100%',
        height: '100%',
        style: { display: 'block', width: '100%', height: '100%' },
      },
      // Definitions: Filters & Background Grid Pattern
      h(
        'defs',
        null,
        h(
          'pattern',
          {
            id: 'pcb-grid-pattern',
            width: 40,
            height: 40,
            patternUnits: 'userSpaceOnUse',
          },
          h('path', {
            d: 'M 40 0 L 0 0 0 40',
            fill: 'none',
            stroke: 'rgba(100, 116, 255, 0.04)',
            strokeWidth: 1,
          }),
          h('circle', {
            cx: 0,
            cy: 0,
            r: 1,
            fill: 'rgba(142, 164, 206, 0.08)',
          }),
        ),
        h(
          'filter',
          {
            id: 'pcb-glow',
            x: '-30%',
            y: '-30%',
            width: '160%',
            height: '160%',
          },
          h('feGaussianBlur', { stdDeviation: '3.5', result: 'blur' }),
          h(
            'feMerge',
            null,
            h('feMergeNode', { in: 'blur' }),
            h('feMergeNode', { in: 'SourceGraphic' }),
          ),
        ),
        h(
          'radialGradient',
          { id: 'ambient-glow-1', cx: '50%', cy: '50%', r: '50%' },
          h('stop', { offset: '0%', stopColor: 'rgba(74, 94, 218, 0.12)' }),
          h('stop', { offset: '100%', stopColor: 'rgba(5, 7, 13, 0)' }),
        ),
      ),

      // Background Grid
      h('rect', {
        width: '100%',
        height: '100%',
        fill: 'url(#pcb-grid-pattern)',
        pointerEvents: 'none',
      }),

      // Root Canvas Transform Group
      h(
        'g',
        {
          ref: canvasGroupRef,
          transform: `translate(${pan.x}, ${pan.y}) scale(${zoom})`,
          style: { transformOrigin: '0 0', willChange: 'transform' },
        },

        // ═══════════════════════════════════════════════════════
        // LAYER 1: GLOW LAYER (Ambient Backlight & Trace Bloom)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'glow-layer', pointerEvents: 'none' },
          // Diffused soft trace bloom
          ...traces.map((trace) => {
            const isTraceActive = activeNodeId ? connectedTraceIds.has(trace.id) : true
            const baseColor = RELATION_COLORS[trace.relationType] ?? '#6474FF'
            return h('path', {
              key: `glow-${trace.id}`,
              d: trace.path,
              fill: 'none',
              stroke: baseColor,
              strokeWidth: (trace.width ?? 2) + 4,
              strokeOpacity: isTraceActive ? (activeNodeId ? 0.35 : 0.18) : 0.05,
            })
          }),

          // Glow halo for selected chip node (Circle, Square, or Triangle matching role)
          selectedNodeId
            ? (() => {
                const node = nodes.find((n) => n.id === selectedNodeId)
                if (!node) return null
                const cx = node.x + node.width / 2
                const cy = node.y + node.height / 2

                if (node.role === 'root' || node.role === 'plugin') {
                  const r = node.width / 2 + 7
                  return h('circle', {
                    key: 'selected-halo',
                    className: 'selected-halo',
                    cx,
                    cy,
                    r,
                    fill: 'none',
                    stroke: '#D4F658',
                    strokeWidth: 2.5,
                    strokeOpacity: 0.85,
                    filter: 'url(#pcb-glow)',
                  })
                } else if (node.role === 'service') {
                  return h('rect', {
                    key: 'selected-halo',
                    className: 'selected-halo',
                    x: node.x - 7,
                    y: node.y - 7,
                    width: node.width + 14,
                    height: node.height + 14,
                    rx: 8,
                    ry: 8,
                    fill: 'none',
                    stroke: '#D4F658',
                    strokeWidth: 2.5,
                    strokeOpacity: 0.85,
                    filter: 'url(#pcb-glow)',
                  })
                } else {
                  // scope - triangle halo
                  const p1 = `${cx},${node.y - 8}`
                  const p2 = `${node.x + node.width + 8},${node.y + node.height + 6}`
                  const p3 = `${node.x - 8},${node.y + node.height + 6}`
                  return h('polygon', {
                    key: 'selected-halo',
                    className: 'selected-halo',
                    points: `${p1} ${p2} ${p3}`,
                    fill: 'none',
                    stroke: '#D4F658',
                    strokeWidth: 2.5,
                    strokeLinejoin: 'round',
                    strokeOpacity: 0.85,
                    filter: 'url(#pcb-glow)',
                  })
                }
              })()
            : null,
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 2: TRACE LAYER (Real Relationship Orthogonal Traces)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'trace-layer', pointerEvents: 'none' },
          ...traces.map((trace) => {
            const isTraceActive = activeNodeId ? connectedTraceIds.has(trace.id) : true
            const baseColor = RELATION_COLORS[trace.relationType] ?? '#6474FF'
            const strokeColor = isTraceActive
              ? activeNodeId
                ? '#8598FF'
                : baseColor
              : 'rgba(60, 75, 105, 0.25)'

            return h(
              'g',
              { key: trace.id },
              h('path', {
                d: trace.path,
                fill: 'none',
                stroke: strokeColor,
                strokeWidth: isTraceActive && activeNodeId ? (trace.width ?? 2) + 0.5 : trace.width ?? 2,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
                opacity: isTraceActive ? 1 : 0.25,
                transition: 'stroke 0.2s, opacity 0.2s',
              }),
              // Via pads at orthogonal bends
              ...(trace.vias ?? []).map((via, vi) =>
                h(
                  'g',
                  { key: `via-${trace.id}-${vi}` },
                  h('circle', {
                    cx: via.x,
                    cy: via.y,
                    r: 3.5,
                    fill: '#05070D',
                    stroke: strokeColor,
                    strokeWidth: 1.4,
                  }),
                  h('circle', {
                    cx: via.x,
                    cy: via.y,
                    r: 1.4,
                    fill: strokeColor,
                  }),
                ),
              ),
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 3: PIN LAYER (Connector Pins & Solder Dots)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'pin-layer', pointerEvents: 'none' },
          ...pins.map((pin) =>
            h(
              'g',
              { key: pin.id },
              h('circle', {
                cx: pin.x,
                cy: pin.y,
                r: pin.padSize ?? 3.5,
                fill: '#8EA4CE',
                stroke: '#05070D',
                strokeWidth: 1.2,
              }),
            ),
          ),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 4: NODE LAYER (Geometric IC Shapes based on Role)
        // [ROOT] & [PLUGIN] -> Circle
        // [SERVICE] -> Square / Matrix IC package
        // [SCOPE] -> Triangle Delta
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'node-layer' },
          ...nodes.map((node) => {
            const isSelected = node.id === selectedNodeId
            const isHovered = node.id === hoveredNodeId
            const isStalled = node.fiber.state === 'PENDING' || node.fiber.state === 'FAILED'

            const fillColor = isStalled
              ? '#B86B7D'
              : node.role === 'root'
                ? '#72859E'
                : node.role === 'service'
                  ? '#7492A0'
                  : node.role === 'scope'
                    ? '#8A91B0'
                    : '#8598B2'

            const strokeColor = isSelected
              ? '#D4F658'
              : isHovered
                ? '#E2ECFF'
                : '#AAB9D0'

            const cx = node.x + node.width / 2
            const cy = node.y + node.height / 2
            const lines = splitDisplayName(node.displayName)

            let shapeElements: ReactElement[]

            if (node.role === 'root' || node.role === 'plugin') {
              // ─── CIRCLE (Ordinary Plugin & Root Kernel) ───
              const r = node.width / 2
              shapeElements = [
                // 1. Circle body
                h('circle', {
                  key: 'body',
                  cx,
                  cy,
                  r,
                  fill: fillColor,
                  stroke: strokeColor,
                  strokeWidth: isSelected ? 2.5 : 1.6,
                  filter: isHovered ? 'url(#pcb-glow)' : undefined,
                  transition: 'stroke 0.2s, stroke-width 0.2s',
                }),
                // 2. Inner circular concentric ring
                h('circle', {
                  key: 'bevel',
                  cx,
                  cy,
                  r: r - 5,
                  fill: 'none',
                  stroke: 'rgba(10, 18, 32, 0.25)',
                  strokeWidth: 1,
                  strokeDasharray: node.role === 'root' ? '4 2' : undefined,
                }),
                // 3. Polar solder terminal pads
                h('circle', {
                  key: 'pin-top',
                  cx,
                  cy: node.y,
                  r: 3,
                  fill: '#05070D',
                  stroke: strokeColor,
                  strokeWidth: 1.2,
                }),
                h('circle', {
                  key: 'pin-bottom',
                  cx,
                  cy: node.y + node.height,
                  r: 3,
                  fill: '#05070D',
                  stroke: strokeColor,
                  strokeWidth: 1.2,
                }),
                // 4. Role badge
                h(
                  'text',
                  {
                    key: 'role',
                    x: cx,
                    y: cy - 28,
                    textAnchor: 'middle',
                    fill: node.role === 'root' ? '#1E3A8A' : '#1E293B',
                    fontSize: 9,
                    fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    letterSpacing: 0.8,
                  },
                  node.role === 'root' ? '[ROOT]' : '[PLUGIN]',
                ),
                // 5. Centered name lines
                ...renderTextLines(lines, cx, cy),
                // 6. Subtitle
                node.fiber.children && node.fiber.children.length > 0
                  ? h(
                      'text',
                      {
                        key: 'subtitle',
                        x: cx,
                        y: cy + 33,
                        textAnchor: 'middle',
                        fill: '#1E293B',
                        fontSize: 9.5,
                        fontWeight: 600,
                        fontFamily: 'ui-monospace, monospace',
                      },
                      `${node.fiber.children.length} plugins`,
                    )
                  : isStalled
                    ? h(
                        'text',
                        {
                          key: 'stalled',
                          x: cx,
                          y: cy + 33,
                          textAnchor: 'middle',
                          fill: '#991B1B',
                          fontSize: 9.5,
                          fontWeight: 700,
                          fontFamily: 'ui-monospace, monospace',
                        },
                        node.fiber.state,
                      )
                    : null,
              ].filter(Boolean) as ReactElement[]
            } else if (node.role === 'service') {
              // ─── SQUARE / MATRIX IC PACKAGE (Service Instance) ───
              const w = node.width
              const h_dim = node.height
              const pinOffsets = [-24, -8, 8, 24]
              const icPins: ReactElement[] = [
                ...pinOffsets.map((dy, i) =>
                  h('rect', {
                    key: `pin-l-${i}`,
                    x: node.x - 4,
                    y: cy + dy - 2,
                    width: 4,
                    height: 4,
                    fill: '#8EA4CE',
                    stroke: '#05070D',
                    strokeWidth: 0.8,
                  }),
                ),
                ...pinOffsets.map((dy, i) =>
                  h('rect', {
                    key: `pin-r-${i}`,
                    x: node.x + w,
                    y: cy + dy - 2,
                    width: 4,
                    height: 4,
                    fill: '#8EA4CE',
                    stroke: '#05070D',
                    strokeWidth: 0.8,
                  }),
                ),
                ...pinOffsets.map((dx, i) =>
                  h('rect', {
                    key: `pin-t-${i}`,
                    x: cx + dx - 2,
                    y: node.y - 4,
                    width: 4,
                    height: 4,
                    fill: '#8EA4CE',
                    stroke: '#05070D',
                    strokeWidth: 0.8,
                  }),
                ),
                ...pinOffsets.map((dx, i) =>
                  h('rect', {
                    key: `pin-b-${i}`,
                    x: cx + dx - 2,
                    y: node.y + h_dim,
                    width: 4,
                    height: 4,
                    fill: '#8EA4CE',
                    stroke: '#05070D',
                    strokeWidth: 0.8,
                  }),
                ),
              ]

              shapeElements = [
                ...icPins,
                // 1. Square chip body
                h('rect', {
                  key: 'body',
                  x: node.x,
                  y: node.y,
                  width: w,
                  height: h_dim,
                  rx: 4,
                  ry: 4,
                  fill: fillColor,
                  stroke: strokeColor,
                  strokeWidth: isSelected ? 2.5 : 1.6,
                  filter: isHovered ? 'url(#pcb-glow)' : undefined,
                  transition: 'stroke 0.2s, stroke-width 0.2s',
                }),
                // 2. Inner matrix border
                h('rect', {
                  key: 'bevel',
                  x: node.x + 5,
                  y: node.y + 5,
                  width: w - 10,
                  height: h_dim - 10,
                  rx: 2,
                  ry: 2,
                  fill: 'none',
                  stroke: 'rgba(10, 18, 32, 0.25)',
                  strokeWidth: 1,
                }),
                // 3. Pin 1 orientation index notch dot
                h('circle', {
                  key: 'pin-1-dot',
                  cx: node.x + 12,
                  cy: node.y + 12,
                  r: 2.5,
                  fill: '#064E3B',
                  opacity: 0.75,
                }),
                // 4. Role badge
                h(
                  'text',
                  {
                    key: 'role',
                    x: cx,
                    y: cy - 28,
                    textAnchor: 'middle',
                    fill: '#064E3B',
                    fontSize: 9,
                    fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    letterSpacing: 0.8,
                  },
                  '[SERVICE]',
                ),
                // 5. Centered service name
                ...renderTextLines(lines, cx, cy),
                // 6. Subtitle
                h(
                  'text',
                  {
                    key: 'subtitle',
                    x: cx,
                    y: cy + 33,
                    textAnchor: 'middle',
                    fill: '#065F46',
                    fontSize: 9.5,
                    fontWeight: 700,
                    fontFamily: 'ui-monospace, monospace',
                    letterSpacing: 0.5,
                  },
                  isStalled ? node.fiber.state : 'ACTIVE SERVICE',
                ),
              ].filter(Boolean) as ReactElement[]
            } else {
              // ─── TRIANGLE DELTA (Injected Sub-Scope) ───
              const pTop = `${cx},${node.y}`
              const pRight = `${node.x + node.width},${node.y + node.height}`
              const pLeft = `${node.x},${node.y + node.height}`

              const pInnerTop = `${cx},${node.y + 10}`
              const pInnerRight = `${node.x + node.width - 8},${node.y + node.height - 4}`
              const pInnerLeft = `${node.x + 8},${node.y + node.height - 4}`

              const textCenterY = node.y + node.height * 0.68

              shapeElements = [
                // 1. Triangle polygon body
                h('polygon', {
                  key: 'body',
                  points: `${pTop} ${pRight} ${pLeft}`,
                  fill: fillColor,
                  stroke: strokeColor,
                  strokeWidth: isSelected ? 2.5 : 1.6,
                  strokeLinejoin: 'round',
                  filter: isHovered ? 'url(#pcb-glow)' : undefined,
                  transition: 'stroke 0.2s, stroke-width 0.2s',
                }),
                // 2. Inner offset triangle border
                h('polygon', {
                  key: 'bevel',
                  points: `${pInnerTop} ${pInnerRight} ${pInnerLeft}`,
                  fill: 'none',
                  stroke: 'rgba(10, 18, 32, 0.25)',
                  strokeWidth: 1,
                  strokeLinejoin: 'round',
                }),
                // 3. Top apex via
                h('circle', {
                  key: 'apex-via',
                  cx,
                  cy: node.y,
                  r: 3,
                  fill: '#05070D',
                  stroke: strokeColor,
                  strokeWidth: 1.2,
                }),
                // 4. Role badge
                h(
                  'text',
                  {
                    key: 'role',
                    x: cx,
                    y: node.y + 44,
                    textAnchor: 'middle',
                    fill: '#581C87',
                    fontSize: 9,
                    fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    letterSpacing: 0.8,
                  },
                  '[SCOPE]',
                ),
                // 5. Centered name
                ...renderTextLines(lines, cx, textCenterY),
                // 6. Subtitle
                h(
                  'text',
                  {
                    key: 'subtitle',
                    x: cx,
                    y: node.y + node.height - 10,
                    textAnchor: 'middle',
                    fill: '#581C87',
                    fontSize: 8.5,
                    fontWeight: 600,
                    fontFamily: 'ui-monospace, monospace',
                    letterSpacing: 0.5,
                  },
                  isStalled ? node.fiber.state : 'INJECTED SCOPE',
                ),
              ].filter(Boolean) as ReactElement[]
            }

            return h(
              'g',
              {
                key: node.id,
                'data-testid': `node-${node.id}`,
                'data-name': node.displayName,
                'data-plugin': node.name,
                onClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  onSelectNode(node)
                },
                onDoubleClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect()
                    onPanChange({
                      x: rect.width / 2 - (node.x + node.width / 2) * zoom,
                      y: rect.height / 2 - (node.y + node.height / 2) * zoom,
                    })
                  }
                },
                onMouseEnter: () => setHoveredNodeId(node.id),
                onMouseLeave: () => setHoveredNodeId(null),
                style: { cursor: 'pointer' },
              },
              h('title', null, `${node.displayName} (${node.role.toUpperCase()})`),
              ...shapeElements,
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 5: SIGNAL FLOW LAYER (Real Dependency Packet Flow)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'signal-flow-layer', pointerEvents: 'none' },
          ...traces
            .filter((t) => t.hasSignalFlow)
            .map((trace) =>
              h('path', {
                key: `signal-${trace.id}`,
                className: 'signal-flow-path',
                d: trace.path,
                fill: 'none',
                stroke: '#E2ECFF',
                strokeWidth: (trace.width ?? 2) + 0.8,
                strokeLinecap: 'round',
                filter: 'url(#pcb-glow)',
                opacity: 0.8,
              }),
            ),
        ),
      ),
    ),
  )
}
