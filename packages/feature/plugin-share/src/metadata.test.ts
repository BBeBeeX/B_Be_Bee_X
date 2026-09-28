import { describe, it, expect } from "vitest"
import { encodeMetadata, decodeMetadata, toBase64, fromBase64 } from "./metadata.js"
import type { ShareLyricsData, SharePlaylistData, ShareTrackData } from "@BBeBee/protocol"

describe("metadata codec", () => {
  it("encodes and decodes utf-8 base64 strings with unicode and special symbols", () => {
    const text = "刘若英 - 幸福不是情歌 🎶 (BBeBee 2026! @#$%)"
    const b64 = toBase64(text)
    const back = fromBase64(b64)
    expect(back).toBe(text)
  })

  it("encodes and decodes track metadata envelope", () => {
    const track: ShareTrackData = {
      urn: "source:netease:song:123456",
      title: "幸福不是情歌",
      artist: "刘若英",
      albumTitle: "亲爱的路人",
      artwork: "https://example.com/cover.jpg",
      duration: 258000,
      source: "netease",
    }

    const b64 = encodeMetadata("track", track)
    expect(typeof b64).toBe("string")

    const decoded = decodeMetadata(b64)
    expect(decoded).not.toBeNull()
    expect(decoded?.app).toBe("BBeBee")
    expect(decoded?.version).toBe(1)
    expect(decoded?.type).toBe("track")
    expect(decoded?.data).toEqual(track)
  })

  it("encodes and decodes playlist metadata envelope", () => {
    const playlist: SharePlaylistData = {
      urn: "source:bilibili:fav:9988",
      name: "我的精选歌单",
      description: "好听的歌曲合集",
      trackCount: 2,
      tracks: [
        {
          urn: "source:bilibili:BV123",
          title: "Track 1",
          artist: "Artist 1",
          duration: 180000,
        },
        {
          urn: "source:bilibili:BV456",
          title: "Track 2",
          artist: "Artist 2",
          duration: 210000,
        },
      ],
    }

    const b64 = encodeMetadata("playlist", playlist)
    const decoded = decodeMetadata(b64)

    expect(decoded).not.toBeNull()
    expect(decoded?.type).toBe("playlist")
    expect(decoded?.data).toEqual(playlist)
  })

  it("encodes and decodes lyrics metadata envelope", () => {
    const lyrics: ShareLyricsData = {
      trackUrn: "source:local:track:1",
      title: "幸福不是情歌",
      artist: "刘若英",
      lines: [
        "人生的挫折 好在有舍就有得",
        "曾真心付出的 都会是值得的",
        "却不能停格 只留下所有快乐",
      ],
    }

    const b64 = encodeMetadata("lyrics", lyrics)
    const decoded = decodeMetadata(b64)

    expect(decoded).not.toBeNull()
    expect(decoded?.type).toBe("lyrics")
    expect(decoded?.data).toEqual(lyrics)
  })

  it("returns null for malformed base64 or invalid json", () => {
    expect(decodeMetadata("invalid-base-64!!")).toBeNull()
    expect(decodeMetadata(toBase64("not a json"))).toBeNull()
    expect(decodeMetadata(toBase64(JSON.stringify({ some: "other" })))).toBeNull()
    expect(
      decodeMetadata(
        toBase64(JSON.stringify({ app: "OtherApp", version: 1, type: "track", data: {} }))
      )
    ).toBeNull()
  })
})
