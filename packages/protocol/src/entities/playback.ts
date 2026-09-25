/** Transport and queue types. See docs/05-audio-playback.md §2. */

export type RepeatMode = 'off' | 'all' | 'one'

export type PlayMode = 'shuffle' | 'sequence' | 'single-loop' | 'list-loop'

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  /** Buffer underrun. Distinct from `paused`: the UI shows a spinner. */
  | 'stalled'
  | 'error'

export interface QueueSourceContext {
  kind: 'album' | 'playlist' | 'artist' | 'search' | 'radio' | 'local' | 'favorites'
  urn?: string
  label?: string
}

import type { ArtworkRef } from './catalog.js'

export interface QueueItem {
  id: string
  trackUrn: string
  /** Where this came from. Drives the "playing from …" line. */
  sourceContext?: QueueSourceContext
  addedBy: 'user' | 'autoplay' | 'radio'
  addedAt?: number
}

export interface NowPlayingMeta {
  title: string
  artist?: string
  album?: string
  artwork?: ArtworkRef
  artworkUri?: string
}

export interface TransportState {
  status: PlaybackStatus
  currentItemId?: string
  trackUrn?: string
  positionMs: number
  durationMs: number
  bufferedMs: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  playMode: PlayMode
  error?: { code: string; message: string; retryable: boolean }
  nowPlaying?: NowPlayingMeta
}

/** One completed (or abandoned) listen. Appended to `play_history`. */
export interface PlayRecord {
  id: string
  trackUrn: string
  startedAt: number
  endedAt?: number
  msPlayed: number
  completed: boolean
  skipped: boolean
  source?: QueueSourceContext
  deviceId?: string
}

/** Summary statistics for playback history. */
export interface PlayHistoryStats {
  totalPlays: number
  totalMsPlayed: number
  todayPlays: number
  completedPlays: number
}

/** Aggregated play count and duration for one day in the contribution heatmap. */
export interface PlayHistoryHeatmapDay {
  date: string
  count: number
  msPlayed: number
}

