/**
 * `ctx.miniPlayer` — headless service and types for the independent floating mini player / Dynamic Island.
 */

import type {} from 'cordis'
import type { PlaybackStatus } from '../entities/playback.js'

export type MiniPlayerDisplayMode = 'normal' | 'attached' | 'expanded'

export type MiniPlayerWindowState =
  | 'normal'
  | 'dragging'
  | 'near-top'
  | 'attached'
  | 'expanded'
  | 'hidden'

export interface MiniPlayerData {
  trackUrn?: string
  title?: string
  artist?: string
  album?: string
  artworkUri?: string
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  canPlayOrPause: boolean
  canPrevious: boolean
  canNext: boolean
  volume: number
  muted: boolean
}

export type MiniPlayerAction =
  | { type: 'togglePlay' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'restoreMain' }
  | { type: 'close' }
  | { type: 'setMode'; mode: MiniPlayerDisplayMode }

export interface MiniPlayerServiceState {
  visible: boolean
  mode: MiniPlayerDisplayMode
  windowState: MiniPlayerWindowState
}

export interface MiniPlayerService {
  /** Whether the current platform supports the mini player window. */
  readonly isSupported: boolean

  /** Current state of the mini player. */
  readonly state: Readonly<MiniPlayerServiceState>

  /** Open the mini player window, optionally specifying initial mode. */
  open(options?: { mode?: MiniPlayerDisplayMode }): Promise<void>

  /** Close the mini player window. */
  close(): Promise<void>

  /** Toggle mini player visibility. */
  toggle(): Promise<void>

  /** Change display mode between floating and Dynamic Island. */
  setMode(mode: MiniPlayerDisplayMode): Promise<void>

  /** Restore and focus the main player window. */
  restoreMain(): Promise<void>
}

declare module 'cordis' {
  interface Context {
    miniPlayer: MiniPlayerService
  }
}
