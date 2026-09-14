/**
 * The shipped Bilibili document, replayed.
 *
 * Every response is recorded inline — the shape bilibili actually answers
 * with, not a tidied sketch: risk-control cookies before search, WBI signing
 * on the three signed endpoints, a DASH payload whose Dolby track outscores
 * every decodable one by bandwidth, and AI subtitles sharing a host with the
 * real ones. A change to the source or the rule engine that breaks any of
 * those fails here rather than on a device.
 *
 * The sandbox is real (`core-js-quickjs-node`) because the document *is* a
 * script: its search URL, stream URL and lyrics are all `@js:`.
 *
 * WBI signing is verified independently — the test recomputes `w_rid` from
 * the recorded `wbi_img` keys with the published mixin table, so a source
 * that forgets the `!'()*` value filter or mis-sorts the query fails here
 * with a hash mismatch, not a -403 from the real backend.
 */

import { readFile } from 'node:fs/promises'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { md5Hex } from '@BBeBee/protocol'
import type { HttpRequest, HttpService, SourceRecord } from '@BBeBee/protocol'
import jsPlugin from '@BBeBee/core-js-quickjs-node'
import { DocumentSource } from './source.js'

/** The mixin table, for recomputing signatures in the test. */
const WBI_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
]

const IMG_KEY = '7cd084941338484aae1ad9425b84077c'
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45'
/** docs/misc/sign/wbi.md's own worked example derives this from the keys above. */
const EXPECTED_MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8'

const SOURCE_ID = 'www-bilibili-com-4f2bd0b3'

interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
}

