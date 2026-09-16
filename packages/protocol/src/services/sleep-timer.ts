/**
 * `ctx.sleepTimer` — stops playback after a duration, at a specific time,
 * or when the current track finishes.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'

export type SleepTimerMode = 'duration' | 'end-of-track' | 'epoch'

export interface SleepTimerState {
  active: boolean
  mode?: SleepTimerMode
  /** Target timestamp in epoch milliseconds (for duration / epoch modes). */
  targetEpochMs?: number
  /** The configured duration in milliseconds (for duration mode). */
  durationMs?: number
}

export interface SleepTimerService {
  readonly state: SleepTimerState

  /** Stop playback after the given duration in milliseconds. */
  startDuration(ms: number): void

  /** Stop playback at the specified epoch timestamp. */
  startAtEpoch(epochMs: number): void

  /** Stop playback when the current track finishes playing. */
  startEndOfTrack(): void

  /** Cancel any active sleep timer. */
  cancel(): void
}

declare module 'cordis' {
  interface Context {
    sleepTimer: SleepTimerService
  }
}
