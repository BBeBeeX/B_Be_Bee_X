import type { FiberNode, InspectorSnapshot } from '@BBeBee/plugin-inspector'
import type { PcbNode, PcbPin, PcbTopologyData, PcbTrace } from './pcb-topology-types.js'

/**
 * Trims long package prefixes like '@BBeBee/' for cleaner technical chip labels
 * while preserving the full name on the node and in inspection details.
 */
export function getDisplayPluginName(fullName: string): string {
  if (fullName.startsWith('@BBeBee/')) {
    return fullName.slice('@BBeBee/'.length)
  }
  return fullName
}

/**
 * Dynamically constructs the real PCB circuit topology from the Cordis fiber snapshot.
 *
 * All nodes represent concrete runtime fibers.
 * All traces represent real relationships (service dependencies and fiber hierarchy).
 */
export function buildRealPcbTopology(snap: InspectorSnapshot): PcbTopologyData {
  // 1. Flatten all fibers from snap.root
  const allFibers: { fiber: FiberNode; parent: FiberNode | null; depth: number }[] = []
  const queue: { fiber: FiberNode; parent: FiberNode | null; depth: number }[] = [
    { fiber: snap.root, parent: null, depth: 0 },
  ]

  while (queue.length > 0) {
    const item = queue.shift()!
    allFibers.push(item)
    for (const child of item.fiber.children) {
      queue.push({ fiber: child, parent: item.fiber, depth: item.depth + 1 })
    }
  }

  // 2. Build service provider map (serviceName -> providerFiber)
  const serviceToProvider = new Map<string, FiberNode>()
  for (const { fiber } of allFibers) {
    for (const svc of fiber.provides) {
      if (!serviceToProvider.has(svc)) {
        serviceToProvider.set(svc, fiber)
      }
    }
  }

  // 3. Compute topological ranks for layout
  // Rank 0: root
  // Rank 1: direct children of root or primary providers
  // Higher ranks: consumers of earlier services or deeper children
  const fiberRank = new Map<FiberNode, number>()
  fiberRank.set(snap.root, 0)

  // Iterative rank assignment based on tree depth and service dependencies
  for (let pass = 0; pass < 4; pass++) {
    for (const { fiber, parent, depth } of allFibers) {
      if (fiber === snap.root) continue
      let rank = parent ? (fiberRank.get(parent) ?? depth) + 1 : 1

      for (const req of fiber.inject) {
        const prov = serviceToProvider.get(req)
        if (prov && prov !== fiber) {
          const provRank = fiberRank.get(prov) ?? 0
          rank = Math.max(rank, provRank + 1)
        }
      }
      fiberRank.set(fiber, rank)
    }
  }

  // Group fibers by rank
  const rankGroups = new Map<number, FiberNode[]>()
  for (const { fiber } of allFibers) {
    const r = fiberRank.get(fiber) ?? 0
    const list = rankGroups.get(r) ?? []
    list.push(fiber)
    rankGroups.set(r, list)
  }

  const sortedRanks = Array.from(rankGroups.keys()).sort((a, b) => a - b)

  // 4. Calculate 2D coordinates for each real node
  const nodes: PcbNode[] = []
  const nodeById = new Map<string, PcbNode>()
  const startY = 80
  const rowHeight = 170

  // Calculate maximum row width to center all ranks nicely
  let maxRowWidth = 1000
  for (const r of sortedRanks) {
    const list = rankGroups.get(r)!
    const rowW = list.length * 200 + (list.length - 1) * 40
    if (rowW > maxRowWidth) maxRowWidth = rowW
  }

  for (const r of sortedRanks) {
    const list = rankGroups.get(r)!
    const y = startY + r * rowHeight
    const totalRowWidth = list.length * 190 + (list.length - 1) * 36
    let currentX = Math.max(60, (maxRowWidth - totalRowWidth) / 2)

    for (const f of list) {
      const displayName = getDisplayPluginName(f.name)
      const width = Math.max(160, Math.min(240, displayName.length * 9.5 + 40))
      const height = f.children.length > 0 ? 62 : 52
      const id = f.uid !== null ? `${f.name}:${f.uid}` : f.name

      const node: PcbNode = {
        id,
        name: f.name,
        displayName,
        kind: f === snap.root ? 'root' : 'chip',
        x: currentX,
        y,
        width,
        height,
        rank: r,
        fiber: {
          name: f.name,
          state: f.state,
          uid: f.uid,
          inject: f.inject,
          waitingFor: f.waitingFor,
          provides: f.provides,
          effects: f.effects,
          children: f.children,
        },
      }

      nodes.push(node)
      nodeById.set(id, node)
      currentX += width + 36
    }
  }

  // 5. Build Real Relationships & Orthogonal PCB Traces
  const traces: PcbTrace[] = []
  const pins: PcbPin[] = []
  const createdPairs = new Set<string>()

  // Helper to find PcbNode from FiberNode
  const getPcbNode = (f: FiberNode): PcbNode | undefined => {
    const id = f.uid !== null ? `${f.name}:${f.uid}` : f.name
    return nodeById.get(id)
  }

  let traceIndex = 0

  // A. Real Service Dependencies (provider.provides -> consumer.inject)
  for (const { fiber: consumer } of allFibers) {
    const consumerNode = getPcbNode(consumer)
    if (!consumerNode) continue

    for (const svc of consumer.inject) {
      const provider = serviceToProvider.get(svc)
      if (provider && provider !== consumer) {
        const providerNode = getPcbNode(provider)
        if (!providerNode) continue

        const pairKey = `${providerNode.id}->${consumerNode.id}:${svc}`
        if (createdPairs.has(pairKey)) continue
        createdPairs.add(pairKey)

        // Route orthogonal trace from provider to consumer
        const trace = routeOrthogonalTrace(
          providerNode,
          consumerNode,
          'service',
          svc,
          traceIndex++,
        )
        traces.push(trace.trace)
        pins.push(...trace.pins)
      }
    }
  }

  // B. Real Structural Hierarchy (parent -> child)
  for (const { fiber, parent } of allFibers) {
    if (!parent) continue
    const parentNode = getPcbNode(parent)
    const childNode = getPcbNode(fiber)
    if (!parentNode || !childNode) continue

    // If no service dependency already connects parent -> child, add hierarchy trace
    const hierarchyKey = `${parentNode.id}->${childNode.id}`
    const hasServiceLink = Array.from(createdPairs).some((k) => k.startsWith(hierarchyKey))

    if (!hasServiceLink && !createdPairs.has(hierarchyKey)) {
      createdPairs.add(hierarchyKey)
      const trace = routeOrthogonalTrace(
        parentNode,
        childNode,
        'hierarchy',
        undefined,
        traceIndex++,
      )
      traces.push(trace.trace)
      pins.push(...trace.pins)
    }
  }

  return { nodes, traces, pins }
}

