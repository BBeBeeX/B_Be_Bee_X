/** Transport and queue types. See docs/05-audio-playback.md §2. */

export type RepeatMode = 'off' | 'all' | 'one'

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  /** Buffer underrun. Distinct from `paused`: the UI shows a spinner. */
  | 'stalled'
  | 'error'

export interface QueueSourceContext {
  kind: 'album' | 'playlist' | 'artist' | 'search' | 'radio'
  urn?: string
  label?: string
}

export interface QueueItem {
  id: string
  trackUrn: string
  /** Where this came from. Drives the "playing from …" line. */
  sourceContext?: QueueSourceContext
  addedBy: 'user' | 'autoplay' | 'radio'
  addedAt?: number
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
  error?: { code: string; message: string; retryable: boolean }
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
