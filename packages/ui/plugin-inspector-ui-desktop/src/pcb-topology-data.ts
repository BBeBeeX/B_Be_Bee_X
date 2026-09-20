import type { FiberNode, InspectorSnapshot } from '@BBeBee/plugin-inspector'
import type { PcbNode, PcbPin, PcbTrace } from './pcb-topology-types.js'

/**
 * Static baseline geometry matching the reference image topology.
 */
export const BASE_NODES: Omit<PcbNode, 'fiber'>[] = [
  // Top clouds
  {
    id: 'level-4',
    code: 'Level 4',
    kind: 'cloud',
    x: 920,
    y: 105,
    radius: 70,
    width: 170,
    height: 75,
  },
  {
    id: 'level-5',
    code: 'Level 5',
    kind: 'cloud',
    x: 1100,
    y: 115,
    radius: 70,
    width: 160,
    height: 75,
  },

  // Core IC
  { id: 'cs20', code: 'cs20', kind: 'chip', x: 970, y: 270, radius: 64 },

  // Tier 2 ICs
  { id: 'cs30', code: 'cs30', kind: 'chip', x: 920, y: 535, radius: 64 },
  { id: 'cs51', code: 'cs51', kind: 'chip', x: 1070, y: 535, radius: 64 },
  { id: 'cs46', code: 'cs46', kind: 'chip', x: 1220, y: 535, radius: 64 },
  { id: 'cs52', code: 'cs52', kind: 'chip', x: 1370, y: 535, radius: 64 },

  // Tier 3 ICs
  { id: 'cs76', code: 'cs76', kind: 'chip', x: 80, y: 785, radius: 60 },
  { id: 'cs50', code: 'cs50', kind: 'chip', x: 225, y: 785, radius: 60 },
  { id: 'cs23', code: 'cs23', kind: 'chip', x: 370, y: 785, radius: 60 },
  { id: 'ded-1', code: 'ded/1', kind: 'chip', x: 515, y: 785, radius: 60 },
  { id: 'cs47', code: 'cs47', kind: 'chip', x: 660, y: 785, radius: 60 },
  { id: 'cs36', code: 'cs36', kind: 'chip', x: 805, y: 785, radius: 60 },
  { id: 'cs49', code: 'cs49', kind: 'chip', x: 950, y: 785, radius: 60 },
  { id: 'cs22', code: 'cs22', kind: 'chip', x: 1095, y: 785, radius: 60 },
  { id: 'cs71', code: 'cs71', kind: 'chip', x: 1240, y: 785, radius: 60 },
  { id: 'cs29', code: 'cs29', kind: 'chip', x: 1385, y: 785, radius: 60 },
  { id: 'cs33', code: 'cs33', kind: 'chip', x: 1530, y: 785, radius: 60 },

  // Tier 4 ICs (below cs47, cs22, cs33)
  { id: 'cs59', code: 'cs59', kind: 'chip', x: 660, y: 985, radius: 60 },
  { id: 'cs39', code: 'cs39', kind: 'chip', x: 1095, y: 985, radius: 60 },
  { id: 'cs33-b', code: 'cs33', kind: 'chip', x: 1530, y: 985, radius: 60 },
]

/**
 * Generate orthogonal PCB traces with 90° bends and 45° chamfers matching the reference image.
 */
