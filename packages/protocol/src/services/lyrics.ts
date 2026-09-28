/**
 * `ctx.lyrics` — lyric retrieval, synchronization and state.
 *
 * Coordinates lyric documents from sources, local files, and cache,
 * driving both the full-page lyrics panel and desktop floating lyrics.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Lyrics } from '../entities/library.js'

export type LyricsStatus =
  | 'idle'
  | 'loading-song'
  | 'loading-lyrics'
  | 'ready'
  | 'no-lyrics'
  | 'error'

export interface LyricsState {
  status: LyricsStatus
  trackUrn?: string
  lyrics?: Lyrics
  error?: string
  offsetMs: number
  /** Whether the current audio source supports third-party lyric sources. */
  supportsLyricSource?: boolean
  /** Source where the current lyrics were resolved from. */
  sourceType?: 'lyric-source' | 'audio-provider' | 'cache'
}

export interface LyricsService {
  readonly state: Readonly<LyricsState>
  getLyricsForTrack(urn: string): Promise<Lyrics | undefined>
  setOffset(offsetMs: number): void
  retry(): Promise<void>
  /** Clear cached lyrics (memory and SQLite). If trackUrn is omitted, clears all cached lyrics. */
  clearCache(trackUrn?: string): Promise<void>
}

export interface DesktopLyricsPosition {
  x: number
  y: number
}

export interface DesktopLyricsState {
  visible: boolean
  fontSize: number
  opacity: number
  position: DesktopLyricsPosition
  showNextLine: boolean
  locked: boolean
  [key: string]: unknown
}

export interface DesktopLyricsService {
  readonly state: Readonly<DesktopLyricsState>
  setState(partial: Partial<DesktopLyricsState>): void
  toggleVisible(): void
  setVisible(visible: boolean): void
  setShowNextLine(show: boolean): void
  setFontSize(size: number): void
  setOpacity(opacity: number): void
  setPosition(position: DesktopLyricsPosition): void
  setLocked(locked: boolean): void
}

declare module 'cordis' {
  interface Context {
    lyrics: LyricsService
    desktopLyrics: DesktopLyricsService
  }
}


