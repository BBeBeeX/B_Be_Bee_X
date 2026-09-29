import { Service } from "cordis"
import type { Context } from "cordis"
import type {
  PixelBuffer,
  ShareAlbumData,
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

  encodeMetadata<T extends ShareTrackData | SharePlaylistData | ShareLyricsData | ShareAlbumData>(
    type: ShareType,
    data: T,
  ): string {
    return encodeMetadata(type, data)
  }

  decodeMetadata(base64: string): ShareMetadataEnvelope | null {
    const envelope = decodeMetadata(base64)
    if (!envelope) {
      // The one failure a share link can hit with no UI in sight: a card whose
      // payload got corrupted in transit. Silent here would be an empty import
      // dialog with nothing in the log file to explain it.
      this.ctx.logger.warn("plugin-share: share payload did not decode — invalid or corrupted data")
    }
    return envelope
  }

  encodeSteganography(buffer: PixelBuffer, payload: string): PixelBuffer {
    return encodeSteganography(buffer, payload)
  }

  decodeSteganography(buffer: PixelBuffer): string | null {
    const payload = decodeSteganography(buffer)
    if (!payload) {
      // Expected for any image that is not a share card; debug, not warn.
      this.ctx.logger.debug("plugin-share: no steganography payload in image buffer")
    }
    return payload
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

    this.ctx.logger.debug(`plugin-share: opening track share for "${trackData.title}"`)
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

    const playlistArtwork =
      typeof playlist.artwork === "string"
        ? playlist.artwork
        : (playlist.artwork as { sourceUrl?: string } | undefined)?.sourceUrl

    const playlistData: SharePlaylistData = {
      urn: playlist.urn,
      name: playlist.name,
      description: playlist.description,
      artwork: playlistArtwork,
      trackCount: playlistTracks ? playlistTracks.length : 0,
      tracks: playlistTracks,
    }

    this.ctx.logger.debug(`plugin-share: opening playlist share for "${playlistData.name}"`)
    this.ctx.emit("share/open", { type: "playlist", playlist: playlistData })
  }

  shareAlbum(
    album: { urn: string; title: string; artist?: string; artwork?: string; year?: number; trackCount?: number },
    tracks?: readonly ShareableTrack[],
  ): void {
    const albumTracks = tracks?.map((t) => {
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

    const albumArtwork =
      typeof album.artwork === "string"
        ? album.artwork
        : (album.artwork as { sourceUrl?: string } | undefined)?.sourceUrl

    const albumData: ShareAlbumData = {
      urn: album.urn,
      title: album.title,
      artist: album.artist,
      artwork: albumArtwork,
      year: album.year,
      trackCount: album.trackCount ?? (albumTracks ? albumTracks.length : 0),
      tracks: albumTracks,
    }

    this.ctx.logger.debug(`plugin-share: opening album share for "${albumData.title}"`)
    this.ctx.emit("share/open", { type: "album", album: albumData })
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

    this.ctx.logger.debug(`plugin-share: opening lyrics share for "${lyricsData.title}"`)
    this.ctx.emit("share/open", { type: "lyrics", lyrics: lyricsData })
  }

  openImport(): void {
    this.ctx.logger.debug("plugin-share: opening share import reader")
    this.ctx.emit("share/import")
  }
}