export function generateBaseTraces(): PcbTrace[] {
  const traces: PcbTrace[] = []

  // Top cloud down-traces into cs20
  traces.push({
    id: 'tr-l4-cs20-1',
    fromNodeId: 'level-4',
    toNodeId: 'cs20',
    colorType: 'secondary',
    width: 2,
    path: 'M 880 142 L 880 200 L 935 218',
    vias: [{ x: 880, y: 142 }, { x: 935, y: 218 }],
  })
  traces.push({
    id: 'tr-l4-cs20-2',
    fromNodeId: 'level-4',
    toNodeId: 'cs20',
    colorType: 'primary',
    width: 2,
    path: 'M 960 142 L 960 206',
    vias: [{ x: 960, y: 142 }, { x: 960, y: 206 }],
  })
  traces.push({
    id: 'tr-l5-cs20-1',
    fromNodeId: 'level-5',
    toNodeId: 'cs20',
    colorType: 'primary',
    width: 2,
    path: 'M 1060 152 L 1005 210',
    vias: [{ x: 1060, y: 152 }, { x: 1005, y: 210 }],
  })
  traces.push({
    id: 'tr-l5-cs20-2',
    fromNodeId: 'level-5',
    toNodeId: 'cs20',
    colorType: 'secondary',
    width: 2,
    path: 'M 1120 152 L 1120 185 L 1035 224',
    vias: [{ x: 1120, y: 152 }, { x: 1035, y: 224 }],
  })

  // Left horizontal bus from cs20 to cs76, cs50, cs23, ded-1, cs47
  // Notice in reference image: dense parallel tracks going leftward, branching with 90° / 45° bends
  traces.push({
    id: 'tr-cs20-cs76',
    fromNodeId: 'cs20',
    toNodeId: 'cs76',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 915 295 L 865 345 L 80 345 L 80 725',
    vias: [{ x: 80, y: 345 }],
  })

  traces.push({
    id: 'tr-cs20-cs50',
    fromNodeId: 'cs20',
    toNodeId: 'cs50',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 922 305 L 872 370 L 225 370 L 225 725',
    vias: [{ x: 225, y: 370 }],
  })

  traces.push({
    id: 'tr-cs20-cs23',
    fromNodeId: 'cs20',
    toNodeId: 'cs23',
    colorType: 'secondary',
    width: 2,
    path: 'M 930 315 L 880 395 L 370 395 L 370 725',
    vias: [{ x: 370, y: 395 }],
  })

  traces.push({
    id: 'tr-cs20-ded1',
    fromNodeId: 'cs20',
    toNodeId: 'ded-1',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 938 325 L 888 420 L 515 420 L 515 725',
    vias: [{ x: 515, y: 420 }],
  })

  traces.push({
    id: 'tr-cs20-cs47',
    fromNodeId: 'cs20',
    toNodeId: 'cs47',
    colorType: 'secondary',
    width: 2,
    path: 'M 946 332 L 896 445 L 660 445 L 660 725',
    vias: [{ x: 660, y: 445 }],
  })

  // Open-ended PCB test tracks on the far left (as seen in reference image)
  traces.push({
    id: 'tr-bus-open-1',
    colorType: 'secondary',
    width: 2,
    path: 'M 910 280 L 850 320 L -30 320',
    vias: [{ x: 40, y: 320 }, { x: 190, y: 320 }],
  })
  traces.push({
    id: 'tr-bus-open-2',
    colorType: 'primary',
    width: 2,
    path: 'M -30 295 L 140 295 L 170 295',
    vias: [{ x: 170, y: 295 }],
  })
  traces.push({
    id: 'tr-bus-open-3',
    colorType: 'primary',
    width: 1.8,
    path: 'M 900 340 L 400 340 L 370 470 L 370 510',
    vias: [{ x: 370, y: 510 }],
  })

  // Vertical parallel bus connecting cs20 and cs30
  traces.push({
    id: 'tr-cs20-cs30-1',
    fromNodeId: 'cs20',
    toNodeId: 'cs30',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 950 334 L 900 471',
  })
  traces.push({
    id: 'tr-cs20-cs30-2',
    fromNodeId: 'cs20',
    toNodeId: 'cs30',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 965 334 L 915 471',
  })
  traces.push({
    id: 'tr-cs20-cs30-3',
    fromNodeId: 'cs20',
    toNodeId: 'cs30',
    colorType: 'secondary',
    width: 2,
    path: 'M 980 334 L 935 471',
  })
  traces.push({
    id: 'tr-cs20-cs30-4',
    fromNodeId: 'cs20',
    toNodeId: 'cs30',
    colorType: 'primary',
    width: 2,
    path: 'M 995 334 L 950 471',
  })

  // Traces from cs20 to cs51, cs46, cs52 (upper right quadrant)
  traces.push({
    id: 'tr-cs20-cs51',
    fromNodeId: 'cs20',
    toNodeId: 'cs51',
    colorType: 'secondary',
    width: 2,
    path: 'M 1015 328 L 1050 365 L 1070 365 L 1070 471',
    vias: [{ x: 1070, y: 365 }],
  })
  traces.push({
    id: 'tr-cs20-cs46',
    fromNodeId: 'cs20',
    toNodeId: 'cs46',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 1025 320 L 1080 375 L 1220 375 L 1220 471',
    vias: [{ x: 1220, y: 375 }],
  })
  traces.push({
    id: 'tr-cs20-cs52',
    fromNodeId: 'cs20',
    toNodeId: 'cs52',
    colorType: 'primary',
    width: 2,
    path: 'M 1032 310 L 1100 395 L 1370 395 L 1370 471',
    vias: [{ x: 1370, y: 395 }],
  })

  // Coral/Red special trace running across the right side (seen distinctly in reference image)
  traces.push({
    id: 'tr-accent-coral',
    fromNodeId: 'cs20',
    toNodeId: 'cs33',
    colorType: 'accent',
    width: 2.2,
    path: 'M 1034 290 L 1070 330 L 1510 330 L 1510 850',
    vias: [{ x: 1510, y: 330 }, { x: 1510, y: 850 }],
  })

  // Traces from cs30 radiating downwards into lower row
  traces.push({
    id: 'tr-cs30-cs36',
    fromNodeId: 'cs30',
    toNodeId: 'cs36',
    colorType: 'secondary',
    width: 2,
    path: 'M 885 580 L 835 635 L 805 635 L 805 725',
  })
  traces.push({
    id: 'tr-cs30-cs49',
    fromNodeId: 'cs30',
    toNodeId: 'cs49',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 930 599 L 950 645 L 950 725',
  })
  traces.push({
    id: 'tr-cs30-cs22',
    fromNodeId: 'cs30',
    toNodeId: 'cs22',
    colorType: 'primary',
    hasSignalFlow: true,
    width: 2,
    path: 'M 950 595 L 990 640 L 1095 640 L 1095 725',
  })
  traces.push({
    id: 'tr-cs30-cs71',
    fromNodeId: 'cs30',
    toNodeId: 'cs71',
    colorType: 'secondary',
    width: 2,
    path: 'M 965 585 L 1010 655 L 1240 655 L 1240 725',
  })
  traces.push({
    id: 'tr-cs30-cs29',
    fromNodeId: 'cs30',
    toNodeId: 'cs29',
    colorType: 'primary',
    width: 2,
    path: 'M 975 575 L 1030 670 L 1385 670 L 1385 725',
  })

  // Inter-chip horizontal traces on lower tier (connecting buses)
  traces.push({
    id: 'tr-lower-bus-1',
    colorType: 'secondary',
    width: 1.8,
    path: 'M 225 640 L 660 640 L 740 640 L 740 725',
    vias: [{ x: 310, y: 640 }, { x: 440, y: 640 }],
  })
  traces.push({
    id: 'tr-lower-bus-2',
    colorType: 'primary',
    width: 1.8,
    path: 'M 1095 670 L 1650 670',
    vias: [{ x: 1460, y: 670 }],
  })

  return traces
}

