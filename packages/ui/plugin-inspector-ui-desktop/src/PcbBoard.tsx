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

const TRACE_COLORS: Record<string, string> = {
  primary: '#6474FF',
  secondary: '#8EA4CE',
  accent: '#B86B7D',
  warning: '#FFB020',
  inactive: '#2A3550',
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
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // Only drag with primary mouse button
      if (e.button !== 0) return
      isDraggingRef.current = true
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      }
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      onPanChange({
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      })
    },
    [onPanChange],
  )

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

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

      // Zoom towards mouse pointer
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

  // Determine connected traces for focus graph
  const activeNodeId = hoveredNodeId ?? selectedNodeId
  const connectedTraceIds = new Set<string>()
  if (activeNodeId) {
    for (const t of traces) {
      if (t.fromNodeId === activeNodeId || t.toNodeId === activeNodeId) {
        connectedTraceIds.add(t.id)
      }
    }
  }

  // Cloud path for Level 4 & Level 5 (organic cloud SVG shape)
  const getCloudPath = (x: number, y: number, w: number, h: number) => {
    const rx = w / 2
    const ry = h / 2
    return `
      M ${x - rx + 30} ${y + ry}
      A 28 28 0 0 1 ${x - rx + 20} ${y - ry + 25}
      A 35 35 0 0 1 ${x - 10} ${y - ry + 10}
      A 42 42 0 0 1 ${x + rx - 20} ${y - ry + 15}
      A 32 32 0 0 1 ${x + rx} ${y + ry - 10}
      A 28 28 0 0 1 ${x + rx - 35} ${y + ry}
      Z
    `
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
    // CSS Keyframes for smooth Signal Flow pulse animation and breath glow
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
      // Layer 0: Definitions, Filters & Grid Patterns
      h(
        'defs',
        null,
        // High-tech PCB Grid Pattern
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
        // Controlled, non-blinding PCB Glow Filter
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
        // Ambient backlight radial gradient
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
          transform: `translate(${pan.x}, ${pan.y}) scale(${zoom})`,
          style: { transformOrigin: '0 0' },
        },

        // ═══════════════════════════════════════════════════════
        // LAYER 1: GLOW LAYER (Ambient Light & Trace Bloom)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'glow-layer', pointerEvents: 'none' },
          // Ambient circuit cluster backlights
          h('ellipse', {
            cx: 970,
            cy: 450,
            rx: 600,
            ry: 400,
            fill: 'url(#ambient-glow-1)',
          }),
          h('ellipse', {
            cx: 350,
            cy: 500,
            rx: 400,
            ry: 300,
            fill: 'url(#ambient-glow-1)',
          }),

          // Diffused soft bloom along PCB traces
          ...traces.map((trace) => {
            const isTraceActive = activeNodeId ? connectedTraceIds.has(trace.id) : true
            const baseColor = TRACE_COLORS[trace.colorType] ?? '#6474FF'
            return h('path', {
              key: `glow-${trace.id}`,
              d: trace.path,
              fill: 'none',
              stroke: baseColor,
              strokeWidth: (trace.width ?? 2) + 4,
              strokeOpacity: isTraceActive ? (activeNodeId ? 0.35 : 0.18) : 0.05,
              filter: 'url(#pcb-glow)',
            })
          }),

          // Glow halo for selected node (matching reference image cs30)
          selectedNodeId
            ? (() => {
                const node = nodes.find((n) => n.id === selectedNodeId)
                if (!node) return null
                return h('circle', {
                  className: 'selected-halo',
                  cx: node.x,
                  cy: node.y,
                  r: node.radius + 8,
                  fill: 'none',
                  stroke: '#D4F658',
                  strokeWidth: 2.5,
                  strokeOpacity: 0.85,
                  filter: 'url(#pcb-glow)',
                })
              })()
            : null,
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 2: TRACE LAYER (Orthogonal PCB Traces & Vias)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'trace-layer' },
          ...traces.map((trace) => {
            const isTraceActive = activeNodeId ? connectedTraceIds.has(trace.id) : true
            const baseColor = TRACE_COLORS[trace.colorType] ?? '#6474FF'
            const strokeColor = isTraceActive
              ? activeNodeId
                ? '#8598FF'
                : baseColor
              : 'rgba(60, 75, 105, 0.3)'

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
              // Via solder pads along this trace
              ...(trace.vias ?? []).map((via, vi) =>
                h(
                  'g',
                  { key: `via-${trace.id}-${vi}` },
                  h('circle', {
                    cx: via.x,
                    cy: via.y,
                    r: 4,
                    fill: '#05070D',
                    stroke: strokeColor,
                    strokeWidth: 1.5,
                  }),
                  h('circle', {
                    cx: via.x,
                    cy: via.y,
                    r: 1.6,
                    fill: strokeColor,
                  }),
                ),
              ),
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 3: PIN LAYER (Connector Pins & Solder Buses)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'pin-layer' },
          ...pins.map((pin) => {
            if (pin.type === 'bus') {
              // Vertical parallel pin bus between stacked chips (cs47 <-> cs59, cs22 <-> cs39)
              return h(
                'g',
                { key: pin.id },
                h('line', {
                  x1: pin.x,
                  y1: pin.y,
                  x2: pin.x,
                  y2: pin.y + (pin.length ?? 80),
                  stroke: '#6474FF',
                  strokeWidth: 1.8,
                }),
                // Top solder pad
                h('circle', {
                  cx: pin.x,
                  cy: pin.y + 3,
                  r: pin.padSize ?? 4,
                  fill: '#8598B2',
                  stroke: '#0A1220',
                  strokeWidth: 1,
                }),
                // Bottom solder pad
                h('circle', {
                  cx: pin.x,
                  cy: pin.y + (pin.length ?? 80) - 3,
                  r: pin.padSize ?? 4,
                  fill: '#8598B2',
                  stroke: '#0A1220',
                  strokeWidth: 1,
                }),
              )
            }

            // Radial connector pin pad
            return h(
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
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 4: NODE LAYER (IC Chips & Cloud Modules)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'node-layer' },
          ...nodes.map((node) => {
            const isSelected = node.id === selectedNodeId
            const isHovered = node.id === hoveredNodeId
            const isStalled = node.fiber?.state === 'PENDING' || node.fiber?.state === 'FAILED'

            if (node.kind === 'cloud') {
              const cloudPath = getCloudPath(
                node.x,
                node.y,
                node.width ?? 160,
                node.height ?? 75,
              )
              return h(
                'g',
                {
                  key: node.id,
                  'data-testid': `node-${node.id}`,
                  onClick: (e: ReactMouseEvent) => {
                    e.stopPropagation()
                    onSelectNode(node)
                  },
                  onMouseEnter: () => setHoveredNodeId(node.id),
                  onMouseLeave: () => setHoveredNodeId(null),
                  style: { cursor: 'pointer' },
                },
                h('path', {
                  d: cloudPath,
                  fill: '#8598B2',
                  stroke: isSelected ? '#D4F658' : '#687C99',
                  strokeWidth: isSelected ? 2.5 : 1.5,
                  filter: isHovered || isSelected ? 'url(#pcb-glow)' : undefined,
                  transition: 'stroke 0.2s',
                }),
                h(
                  'text',
                  {
                    x: node.x,
                    y: node.y + 5,
                    textAnchor: 'middle',
                    fill: '#0A1220',
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  },
                  node.code,
                ),
              )
            }

            // Circular IC Chip Node
            const fillColor = isStalled ? '#B86B7D' : '#8598B2'
            const strokeColor = isSelected
              ? '#D4F658'
              : isHovered
                ? '#E2ECFF'
                : '#AAB9D0'

            return h(
              'g',
              {
                key: node.id,
                'data-testid': `node-${node.id}`,
                onClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  onSelectNode(node)
                },
                onDoubleClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  // Center view on this node
                  if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect()
                    onPanChange({
                      x: rect.width / 2 - node.x * zoom,
                      y: rect.height / 2 - node.y * zoom,
                    })
                  }
                },
                onMouseEnter: () => setHoveredNodeId(node.id),
                onMouseLeave: () => setHoveredNodeId(null),
                style: { cursor: 'pointer' },
              },
              // Chip outer border
              h('circle', {
                cx: node.x,
                cy: node.y,
                r: node.radius,
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: isSelected ? 3 : 1.8,
                filter: isHovered ? 'url(#pcb-glow)' : undefined,
                transition: 'stroke 0.2s, stroke-width 0.2s',
              }),
              // Chip inner technical ring
              h('circle', {
                cx: node.x,
                cy: node.y,
                r: node.radius - 5,
                fill: 'none',
                stroke: 'rgba(10, 18, 32, 0.25)',
                strokeWidth: 1,
              }),
              // Centered Monospace Technical ID (e.g. cs20, cs30, cs51)
              h(
                'text',
                {
                  x: node.x,
                  y: node.y + 5,
                  textAnchor: 'middle',
                  fill: '#0A1220',
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  letterSpacing: -0.5,
                },
                node.code,
              ),
              // Secondary fiber name on hover (subtle tech overlay)
              isHovered && node.fiber
                ? h(
                    'text',
                    {
                      x: node.x,
                      y: node.y + node.radius + 18,
                      textAnchor: 'middle',
                      fill: '#8EA4CE',
                      fontSize: 11,
                      fontWeight: 500,
                      fontFamily: 'ui-monospace, monospace',
                    },
                    node.fiber.name,
                  )
                : null,
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 5: SIGNAL FLOW LAYER (Restrained Data Pulses)
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
