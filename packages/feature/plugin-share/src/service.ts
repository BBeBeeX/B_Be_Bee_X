import { Service } from "cordis"
import type { Context } from "cordis"
import type {
  PixelBuffer,
  ShareLyricsData,
  ShareMetadataEnvelope,
  SharePlaylistData,
  ShareService,
  ShareTrackData,
  ShareType,
  ShareableTrack,
} from "@BBeBee/protocol"
import { encodeSteganography, decodeSteganography } from "./steganography.js"
import { encodeMetadata, decodeMetadata } from "./metadata.js"

export interface ShareConfig {
  enabled?: boolean
}

export class Share extends Service implements ShareService {
  static inject = []

  constructor(
    ctx: Context,
    private readonly config: ShareConfig = {},
  ) {
    super(ctx, "share")
  }

  encodeMetadata<T extends ShareTrackData | SharePlaylistData | ShareLyricsData>(
    type: ShareType,
    data: T,
  ): string {
    return encodeMetadata(type, data)
  }

  decodeMetadata(base64: string): ShareMetadataEnvelope | null {
    return decodeMetadata(base64)
  }

  encodeSteganography(buffer: PixelBuffer, payload: string): PixelBuffer {
    return encodeSteganography(buffer, payload)
  }

  decodeSteganography(buffer: PixelBuffer): string | null {
    return decodeSteganography(buffer)
  }

  shareTrack(track: ShareableTrack): void {
    const urn = "urn" in track && typeof track.urn === "string" ? track.urn : ""
    const artist =
      "artist" in track && typeof track.artist === "string"
        ? track.artist
        : "artists" in track && Array.isArray(track.artists)
          ? track.artists.map((a: { name: string }) => a.name).join(", ")
          : ""

    const artwork =
      typeof track.artwork === "string"
        ? track.artwork
        : typeof (track as { artworkUri?: unknown }).artworkUri === "string"
          ? (track as { artworkUri: string }).artworkUri
          : (track.artwork as { sourceUrl?: string } | undefined)?.sourceUrl

    const albumTitle =
      "albumTitle" in track && typeof track.albumTitle === "string"
        ? track.albumTitle
        : "album" in track && typeof track.album === "string"
          ? track.album
          : undefined

    const trackData: ShareTrackData = {
      urn,
      title: track.title,
      artist: artist || "Unknown Artist",
      albumTitle,
      artwork,
      duration:
        "durationMs" in track && typeof track.durationMs === "number"
          ? track.durationMs
          : "duration" in track && typeof track.duration === "number"
            ? track.duration
            : undefined,
      source:
        "sourceId" in track && typeof track.sourceId === "string"
          ? track.sourceId
          : "source" in track && typeof track.source === "string"
            ? track.source
            : undefined,
    }

    this.ctx.emit("share/open", { type: "track", track: trackData })
  }

  sharePlaylist(
    playlist: { urn: string; name: string; description?: string; artwork?: string },
    tracks?: readonly ShareableTrack[],
  ): void {
    const playlistTracks = tracks?.map((t) => {
      const urn = "urn" in t && typeof t.urn === "string" ? t.urn : ""
      const artist =
        "artist" in t && typeof t.artist === "string"
          ? t.artist
          : "artists" in t && Array.isArray(t.artists)
            ? t.artists.map((a: { name: string }) => a.name).join(", ")
            : ""
      const artwork =
        typeof t.artwork === "string"
          ? t.artwork
          : typeof (t as { artworkUri?: unknown }).artworkUri === "string"
            ? (t as { artworkUri: string }).artworkUri
            : (t.artwork as { sourceUrl?: string } | undefined)?.sourceUrl
      const albumTitle =
        "albumTitle" in t && typeof t.albumTitle === "string"
          ? t.albumTitle
          : "album" in t && typeof t.album === "string"
            ? t.album
            : undefined
      return {
        urn,
        title: t.title,
        artist: artist || "Unknown Artist",
        albumTitle,
        artwork,
        duration:
          "durationMs" in t && typeof t.durationMs === "number"
            ? t.durationMs
            : "duration" in t && typeof t.duration === "number"
              ? t.duration
              : undefined,
      }
    })

    const playlistData: SharePlaylistData = {
      urn: playlist.urn,
      name: playlist.name,
      description: playlist.description,
      artwork: playlist.artwork,
      trackCount: playlistTracks ? playlistTracks.length : 0,
      tracks: playlistTracks,
    }

    this.ctx.emit("share/open", { type: "playlist", playlist: playlistData })
  }

  shareLyrics(track: ShareableTrack, lines: string[]): void {
    const urn = "urn" in track && typeof track.urn === "string" ? track.urn : ""
    const artist =
      "artist" in track && typeof track.artist === "string"
        ? track.artist
        : "artists" in track && Array.isArray(track.artists)
          ? track.artists.map((a: { name: string }) => a.name).join(", ")
          : ""

    const artwork =
      typeof track.artwork === "string"
        ? track.artwork
        : typeof (track as { artworkUri?: unknown }).artworkUri === "string"
          ? (track as { artworkUri: string }).artworkUri
          : (track.artwork as { sourceUrl?: string } | undefined)?.sourceUrl

    const albumTitle =
      "albumTitle" in track && typeof track.albumTitle === "string"
        ? track.albumTitle
        : "album" in track && typeof track.album === "string"
          ? track.album
          : undefined

    const lyricsData: ShareLyricsData = {
      trackUrn: urn,
      title: track.title,
      artist: artist || "Unknown Artist",
      albumTitle,
      artwork,
      lines,
    }

    this.ctx.emit("share/open", { type: "lyrics", lyrics: lyricsData })
  }

  openImport(): void {
    this.ctx.emit("share/import")
  }
}
