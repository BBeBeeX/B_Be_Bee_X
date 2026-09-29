/**
 * ctx.share — Third-party source track/playlist and lyrics sharing service.
 *
 * Provides metadata serialization into Base64 envelopes, image steganography
 * encoding & decoding, and share modal triggers.
 */

// Pulls cordis into the program so the declare module augmentation below resolves.
import type { Track } from "../entities/catalog.js"
import type { NowPlayingMeta } from "../entities/playback.js"

export type ShareType = "track" | "playlist" | "lyrics" | "album"

/**
 * Universal pixel buffer representing an uncompressed RGBA bitmap.
 * Compatible with HTML5 Canvas ImageData as well as headless pixel buffers.
 */
export interface PixelBuffer {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray | Uint8Array
}

export interface ShareMetadataEnvelope<T = unknown> {
  version: 1
  app: "BBeBee"
  type: ShareType
  createdAt: number
  data: T
}

export interface ShareTrackData {
  urn: string
  title: string
  artist: string
  albumTitle?: string
  artwork?: string
  duration?: number
  source?: string
  sourceUrn?: string
  extra?: Record<string, unknown>
}

export interface SharePlaylistData {
  urn: string
  name: string
  description?: string
  artwork?: string
  trackCount: number
  tracks?: Array<{
    urn: string
    title: string
    artist: string
    albumTitle?: string
    artwork?: string
    duration?: number
  }>
  source?: string
  extra?: Record<string, unknown>
}

export interface ShareAlbumData {
  urn: string
  title: string
  artist?: string
  artwork?: string
  year?: number
  trackCount: number
  tracks?: Array<{
    urn: string
    title: string
    artist: string
    albumTitle?: string
    artwork?: string
    duration?: number
  }>
  source?: string
  extra?: Record<string, unknown>
}

export interface ShareLyricsData {
  trackUrn: string
  title: string
  artist: string
  albumTitle?: string
  artwork?: string
  lines: string[]
}

export type ShareTarget =
  | { type: "track"; track: ShareTrackData }
  | { type: "playlist"; playlist: SharePlaylistData }
  | { type: "lyrics"; lyrics: ShareLyricsData }
  | { type: "album"; album: ShareAlbumData }

export type ShareableTrack =
  | Track
  | ShareTrackData
  | NowPlayingMeta
  | {
      urn?: string
      title: string
      artist?: string
      album?: string
      albumTitle?: string
      artwork?: unknown
      artworkUri?: string
      duration?: number
      durationMs?: number
      source?: string
      sourceId?: string
    }

export interface ShareService {
  encodeMetadata<T extends ShareTrackData | SharePlaylistData | ShareLyricsData | ShareAlbumData>(
    type: ShareType,
    data: T,
  ): string
  decodeMetadata(base64: string): ShareMetadataEnvelope | null
  encodeSteganography(buffer: PixelBuffer, payload: string): PixelBuffer
  decodeSteganography(buffer: PixelBuffer): string | null
  shareTrack(track: ShareableTrack): void
  sharePlaylist(
    playlist: { urn: string; name: string; description?: string; artwork?: string },
    tracks?: readonly ShareableTrack[],
  ): void
  shareAlbum(
    album: { urn: string; title: string; artist?: string; artwork?: string; year?: number; trackCount?: number },
    tracks?: readonly ShareableTrack[],
  ): void
  shareLyrics(track: ShareableTrack, lines: string[]): void
  openImport(): void
}

declare module "cordis" {
  interface Context {
    share: ShareService
  }
}
