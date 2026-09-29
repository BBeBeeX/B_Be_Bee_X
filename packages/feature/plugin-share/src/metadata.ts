import type {
  ShareAlbumData,
  ShareLyricsData,
  ShareMetadataEnvelope,
  SharePlaylistData,
  ShareTrackData,
  ShareType,
} from "@BBeBee/protocol"

/**
 * Universal safe UTF-8 to Base64 encoder supporting Chinese characters and Unicode.
 */
export function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!)
  }
  return btoa(bin)
}

/**
 * Universal safe Base64 to UTF-8 decoder.
 */
export function fromBase64(base64: string): string {
  const clean = base64.trim()
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return new TextDecoder("utf-8").decode(bytes)
}

/**
 * Serializes metadata into a Base64-encoded JSON envelope.
 */
export function encodeMetadata<T extends ShareTrackData | SharePlaylistData | ShareLyricsData | ShareAlbumData>(
  type: ShareType,
  data: T,
): string {
  const envelope: ShareMetadataEnvelope<T> = {
    version: 1,
    app: "BBeBee",
    type,
    createdAt: Date.now(),
    data,
  }
  const json = JSON.stringify(envelope)
  return toBase64(json)
}

/**
 * Deserializes and validates a Base64-encoded metadata envelope.
 * Returns null if the data is corrupted or does not match the BBeBee schema.
 */
export function decodeMetadata(base64: string): ShareMetadataEnvelope | null {
  try {
    const json = fromBase64(base64)
    const parsed = JSON.parse(json) as unknown
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "app" in parsed &&
      parsed.app === "BBeBee" &&
      "version" in parsed &&
      parsed.version === 1 &&
      "type" in parsed &&
      typeof parsed.type === "string" &&
      ("track" === parsed.type || "playlist" === parsed.type || "lyrics" === parsed.type || "album" === parsed.type) &&
      "data" in parsed &&
      typeof parsed.data === "object" &&
      parsed.data !== null
    ) {
      return parsed as ShareMetadataEnvelope
    }
    return null
  } catch {
    return null
  }
}