/**
 * Generate solder pin stubs and vertical pin buses (like cs47 <-> cs59, cs22 <-> cs39).
 */
export function generateBasePins(): PcbPin[] {
  const pins: PcbPin[] = []

  // Vertical 5-pin bus between cs47 (y: 785, r: 60 -> bottom 845) and cs59 (y: 985, r: 60 -> top 925)
  // Matching the reference image: 5 vertical lines with round solder dots ● at ends
  const busX1 = [644, 652, 660, 668, 676]
  busX1.forEach((x, i) => {
    pins.push({
      id: `pin-bus-cs47-cs59-${i}`,
      x,
      y: 845,
      length: 80,
      type: 'bus',
      padSize: 4.5,
    })
  })

  // Vertical 5-pin bus between cs22 (y: 785, bottom 845) and cs39 (y: 985, top 925)
  const busX2 = [1079, 1087, 1095, 1103, 1111]
  busX2.forEach((x, i) => {
    pins.push({
      id: `pin-bus-cs22-cs39-${i}`,
      x,
      y: 845,
      length: 80,
      type: 'bus',
      padSize: 4.5,
    })
  })

  // Vertical 5-pin bus between cs33 and cs33-b
  const busX3 = [1514, 1522, 1530, 1538, 1546]
  busX3.forEach((x, i) => {
    pins.push({
      id: `pin-bus-cs33-cs33b-${i}`,
      x,
      y: 845,
      length: 80,
      type: 'bus',
      padSize: 4.5,
    })
  })

  // Radial connector pins around key IC chips (cs20, cs30, cs51, cs46, cs52)
  const keyNodes = [
    { id: 'cs20', x: 970, y: 270, r: 64 },
    { id: 'cs30', x: 920, y: 535, r: 64 },
    { id: 'cs51', x: 1070, y: 535, r: 64 },
    { id: 'cs46', x: 1220, y: 535, r: 64 },
    { id: 'cs52', x: 1370, y: 535, r: 64 },
  ]

  for (const node of keyNodes) {
    // Generate 6-8 pin pads around node perimeter
    for (let a = 0; a < 8; a++) {
      const angle = (a * Math.PI) / 4
      const px = node.x + Math.cos(angle) * (node.r + 8)
      const py = node.y + Math.sin(angle) * (node.r + 8)
      pins.push({
        id: `pin-${node.id}-${a}`,
        x: px,
        y: py,
        length: 8,
        angle,
        type: 'pad',
        padSize: 3.5,
      })
    }
  }

  return pins
}

