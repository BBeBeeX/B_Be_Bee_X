/** Library, smart playlists, and lyrics. See docs/07-data-model.md §4.6. */

import type { UrnKind } from '../urn.js'

export interface LibraryEntry {
  urn: string
  kind: UrnKind
  sourceId: string
  addedAt: number
  pinned?: boolean
  sortKey?: string
}

export type SmartField =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'year'
  | 'bpm'
  | 'durationMs'
  | 'playCount'
  | 'skipCount'
  | 'lastPlayedAt'
  | 'addedAt'
  | 'rating'
  | 'loved'
  | 'hasBinding'
  | 'sourceId'
  | 'quality'

export type SmartComparator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'contains'
  | 'startsWith'
  | 'inLast'

export type SmartRule =
  | { op: 'and' | 'or'; rules: SmartRule[] }
  | { op: 'not'; rule: SmartRule }
  | { field: SmartField; cmp: SmartComparator; value: string | number | boolean }

export interface SmartPlaylist {
  rules: SmartRule
  limit?: number
  orderBy?: SmartField
  desc?: boolean
}

export type LyricsFormat = 'lrc' | 'ttml' | 'plain'

export interface Lyrics {
  format: LyricsFormat
  content: string
  synced: boolean
  /** User-adjustable timing nudge, ms. */
  offsetMs?: number
  language?: string
}

export interface TrackStats {
  urn: string
  playCount: number
  skipCount: number
  lastPlayedAt?: number
  /** 0..5, or undefined when unrated. */
  rating?: number
  loved: boolean
}
