/** Catalogue entities. See docs/07-data-model.md §4.3. */

export interface ArtworkRef {
  id: string
  sourceUrl?: string
  /** Instant placeholder, computed once at cache time rather than per render. */
  blurhash?: string
  /** '#RRGGBB'. Drives adaptive player theming. */
  dominantColor?: string
  width?: number
  height?: number
}

export type ArtistRole = 'main' | 'featured' | 'composer' | 'remixer' | 'conductor'

export interface ArtistCredit {
  urn: string
  name: string
  role: ArtistRole
  ordinal: number
}

export interface Artist {
  urn: string
  name: string
  sortName?: string
  artwork?: ArtworkRef
}

export interface ArtistDetail extends Artist {
  bio?: string
  albums: Album[]
  topTracks?: Track[]
}

export type AlbumType = 'album' | 'single' | 'ep' | 'compilation' | 'live' | 'soundtrack'

export interface Album {
  urn: string
  title: string
  sortTitle?: string
  artists: ArtistCredit[]
  albumType?: AlbumType
  /** ISO-8601, possibly partial: '1997', '1997-04', '1997-04-22'. */
  releaseDate?: string
  year?: number
  trackCount?: number
  discCount?: number
  artwork?: ArtworkRef
  isVarious?: boolean
}

export interface AlbumDetail extends Album {
  tracks: Track[]
}

export interface Track {
  urn: string
  title: string
  sortTitle?: string
  artists: ArtistCredit[]
  albumUrn?: string
  albumTitle?: string
  trackNo?: number
  discNo?: number
  durationMs?: number
  year?: number
  genres?: string[]
  explicit?: boolean
  bpm?: number
  /** dB adjustments from the source's tags, applied by the `normalize` effect. */
  replayGainTrack?: number
  replayGainAlbum?: number
  peakTrack?: number
  /** Cleared on NotFoundError; greys the row out rather than hiding it. */
  available?: boolean
  artwork?: ArtworkRef
  externalIds?: ExternalIds
}

/** Identifiers that let the same recording be recognised across providers. */
export interface ExternalIds {
  isrc?: string
  mbid?: string
  upc?: string
  acoustid?: string
  discogs?: string
}

export interface Playlist {
  urn: string
  name: string
  description?: string
  artwork?: ArtworkRef
  owner?: string
  isPublic?: boolean
  trackCount?: number
  durationMs?: number
}

export interface PlaylistItem {
  id: string
  trackUrn: string
  /** Fractional index (LexoRank-style), so a reorder writes exactly one row. */
  position: string
  addedAt?: number
  addedBy?: string
  note?: string
}

export interface PlaylistDetail extends Playlist {
  items: PlaylistItem[]
  cursor?: string
  hasMore: boolean
}

export interface Genre {
  id: string
  name: string
}