/**
 * Maps the live Cordis Inspector snapshot to the topology nodes.
 */
export function mapSnapshotToTopology(
  snap: InspectorSnapshot,
  baseNodes: Omit<PcbNode, 'fiber'>[],
): PcbNode[] {
  // Collect all fibers from tree
  const fiberList: FiberNode[] = []
  const queue: FiberNode[] = [snap.root]
  while (queue.length > 0) {
    const f = queue.shift()!
    fiberList.push(f)
    for (const child of f.children) {
      queue.push(child)
    }
  }

  // Find stalled fibers (like 'plugin-stuck' in test cases)
  const stalledNames = new Set(snap.stalled.map((s) => s.name))

  // Mapping strategy:
  // cs20 -> root fiber
  // cs30 -> first child (often plugin-inspector)
  // cs51 -> plugin-ui or second fiber
  // cs52 / cs23 -> stalled fiber if any (so PENDING state & waitingFor is immediately visible)
  const remainingFibers = [...fiberList]
  const rootIndex = remainingFibers.findIndex((f) => f.name === 'root')
  const rootFiber = rootIndex >= 0 ? remainingFibers.splice(rootIndex, 1)[0] : fiberList[0]

  const stalledIndex = remainingFibers.findIndex((f) => stalledNames.has(f.name))
  const stalledFiber = stalledIndex >= 0 ? remainingFibers.splice(stalledIndex, 1)[0] : undefined

  return baseNodes.map((base) => {
    let assignedFiber: FiberNode | undefined

    if (base.id === 'cs20') {
      assignedFiber = rootFiber
    } else if (stalledFiber && (base.id === 'cs52' || base.id === 'cs23')) {
      assignedFiber = stalledFiber
    } else if (base.id === 'level-4') {
      assignedFiber = {
        name: 'Layer 4: Feature Domain',
        uid: 400,
        state: 'ACTIVE',
        inject: ['audio', 'db', 'store'],
        waitingFor: [],
        provides: ['player', 'sources', 'library'],
        effects: [],
        children: [],
      }
    } else if (base.id === 'level-5') {
      assignedFiber = {
        name: 'Layer 5: UI & Presentation',
        uid: 500,
        state: 'ACTIVE',
        inject: ['ui', 'player', 'library'],
        waitingFor: [],
        provides: ['views', 'screens'],
        effects: [],
        children: [],
      }
    } else {
      assignedFiber = remainingFibers.shift()
    }

    const node: PcbNode = {
      ...base,
      fiber: assignedFiber
        ? {
            name: assignedFiber.name,
            state: assignedFiber.state,
            uid: assignedFiber.uid,
            inject: assignedFiber.inject,
            waitingFor: assignedFiber.waitingFor,
            provides: assignedFiber.provides,
            effects: assignedFiber.effects,
          }
        : {
            name: `${base.code}.bus`,
            state: 'ACTIVE',
            uid: null,
            inject: [],
            waitingFor: [],
            provides: [],
            effects: [],
          },
    }

    return node
  })
}
