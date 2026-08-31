/**
 * `ctx.sources` and the `MediaProvider` SPI — the most extension-critical
 * contract in the system. See docs/06-music-sources.md.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable, Paged, Uri } from '../common.js'
import type { SourceError } from '../errors.js'
import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  ArtworkRef,
  Playlist,
  PlaylistDetail,
  Track,
} from '../entities/catalog.js'
import type { Lyrics } from '../entities/library.js'
import type { StreamHandle, StreamPrefs, StreamQuality } from '../entities/media.js'

/* ── Capabilities ───────────────────────────────────────────────────────── */

/**
 * What a provider can actually do.
 *
 * Providers are unequal, and the UI must know how. Every optional member of
 * `MediaProvider` is gated by a flag here, so the shells hide affordances
 * rather than offering buttons that fail.
 */
export interface Capabilities {
  search: {
    tracks: boolean
    albums: boolean
    artists: boolean
    playlists: boolean
    fullText: boolean
  }
  browse: boolean
  lyrics: boolean
  artwork: boolean
  library: {
    read: boolean
    save: boolean
    playlistWrite: boolean
    playlistReorder: boolean
  }
  streaming: {
    /** Tiers this provider can serve, best first. */
    qualities: StreamQuality[]
    transcoding: boolean
    /** Byte-range requests — required for seeking within a stream. */
    seekable: boolean
    /** Whether resolved URLs expire and must be re-resolved. */
    urlExpiry: boolean
  }
  rateLimit?: { requests: number; windowMs: number }
  /** Region-locked; some catalogue may be unavailable. */
  regional: boolean
}

/* ── Queries ────────────────────────────────────────────────────────────── */

export interface PageRequest {
  cursor?: string
  limit?: number
}

export interface SearchQuery {
  text: string
  types?: ('track' | 'album' | 'artist' | 'playlist')[]
  filters?: {
    genre?: string
    yearFrom?: number
    yearTo?: number
    durationMaxMs?: number
  }
}

export interface SearchResult {
  tracks?: Paged<Track>
  albums?: Paged<Album>
  artists?: Paged<Artist>
  playlists?: Paged<Playlist>
}

export interface BrowseEntry {
  /** Pass back as `nodeId` to descend. */
  id: string
  title: string
  subtitle?: string
  artwork?: ArtworkRef
  kind: 'folder' | 'album' | 'artist' | 'playlist' | 'track' | 'genre'
  /** Present for leaves; absent means "call browse(id) to descend". */
  urn?: string
}

/* ── Authentication ─────────────────────────────────────────────────────── */

export interface AuthField {
  id: string
  label: string
  secret?: boolean
  placeholder?: string
}

export type AuthFlow =
  | { kind: 'none' }
  | { kind: 'password'; fields: AuthField[] }
  | { kind: 'token'; label: string; helpUrl?: string }
  | {
      kind: 'oauth-pkce'
      authorizeUrl: string
      tokenUrl: string
      clientId: string
      scopes: string[]
      redirectUri: string
    }
  | { kind: 'qrcode'; poll: () => Promise<{ status: 'pending' | 'confirmed' | 'expired' }> }
  | { kind: 'cookie'; loginUrl: string; requiredCookies: string[] }

export type AuthStatus =
  | { state: 'anonymous' }
  | { state: 'authenticated'; displayName?: string; expiresAt?: number }
  | { state: 'expired' }
  | { state: 'error'; message: string }

/**
 * Sign-in and sign-out.
 *
 * Required on every provider — including ones needing no credentials, which
 * declare `flow: { kind: 'none' }` and implement both trivially. See
 * docs/06-music-sources.md §1.1 for why this one member is not optional.
 */
export interface ProviderAuth {
  readonly flow: AuthFlow
  readonly status: AuthStatus

  /** Resolves once `status` is 'authenticated'; throws `AuthError` otherwise. */
  signIn(input: Record<string, string>): Promise<void>

  /**
   * Must leave nothing behind: clears the instance's secrets namespace,
   * empties *and forgets* its persisted cookie jar, and resets status.
   */
  signOut(): Promise<void>

  refresh?(): Promise<void>
  onStatusChange(cb: (s: AuthStatus) => void): Disposable
}

/* ── The provider ───────────────────────────────────────────────────────── */

export interface ProviderLibrary {
  list(
    kind: 'track' | 'album' | 'artist' | 'playlist',
    page?: PageRequest,
  ): Promise<Paged<{ urn: string; addedAt?: number }>>
  setSaved(urn: string, saved: boolean): Promise<void>
  createPlaylist(name: string, opts?: { description?: string }): Promise<string>
  addToPlaylist(playlistId: string, trackIds: string[]): Promise<void>
  removeFromPlaylist(playlistId: string, itemIds: string[]): Promise<void>
  reorderPlaylist(playlistId: string, itemId: string, toIndex: number): Promise<void>
  deletePlaylist(playlistId: string): Promise<void>
}

/**
 * A music backend.
 *
 * Deliberately split: a small **required core** every provider implements, and
 * a large **optional surface** implemented only where the backend supports it.
 * Omit an optional member rather than stubbing one that throws — `capabilities`
 * already carries that information truthfully.
 */
export interface MediaProvider {
  // ══ REQUIRED ═══════════════════════════════════════════════════════════
  readonly instanceId: string
  readonly displayName: string
  readonly capabilities: Capabilities
  readonly auth: ProviderAuth

  getTrack(id: string): Promise<Track>
  resolveStream(id: string, prefs: StreamPrefs): Promise<StreamHandle>
  /** Cheap reachability check. Must not count against a rate limit. */
  ping(): Promise<boolean>

  // ══ OPTIONAL ═══════════════════════════════════════════════════════════
  search?(q: SearchQuery, page?: PageRequest): Promise<SearchResult>
  browse?(nodeId?: string, page?: PageRequest): Promise<Paged<BrowseEntry>>

  /** Batched lookup. Falls back to N× `getTrack` when absent, which is slower. */
  getTracks?(ids: string[]): Promise<Track[]>
  getAlbum?(id: string): Promise<AlbumDetail>
  getArtist?(id: string): Promise<ArtistDetail>
  getPlaylist?(id: string, page?: PageRequest): Promise<PlaylistDetail>
  getLyrics?(id: string): Promise<Lyrics | undefined>
  getArtwork?(ref: ArtworkRef, size?: number): Promise<Uri>

  library?: ProviderLibrary
}

/* ── The registry ───────────────────────────────────────────────────────── */

export interface AggregatedSearchEntry {
  instanceId: string
  result?: SearchResult
  /** Present on failure. The provider is reported, never silently dropped. */
  error?: SourceError
  /** True when the provider exceeded `timeoutMs` and is still running. */
  pending: boolean
  tookMs: number
}

export interface AggregatedSearch {
  byProvider: AggregatedSearchEntry[]
}

export interface SourcesService {
  register(p: MediaProvider): Disposable
  readonly providers: readonly MediaProvider[]
  get(instanceId: string): MediaProvider | undefined
  /** Resolve a URN to its owning provider. */
  forUrn(urn: string): MediaProvider | undefined
  /**
   * Fan out across every provider that supports search.
   *
   * Returns per-provider results *and* per-provider errors — never a merged
   * list that silently drops a failing backend.
   */
  searchAll(
    q: SearchQuery,
    opts?: { instanceIds?: string[]; timeoutMs?: number },
  ): Promise<AggregatedSearch>
}

declare module 'cordis' {
  interface Context {
    sources: SourcesService
  }
}
