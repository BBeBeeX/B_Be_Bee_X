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

/**
 * The kinds a user can save. `genre` is a catalogue facet, not something a
 * shelf holds, so it is deliberately absent rather than merely unhandled.
 */
export type SavedKind = 'track' | 'album' | 'artist' | 'playlist'

/**
 * A user-made collection — a folder of arbitrary URNs, nestable.
 *
 * Distinct from a playlist on purpose: order is a fractional index and an item
 * is any entity, because a collection is a shelf, while `playlist_items` is an
 * ordered list of tracks. See docs/07 §4.6.
 */
export interface Collection {
  id: string
  name: string
  parentId?: string
  /** Fractional index among siblings. */
  position: string
  createdAt: number
  /** Members, counted on read. */
  itemCount?: number
}

/** One membership row. The URN may name any entity kind. */
export interface CollectionItem {
  urn: string
  position: string
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