/**
 * Computes strictly orthogonal PCB trace paths (horizontal & vertical with 90° bends and 45° chamfers)
 * connecting two actual nodes.
 */
function routeOrthogonalTrace(
  fromNode: PcbNode,
  toNode: PcbNode,
  relationType: 'service' | 'hierarchy',
  serviceName: string | undefined,
  index: number,
): { trace: PcbTrace; pins: PcbPin[] } {
  const isDownstream = toNode.rank > fromNode.rank
  const isSameRank = toNode.rank === fromNode.rank

  // Calculate start pin (fromNode) and end pin (toNode)
  let startX: number
  let startY: number
  let endX: number
  let endY: number
  let startDir: PcbPin['direction']
  let endDir: PcbPin['direction']

  // Multi-lane pin distribution along node borders
  const laneOffset = ((index % 5) - 2) * 12

  if (isDownstream) {
    startX = fromNode.x + fromNode.width / 2 + laneOffset
    startY = fromNode.y + fromNode.height
    startDir = 'bottom'

    endX = toNode.x + toNode.width / 2 + laneOffset
    endY = toNode.y
    endDir = 'top'
  } else if (isSameRank) {
    if (toNode.x > fromNode.x) {
      startX = fromNode.x + fromNode.width
      startY = fromNode.y + fromNode.height / 2 + laneOffset
      startDir = 'right'

      endX = toNode.x
      endY = toNode.y + toNode.height / 2 + laneOffset
      endDir = 'left'
    } else {
      startX = fromNode.x
      startY = fromNode.y + fromNode.height / 2 + laneOffset
      startDir = 'left'

      endX = toNode.x + toNode.width
      endY = toNode.y + toNode.height / 2 + laneOffset
      endDir = 'right'
    }
  } else {
    // Upstream feedback route
    startX = fromNode.x + fromNode.width / 2 + laneOffset
    startY = fromNode.y
    startDir = 'top'

    endX = toNode.x + toNode.width / 2 + laneOffset
    endY = toNode.y + toNode.height
    endDir = 'bottom'
  }

  let pathStr: string
  const vias: { x: number; y: number }[] = []

  if (isDownstream) {
    // Intermediate horizontal bus track between the two rows
    const channelY = fromNode.y + fromNode.height + 24 + (index % 6) * 14
    const dx = endX - startX

    if (Math.abs(dx) < 8) {
      // Direct vertical trace
      pathStr = `M ${startX} ${startY} L ${endX} ${endY}`
    } else {
      // Orthogonal trace with 45° chamfers
      const sign = dx > 0 ? 1 : -1
      pathStr = [
        `M ${startX} ${startY}`,
        `L ${startX} ${channelY - 6}`,
        `L ${startX + sign * 6} ${channelY}`,
        `L ${endX - sign * 6} ${channelY}`,
        `L ${endX} ${channelY + 6}`,
        `L ${endX} ${endY}`,
      ].join(' ')

      vias.push({ x: startX, y: channelY })
      vias.push({ x: endX, y: channelY })
    }
  } else if (isSameRank) {
    const channelY = fromNode.y + fromNode.height + 18 + (index % 4) * 12
    pathStr = [
      `M ${startX} ${startY}`,
      `L ${startX} ${channelY}`,
      `L ${endX} ${channelY}`,
      `L ${endX} ${endY}`,
    ].join(' ')
    vias.push({ x: startX, y: channelY })
    vias.push({ x: endX, y: channelY })
  } else {
    // Upstream route around the outside
    const sideX = Math.max(fromNode.x + fromNode.width, toNode.x + toNode.width) + 30 + (index % 4) * 14
    pathStr = [
      `M ${startX} ${startY}`,
      `L ${startX} ${fromNode.y - 14}`,
      `L ${sideX} ${fromNode.y - 14}`,
      `L ${sideX} ${toNode.y + toNode.height + 14}`,
      `L ${endX} ${toNode.y + toNode.height + 14}`,
      `L ${endX} ${endY}`,
    ].join(' ')
    vias.push({ x: sideX, y: fromNode.y - 14 })
    vias.push({ x: sideX, y: toNode.y + toNode.height + 14 })
  }

  const pins: PcbPin[] = [
    {
      id: `pin-start-${fromNode.id}-${index}`,
      x: startX,
      y: startY,
      nodeId: fromNode.id,
      direction: startDir,
      padSize: 3.5,
    },
    {
      id: `pin-end-${toNode.id}-${index}`,
      x: endX,
      y: endY,
      nodeId: toNode.id,
      direction: endDir,
      padSize: 3.5,
    },
  ]

  const trace: PcbTrace = {
    id: `tr-${fromNode.id}-${toNode.id}-${index}`,
    path: pathStr,
    relationType,
    serviceName,
    width: relationType === 'service' ? 2 : 1.6,
    fromNodeId: fromNode.id,
    toNodeId: toNode.id,
    hasSignalFlow: relationType === 'service',
    vias,
  }

  return { trace, pins }
}
