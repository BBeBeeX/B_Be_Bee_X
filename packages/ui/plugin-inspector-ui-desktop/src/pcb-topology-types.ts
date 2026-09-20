import type { FiberStateName } from '@BBeBee/kernel'
import type { EffectNode, FiberNode } from '@BBeBee/plugin-inspector'

export interface Point {
  x: number
  y: number
}

export interface PcbPin {
  id: string
  x: number
  y: number
  nodeId: string
  direction: 'top' | 'bottom' | 'left' | 'right'
  padSize?: number
}

export type TraceRelationType = 'service' | 'hierarchy' | 'waiting'

export interface PcbTrace {
  id: string
  path: string // SVG path string (strictly orthogonal with 90° bends and 45° chamfers)
  relationType: TraceRelationType
  serviceName?: string
  width?: number
  fromNodeId: string
  toNodeId: string
  hasSignalFlow?: boolean
  vias?: Point[]
}

export interface PcbNode {
  id: string // Unique identifier, e.g. fiber name or uid
  name: string // Concrete plugin name, e.g. 'root', 'plugin-inspector', 'plugin-player'
  displayName: string // Clean trimmed display name
  kind: 'chip' | 'root'
  x: number
  y: number
  width: number
  height: number
  rank: number
  fiber: {
    name: string
    state: FiberStateName | 'UNKNOWN'
    uid: number | null
    inject: string[]
    waitingFor: string[]
    provides: string[]
    effects: EffectNode[]
    children: FiberNode[]
  }
}

export interface PcbTopologyData {
  nodes: PcbNode[]
  traces: PcbTrace[]
  pins: PcbPin[]
}
