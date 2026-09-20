import type { FiberStateName } from '@BBeBee/kernel'
import type { EffectNode } from '@BBeBee/plugin-inspector'

export interface Point {
  x: number
  y: number
}

export interface PcbPin {
  id: string
  x: number
  y: number
  length?: number
  angle?: number
  padSize?: number
  type?: 'dot' | 'pad' | 'bus'
}

export type TraceColorType = 'primary' | 'secondary' | 'accent' | 'inactive' | 'warning'

export interface PcbTrace {
  id: string
  path: string // SVG path string (strictly orthogonal with 90° bends and 45° chamfers)
  colorType: TraceColorType
  width?: number
  fromNodeId?: string
  toNodeId?: string
  hasSignalFlow?: boolean
  vias?: Point[] // Solder via points along or at the ends of this trace
}

export interface PcbNode {
  id: string // e.g. 'cs20', 'cs30', 'level-4'
  code: string // Display code e.g. 'CS20', 'CS30', 'Level 4'
  kind: 'chip' | 'cloud'
  x: number
  y: number
  radius: number
  width?: number
  height?: number
  pins?: PcbPin[]
  // Associated Cordis Fiber data (if mapped)
  fiber?: {
    name: string
    state: FiberStateName | 'UNKNOWN'
    uid: number | null
    inject: string[]
    waitingFor: string[]
    provides: string[]
    effects: EffectNode[]
  }
}

export interface PcbTopologyData {
  nodes: PcbNode[]
  traces: PcbTrace[]
  pins: PcbPin[]
}