/** A DASH payload big enough to hold every tier the API can answer with. */
const PLAYURL_SIGNED_IN = {
  code: 0,
  data: {
    dash: {
      audio: [
        { id: 30216, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30216.m4s?e=x', backupUrl: ['https://upos-sz-mirrorcoso1.bilivideo.com/media/30216.m4s'], codecs: 'mp4a.40.2', bandwidth: 66_000 },
        { id: 30232, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30232.m4s?e=x', codecs: 'mp4a.40.2', bandwidth: 132_000 },
        { id: 30280, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30280.m4s?e=x', codecs: 'mp4a.40.2', bandwidth: 192_000 },
      ],
      dolby: { audio: [{ id: 30250, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30250.m4s?e=x', codecs: 'ec-3', bandwidth: 384_000 }] },
      flac: { audio: { id: 30251, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30251.m4s?e=x', codecs: 'fLaC', bandwidth: 1_200_000 } },
    },
  },
}

/** Logged out: no Dolby, no FLAC — the ladder must land on the best AAC. */
const PLAYURL_LOGGED_OUT = {
  code: 0,
  data: {
    dash: {
      audio: [
        { id: 30216, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30216.m4s?e=x', codecs: 'mp4a.40.2', bandwidth: 66_000 },
        { id: 30232, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30232.m4s?e=x', codecs: 'mp4a.40.2', bandwidth: 132_000 },
      ],
    },
  },
}

/** The one arrangement where every candidate is undecodable in Chromium. */
const PLAYURL_DOLBY_ONLY = {
  code: 0,
  data: {
    dash: {
      dolby: { audio: [{ id: 30250, baseUrl: 'https://upos-sz-mirror08c.bilivideo.com/media/30250.m4s?e=x', codecs: 'ec-3', bandwidth: 384_000 }] },
    },
  },
}

const SEARCH_RESPONSE = {
  code: 0,
  data: {
    result: [
      {
        bvid: 'BV1GJ411x7h7',
        aid: 758_564_68,
        mid: 946_974,
        author: 'UP主甲',
        pic: '//i2.hdslb.com/bfs/archive/abc.jpg',
        title: '<em class="keyword">极端天气</em> MV',
        duration: '3:33',
      },
      {
        bvid: 'BV1mult8888',
        aid: 2,
        mid: 946_974,
        author: 'UP主甲',
        pic: 'https://i2.hdslb.com/bfs/archive/def.jpg',
        title: '雨声&amp;白噪音',
        duration: '1:02:03',
      },
    ],
  },
}

const SUBTITLES_RESPONSE = {
  code: 0,
  data: {
    subtitle: {
      subtitles: [
        // AI first, so picking [0] would be the mistake the preference below
        // exists to avoid: the uploaded track is the author's text.
        { lan: 'ai-zh', lan_doc: 'AI中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai-zh.json' },
        { lan: 'zh-Hans', lan_doc: '中文（简体）', subtitle_url: '//aisubtitle.hdslb.com/bfs/zh-manual.json' },
      ],
    },
  },
}

const SUBTITLE_BODIES: Record<string, unknown> = {
  '//aisubtitle.hdslb.com/bfs/zh-manual.json': {
    body: [
      { from: 0.45, to: 2.1, content: '极端天气' },
      { from: 3.21, to: 5.0, content: '第二句歌词' },
    ],
  },
  '//aisubtitle.hdslb.com/bfs/ai-zh.json': { body: [{ from: 0, to: 1, content: 'AI转写' }] },
}

const ARC_SEARCH_RESPONSE = {
  code: 0,
  data: {
    list: {
      vlist: [
        { bvid: 'BV1archive1', title: '投稿一', pic: '//i0.hdslb.com/bfs/archive/v1.jpg', length: '4:05' },
      ],
    },
  },
}

/** Two pages, the first exactly full: the shape "all of an upper's videos" ends on. */
const ARC_PAGES = [
  {
    code: 0,
    data: { list: { vlist: Array.from({ length: 50 }, (_, i) => ({ bvid: `BV1page1_${i}`, title: `投稿${i}`, pic: '//i0.hdslb.com/bfs/a.jpg', length: '1:00' })) } },
  },
  {
    code: 0,
    data: { list: { vlist: [{ bvid: 'BV1page2_0', title: '投稿X', pic: '//i0.hdslb.com/bfs/b.jpg', length: '2:00' }] } },
  },
]

const SEASON_ARCHIVES_RESPONSE = {
  code: 0,
  data: {
    meta: { season_id: 555, mid: 946_974, name: '歌单合集', cover: '//i0.hdslb.com/bfs/cover.jpg' },
    archives: [
      { bvid: 'BV1season1', title: '合集内视频一', duration: 180, pic: '//i0.hdslb.com/bfs/s1.jpg', owner: { mid: 946_974, name: 'UP主甲' } },
    ],
    page: { total: 1, page_size: 30 },
  },
}

const CARD_RESPONSE = {
  code: 0,
  data: {
    card: { mid: '946974', name: 'UP主甲', face: '//i0.hdslb.com/bfs/face/face.jpg', sign: '一个UP主' },
  },
}

/** docs/audio/rank.md — period lists keyed by year, and one issue's songs. */
const TOPLIST_PERIODS = {
  code: 0,
  data: {
    list: {
      // Numeric-like keys iterate ascending, so 2021 sorts before 2022 — the
      // row builder must re-sort by publish time for 当期 to come first.
      2021: [{ ID: 30, priod: 25, publish_time: 1_669_976_540 }],
      2022: [
        { ID: 38, priod: 29, publish_time: 1_672_394_399 },
        { ID: 36, priod: 28, publish_time: 1_671_789_599 },
      ],
    },
  },
}

const TOPLIST_MUSIC_LIST = {
  code: 0,
  data: {
    list: [
      {
        music_id: 'MA409252256362326366',
        music_title: '極楽浄土',
        singer: 'GARNiDELiA',
        album: '約束 -Promise code-',
        mv_aid: 283_618_33,
        mv_bvid: 'BV1mv11111',
        mv_cover: 'https://i0.hdslb.com/bfs/mv.jpg',
        rank: 1,
        can_listen: true,
        creation_aid: 542_698_306,
        creation_bvid: 'BV1create9',
        creation_cover: 'http://i2.hdslb.com/bfs/creation.jpg',
        creation_duration: 228,
      },
      { music_id: 'MA2', music_title: '无MV的音频', singer: '某人', album: '', mv_aid: 0, mv_bvid: '', creation_aid: 0, creation_bvid: '', can_listen: true },
    ],
  },
}

const USER_SEARCH_RESPONSE = {
  code: 0,
  data: {
    result: [
      { type: 'bili_user', mid: 360_816_46, uname: '洛天依', usign: 'Vsinger旗下虚拟歌手', fans: 6_050_677, videos: 510, upic: '//i2.hdslb.com/bfs/up.png' },
      { type: 'bili_user', mid: 946_974, uname: 'UP主甲', usign: '', fans: 10, videos: 2, upic: '//i2.hdslb.com/bfs/b.png' },
    ],
  },
}

/** A video fav folder — the route a bare fav mlid or favlist URL lands on. */
const FAV_LIST_RESPONSE = {
  code: 0,
  data: {
    info: { id: 2331713844, title: '畅听热榜', cover: '//i0.hdslb.com/bfs/fav.jpg', intro: '', upper: { mid: 1164440244, name: '音乐热榜bot' } },
    medias: [
      { id: 1, bvid: 'BV1fav1', title: '收藏视频一', duration: 100, cover: '//i0.hdslb.com/bfs/f1.jpg', upper: { mid: 946_974, name: 'UP主甲' }, cid: 555 },
    ],
    has_more: false,
  },
}

async function shippedDocument(): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL('../../../../fixtures/sources/bilibili.json', import.meta.url), 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

function recordFor(doc: Record<string, unknown>): SourceRecord {
  return {
    id: SOURCE_ID,
    sourceUrl: String(doc.sourceUrl),
    name: String(doc.sourceName),
    type: 'music',
    doc: doc as never,
    docJson: JSON.stringify(doc),
    docHash: 'h',
    enabled: true,
    sortOrder: 0,
    allowedHosts: (doc.allowedHosts as string[]) ?? ['*.bilibili.com'],
    locallyModified: false,
    importedAt: 0,
    updatedAt: 0,
    failCount: 0,
  }
}

/**
 * An `http` that routes recorded responses by host+path, and remembers every
 * request. `playurl` and `arcSearch` are getters because their variants are
 * the point of different tests. The search endpoint serves both the video and
 * the user half of search, told apart by `search_type`.
 */
function fakeHttp(
  opts: { playurl?: () => unknown; arcSearch?: () => unknown; userSearchFails?: boolean } = {},
) {
  const playurl = opts.playurl ?? (() => PLAYURL_SIGNED_IN)
  const arcSearch = opts.arcSearch ?? (() => ARC_SEARCH_RESPONSE)
  const requests: RecordedRequest[] = []
  const notFound = (req: HttpRequest) => ({
    status: 404,
    headers: {},
    url: req.url,
    text: async () => 'not found',
    bytes: async () => new Uint8Array(),
    stream: () => new ReadableStream(),
  })
  const http = (async (req: HttpRequest) => {
    const url = new URL(req.url)
    requests.push({ url: req.url, method: req.method ?? 'GET', headers: req.headers ?? {} })
    const route = url.host + url.pathname
    const searchType = url.searchParams.get('search_type') ?? ''
    let body: unknown
    if (route === 'api.bilibili.com/x/frontend/finger/spi') {
      body = { code: 0, data: { b_3: 'buvid3-abc123', b_4: 'buvid4-def456' } }
    } else if (route === 'api.bilibili.com/x/web-interface/nav') {
      body = {
        code: 0,
        data: {
          isLogin: false,
          mid: 0,
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
          },
        },
      }
    } else if (route === 'api.bilibili.com/x/web-interface/wbi/search/type' && searchType === 'bili_user') {
      if (opts.userSearchFails) return notFound(req)
      body = USER_SEARCH_RESPONSE
    } else if (route === 'api.bilibili.com/x/web-interface/wbi/search/type') {
      body = SEARCH_RESPONSE
    } else if (route === 'api.bilibili.com/x/player/pagelist') {
      body = { code: 0, data: [{ cid: 900_001, page: 1, part: '第一页', duration: 213 }] }
    } else if (route === 'api.bilibili.com/x/player/wbi/playurl') {
      body = playurl()
    } else if (route === 'api.bilibili.com/x/player/wbi/v2') {
      body = SUBTITLES_RESPONSE
    } else if (route === 'api.bilibili.com/x/space/wbi/arc/search') {
      body = arcSearch()
    } else if (route === 'api.bilibili.com/x/web-interface/card') {
      body = CARD_RESPONSE
    } else if (route === 'api.bilibili.com/x/polymer/web-space/seasons_series_list') {
      body = {
        code: 0,
        data: { items_lists: { seasons_list: [{ meta: { season_id: 555, mid: 946_974, name: '歌单合集', cover: '//i0.hdslb.com/bfs/cover.jpg', total: 1 } }], series_list: [] } },
      }
    } else if (route === 'api.bilibili.com/x/polymer/web-space/seasons_archives_list') {
      body = SEASON_ARCHIVES_RESPONSE
    } else if (route === 'api.bilibili.com/x/copyright-music-publicity/toplist/all_period') {
      body = TOPLIST_PERIODS
    } else if (route === 'api.bilibili.com/x/copyright-music-publicity/toplist/music_list') {
      body = TOPLIST_MUSIC_LIST
    } else if (route === 'api.bilibili.com/x/v3/fav/resource/list') {
      body = FAV_LIST_RESPONSE
    } else if (route === 'api.bilibili.com/x/series/recArchivesByKeywords') {
      body = { code: 0, data: { archives: [] } }
    } else if (route.startsWith('aisubtitle.hdslb.com/')) {
      const key = Object.keys(SUBTITLE_BODIES).find((k) => k.endsWith(url.pathname))
      if (!key) return notFound(req)
      body = SUBTITLE_BODIES[key]
    } else {
      return notFound(req)
    }
    const text = JSON.stringify(body)
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      url: req.url,
      text: async () => text,
      json: async () => body,
      bytes: async () => new Uint8Array(),
      stream: () => new ReadableStream(),
    }
  }) as unknown as HttpService
  return { http, requests }
}

function fakeJar() {
  const store = new Map<string, string>()
  return {
    cookies: {
      get: async (name: string) => store.get(name),
      set: async (name: string, value: string) => {
        store.set(name, value)
      },
      all: async () => Object.fromEntries(store),
    },
    store,
  }
}

let jsService: unknown

/** One QuickJS module for the file; the sandbox is not what is under test. */
async function makeJs(): Promise<never> {
  if (!jsService) {
    const ctx = new Context()
    await ctx.plugin(jsPlugin, {})
    jsService = (ctx as unknown as { js: unknown }).js
  }
  return jsService as never
}

/**
 * A fresh document+realm: `src.cache` and the jar start empty every time.
 * `payloads.current` stands in for the catalogue's `tracks.raw_json` — a
 * search fills it and stream/lyric resolution reads it back, keyed by URN
 * exactly as the runtime's `trackPayload` does.
 */
async function makeSource(
  opts: {
    playurl?: () => unknown
    arcSearch?: () => unknown
    userSearchFails?: boolean
  } = {},
) {
  const doc = await shippedDocument()
  const { http, requests } = fakeHttp(opts)
  const jar = fakeJar()
  const payloads: { current?: Record<string, unknown> } = {}
  const source = new DocumentSource(recordFor(doc), {
    http,
    js: await makeJs(),
    cookies: jar.cookies,
    trackPayload: async (id: string) =>
      payloads.current?.[`BBeBee:${SOURCE_ID}:track:${id}`] as Record<string, unknown> | undefined,
    log: () => {},
  })
  return { source, requests, jar, payloads, doc }
}

describe('the shipped Bilibili document', () => {
  it('is searchable, browsable, and its login flow is the QR one', async () => {
    const { source } = await makeSource()
    expect(source.capabilities.search.tracks).toBe(true)
    expect(source.capabilities.search.artists, 'the user-search block is declared').toBe(true)
    expect(source.capabilities.browse, 'the chart explore blocks are declared').toBe(true)
    expect(source.provider().auth.flow.kind).toBe('qrcode')
  })

  it('bootstraps buvid3, WBI-signs the search, and carries browser headers', async () => {
    const { source, requests, jar } = await makeSource()
    await source.search({ text: 'rei! (live)*' })

    // Risk-control bootstrap before the search itself…
    expect(jar.store.get('buvid3')).toBe('buvid3-abc123')
    expect(requests[0]!.url).toContain('/x/frontend/finger/spi')
    expect(requests[1]!.url).toContain('/x/web-interface/nav')

    // …and a signed search request with a browser User-Agent, because a
    // cookieless non-browser client is what -412 answers.
    const search = requests[2]!
    expect(search.url).toContain('https://api.bilibili.com/x/web-interface/wbi/search/type')
    expect(search.headers['User-Agent']).toContain('Mozilla/5.0')
    expect(search.url).toContain('keyword=rei%20live')
    expect(search.url).toContain('search_type=video')
  })

  it('signs w_rid exactly the way the server repeats it', async () => {
    const { source, requests } = await makeSource()
    await source.search({ text: 'rei! (live)*' })

    const mixin = Array.from({ length: 32 }, (_, i) => (IMG_KEY + SUB_KEY)[WBI_ENC_TAB[i]!]!).join('')
    expect(mixin, 'the document must permute the same published table').toBe(EXPECTED_MIXIN_KEY)

    const search = new URL(requests[2]!.url)
    const wRid = search.searchParams.get('w_rid')
    expect(wRid).toMatch(/^[0-9a-f]{32}$/)
    expect(Number(search.searchParams.get('wts'))).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))

    // What the server does: every parameter but w_rid (wts included), keys
    // sorted, `!'()*` stripped from values, URL-encoded, hashed with the key.
    const pairs = [...search.searchParams.entries()]
      .filter(([k]) => k !== 'w_rid')
      .map(([k, v]) => [k, v.replace(/[!'()*]/g, '')] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    expect(wRid).toBe(md5Hex(pairs.join('&') + mixin))
  })

  it('turns a search page into tracks — keyword markup and clock durations cleaned', async () => {
    const { source } = await makeSource()
    const result = await source.search({ text: '极端天气' })

    const [first, second] = result.tracks!.items
    expect(first).toMatchObject({
      urn: `BBeBee:${SOURCE_ID}:track:BV1GJ411x7h7`,
      title: '极端天气 MV',
      durationMs: 213_000,
    })
    expect(first!.artists[0]!.name).toBe('UP主甲')
    expect(first!.artwork?.id).toBe('https://i2.hdslb.com/bfs/archive/abc.jpg')
    expect(second!.title, 'HTML entities in titles decode once').toBe('雨声&白噪音')
    expect(second!.durationMs).toBe(3_723_000)

    // The stored payload is what makes the stream resolve later: the raw
    // element's bvid has to survive the search that produced it.
    expect(Object.keys(result.payloads!)[0]).toBe(first!.urn)
  })

  it('resolves the Hi-Res FLAC the player asks for — not the Dolby track bandwidth prefers', async () => {
    const { source, requests, payloads } = await makeSource()
    payloads.current = (await source.search({ text: '极端天气' })).payloads!

    const handle = await source.resolveStream('BV1GJ411x7h7', {
      quality: 'lossless',
      saveData: false,
      acceptFormats: ['mp3', 'flac', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'aiff'],
    })

    expect(handle.kind).toBe('remote')
    expect(handle.target).toContain('30251.m4s')
    // fnval bit 4096 is what makes the API offer Hi-Res at all.
    const playurl = requests.find((r) => r.url.includes('/x/player/wbi/playurl'))!
    expect(playurl.url).toContain('fnval=8144')
    expect(playurl.url).toContain('bvid=BV1GJ411x7h7')
    expect(playurl.url).toContain('cid=900001')
    expect(playurl.url, 'playurl is a WBI endpoint').toContain('w_rid=')
    // The CDN refuses a request without these — the player registers them.
    expect(handle.headers?.Referer).toBe('https://www.bilibili.com/')
    expect(handle.headers?.['User-Agent']).toContain('Mozilla/5.0')
    expect(handle.seekable).toBe(true)
    expect(handle.expiresAt).toBeGreaterThan(Date.now())
  })

  it('walks fnval down when the Hi-Res request is refused', async () => {
    /*
     * Bilibili answers -400 to a bitmap carrying tracks the video does not
     * offer rather than ignoring the extra bits. Pinned at 8144, that made
     * every video without a FLAC track unplayable; the walk-down lands on the
     * same AAC the older pinned-but-tolerant API used to answer.
     */
    let calls = 0
    const { source, requests } = await makeSource({
      playurl: () => (++calls === 1 ? { code: -400, message: '请求错误' } : PLAYURL_LOGGED_OUT),
    })
    const handle = await source.resolveStream('BV1GJ411x7h7', {
      quality: 'lossless',
      saveData: false,
      acceptFormats: [],
    })
    expect(handle.target).toContain('30232.m4s')
    const fnvals = requests
      .filter((r) => r.url.includes('/x/player/wbi/playurl'))
      .map((r) => new URL(r.url).searchParams.get('fnval'))
    expect(fnvals).toEqual(['8144', '4048'])
  })

  it('degrades to the best AAC when signed out offers nothing better', async () => {
    const { source } = await makeSource({ playurl: () => PLAYURL_LOGGED_OUT })
    const handle = await source.resolveStream('BV1GJ411x7h7', {
      quality: 'lossless',
      saveData: false,
      acceptFormats: [],
    })
    expect(handle.target).toContain('30232.m4s')
  })

  it('never hands back the Dolby track, even when it is the only one', async () => {
    const { source } = await makeSource({ playurl: () => PLAYURL_DOLBY_ONLY })
    await expect(
      source.resolveStream('BV1GJ411x7h7', { quality: 'lossless', saveData: false, acceptFormats: [] }),
    ).rejects.toThrow(/No playable audio stream/)
  })

  it('searches users alongside videos, and maps them onto the artist page', async () => {
    const { source, requests } = await makeSource()
    const result = await source.search({ text: '洛天依' })

    expect(result.tracks!.items.length).toBeGreaterThan(0)
    const artists = result.artists!.items
    expect(artists[0]).toMatchObject({
      urn: `BBeBee:${SOURCE_ID}:artist:36081646`,
      name: '洛天依',
    })
    expect(artists[0]!.artwork?.id).toBe('https://i2.hdslb.com/bfs/up.png')
    // A query that names its types gets exactly those — artist only, no video
    // fetch for it to ride along on.
    const artistOnly = await source.search({ text: '洛天依', types: ['artist'] })
    expect(artistOnly.artists!.items.length).toBeGreaterThan(0)

    const userSearch = requests.filter((r) => r.url.includes('search_type=bili_user'))
    expect(userSearch.length).toBeGreaterThanOrEqual(2)
    expect(userSearch[0]!.url).toContain('w_rid=')
  })

  it('keeps the search alive when the artist endpoint answers badly', async () => {
    // A failing user search is degraded, not fatal: the tracks the user asked
    // for must not vanish because a secondary endpoint answered 404.
    const { source } = await makeSource({ userSearchFails: true })
    const result = await source.search({ text: '洛天依' })
    expect(result.tracks!.items.length).toBeGreaterThan(0)
    expect(result.artists).toBeUndefined()
  })

  it('browses the audio charts: 当期 first, then every issue, then its songs', async () => {
    const { source, requests, payloads } = await makeSource()

    const root = await source.browse()
    expect(root.items.map((e) => e.title)).toEqual([
      '音乐热榜·当期',
      '音乐热榜·每期',
      '原创音乐榜·当期',
      '原创音乐榜·每期',
    ])

    // 每期: every issue of the hot chart, newest first, each a folder pointing
    // at its own song list.
    const hotEvery = root.items.find((e) => e.title === '音乐热榜·每期')!
    const issues = await source.browse(hotEvery.id)
    expect(issues.items.map((e) => e.title)).toEqual(['2022年 第29期', '2022年 第28期', '2021年 第25期'])
    expect(issues.items[0]!.kind).toBe('folder')

    // Descending an issue lands on songs, as playable video leaves carrying
    // the creation video's duration.
    const songs = await source.browse(issues.items[0]!.id)
    expect(songs.items).toHaveLength(1)
    const song = songs.items[0]!
    expect(song).toMatchObject({
      kind: 'track',
      leaf: true,
      title: '極楽浄土',
      urn: `BBeBee:${SOURCE_ID}:track:BV1mv11111`,
    })
    expect(song.subtitle).toBe('GARNiDELiA')
    const musicList = requests.filter((r) => r.url.includes('toplist/music_list'))
    expect(musicList.length).toBe(1)
    expect(musicList[0]!.url).toContain('list_id=38')

    // The browsed row answers getTrack as a full identity — duration included,
    // coerced back out of the text the list-rule contract carries.
    payloads.current = songs.payloads as Record<string, unknown>
    const info = await source.getTrack('BV1mv11111')
    expect(info).toMatchObject({
      title: '極楽浄土',
      albumTitle: '約束 -Promise code-',
      durationMs: 228_000,
    })
    expect(info.artists[0]?.name).toBe('GARNiDELiA')
    expect(info.artwork?.id).toBe('https://i0.hdslb.com/bfs/mv.jpg')

    // 当期: the sections pointing straight at the newest issue play immediately.
    const hotNow = root.items.find((e) => e.title === '音乐热榜·当期')!
    const nowSongs = await source.browse(hotNow.id)
    expect(nowSongs.items).toHaveLength(1)
  })

  it('opens a fav folder or collection from a bare id or a copied space URL', async () => {
    const { source, requests } = await makeSource()

    const byBareId = await source.getPlaylist('2331713844')
    expect(byBareId.urn).toBe(`BBeBee:${SOURCE_ID}:playlist:bili_collect_2331713844`)

    const byUrl = await source.getPlaylist('https://space.bilibili.com/946974/channel/collectiondetail?sid=555')
    const archives = requests.find((r) => r.url.includes('seasons_archives_list'))!
    expect(archives.url).toContain('mid=946974')
    expect(archives.url).toContain('season_id=555')
    expect(byUrl.name).toBe('歌单合集')

    // favlist URLs name a folder; the collection call must not mistake it.
    await expect(source.getPlaylist('https://space.bilibili.com/946974/favlist?fid=2331713844')).resolves.toBeTruthy()
    await expect(source.getPlaylist('not a playlist id')).rejects.toThrow(/cannot interpret/)
  })

  it('fetches all of an upper\u2019s videos, not just the first page', async () => {
    const { source, requests } = await makeSource({
      arcSearch: (() => {
        let page = 0
        return () => ARC_PAGES[Math.min(page++, ARC_PAGES.length - 1)]!
      })(),
    })
    const artist = await source.getArtist('946974')
    // A full page (50) sends the loop round again; the short second page ends it.
    expect(artist.topTracks!.length).toBe(51)
    expect(artist.topTracks![50]!.urn.split(':').pop()).toBe('BV1page2_0')
    expect(requests.filter((r) => r.url.includes('/x/space/wbi/arc/search')).length).toBe(2)
  })

  it('reads lyrics from the signed player endpoint and prefers uploaded subtitles over AI', async () => {
    const { source, requests, payloads } = await makeSource()
    payloads.current = (await source.search({ text: '极端天气' })).payloads!

    const lyrics = await source.getLyrics('BV1GJ411x7h7')

    // x/player/wbi/v2 unsigned answers -403, which reads as "no lyrics".
    const playerInfo = requests.find((r) => r.url.includes('/x/player/wbi/v2'))!
    expect(playerInfo.url).toContain('w_rid=')
    expect(playerInfo.url).toContain('cid=900001')

    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    // The AI track is answered first by the API and must not be the one read.
    const lyricRequest = requests.find((r) => r.url.includes('aisubtitle.hdslb.com'))!
    expect(lyricRequest.url).toContain('zh-manual.json')
    // Real newlines — an escaped `\\n` here renders as one long line.
    expect(lyrics?.content).toBe('[00:00.45]极端天气\n[00:03.21]第二句歌词')
  })

  it('carries the owner mid in a season playlist id, and the playlist call needs it', async () => {
    const { source, requests } = await makeSource()
    const artist = await source.getArtist('946974')
    expect(artist.name).toBe('UP主甲')
    expect(artist.albums.map((a) => a.urn)).toContain(
      `BBeBee:${SOURCE_ID}:album:bili_season_946974_555`,
    )
    expect((artist.topTracks ?? []).length).toBeGreaterThan(0)

    const playlist = await source.getPlaylist('bili_season_946974_555')
    const archives = requests.find((r) => r.url.includes('seasons_archives_list'))!
    expect(archives.url).toContain('mid=946974')
    expect(archives.url).toContain('season_id=555')
    expect(playlist.name).toBe('歌单合集')
    expect(playlist.tracks![0]).toMatchObject({
      urn: `BBeBee:${SOURCE_ID}:track:BV1season1`,
      durationMs: 180_000,
    })

    // An id from before the mid rode along cannot name a valid call — say so
    // rather than answering an empty playlist nobody can diagnose.
    await expect(source.getPlaylist('bili_season_555')).rejects.toThrow(/mid/)
  })
})
