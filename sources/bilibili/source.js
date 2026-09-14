// Bilibili source library — every rule in source.json lands here.
//
// The flow mirrors yt-dlp's Bilibili extractor
// (yt_dlp/extractor/bilibili.py), endpoint for endpoint and parameter for
// parameter:
//
//   search          BiliBiliSearchIE._search_results
//                   GET x/web-interface/search/type with Search_key/keyword/
//                   page/context/duration/tids_2/__refresh__/search_type/
//                   tids/highlight, after bootstrapping a random buvid3.
//   playurl         BilibiliBaseIE._download_playinfo
//                   GET x/player/wbi/playurl, WBI-signed, fnval=4048, the
//                   dm_img_* fingerprint params, and try_look=1 when signed
//                   out (popped when signed in). Error codes are normalised
//                   the way yt-dlp normalises them: code * -1, 401/352
//                   expected, "please wait and try later".
//   legacy streams  BiliBiliIE._real_extract
//                   when the response has no `dash`, the video is pre-DASH:
//                   durl + accept_quality. yt-dlp re-asks every qn; the
//                   source asks once for the qn its tier maps to.
//   subtitles       BilibiliBaseIE._get_subtitles
//                   GET x/player/wbi/v2, unsigned, aid+cid when the aid is
//                   known and bvid+cid otherwise, then the subtitle JSON.
//   artist uploads  BilibiliSpaceVideoIE
//                   GET x/space/wbi/arc/search with keyword/mid/order/
//                   order_avoided/platform/pn/ps/tid/web_location/
//                   special_type/index + dm_*; ps=30; HTTP 412 and code
//                   -401/-352 named; meta.attribute 156 (hidden-mode
//                   collection) becomes an album.
//   favourites      BilibiliFavoritesListIE
//                   GET x/v3/fav/resource/list (metadata + the page's rows)
//                   and GET x/v3/fav/resource/ids (the full entry list).
//   collections     BilibiliCollectionListIE
//                   GET x/polymer/web-space/seasons_archives_list.
//   series          BilibiliSeriesListIE
//                   GET x/series/series (metadata) + x/series/archives.
//
// Deviations the source model forces, all documented in README.md:
//
//   * `ruleStream` must return one URL for one chosen tier, where yt-dlp
//     hands its whole format list to a selector. Candidate collection, the
//     try_look branch and the legacy accept_quality walk are yt-dlp's; the
//     final pick is the app's quality ladder.
//   * `getArtist` materialises the upload pages (bounded) instead of paging
//     lazily, because the artist rule returns one fixed list.
//   * a legacy durl response with more than one fragment is a multi-part flv
//     stream that yt-dlp splits into separate entries; one `ruleStream` URL
//     cannot represent it, so it is refused with a named error instead of
//     playing only the first part silently.
//   * the chart browse tree (`biliExploreUrl`) has no counterpart in
//     bilibili.py; it is kept as the source's browse surface.

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com',
};

// Per docs/misc/sign/wbi.md: the first 32 entries index the concatenated
// img_key+sub_key into the mixin key. Fixed by the web client, not secret.
// yt-dlp hard-codes the same table in BilibiliBaseIE._get_wbi_key.
const WBI_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

// DASH audio ids → the app's `StreamQuality` tiers, per the label Bilibili's
// own player shows for each id:
//
//   id     web label       app tier
//   30216  流畅 64K         low
//   30232  标准 132K        normal
//   30280  高品质 192K       high
//   30250  杜比全景声        lossless
//   30251  Hi-Res 无损      hi-res
//
// 30250 is Dolby Atmos (E-AC-3) — Chromium cannot decode it, so it is mapped
// for reporting but never chosen; the ladder walks a decoded tier list
// instead of raw bandwidth, because by bandwidth Dolby wins every sort and
// produces a track that cannot play.
const AUDIO_TIERS = {
  30216: 'low',
  30232: 'normal',
  30280: 'high',
  30250: 'lossless',
  30251: 'hi-res',
};

const AUDIO_LADDER = {
  low: ['low', 'normal', 'high', 'hi-res'],
  normal: ['normal', 'high', 'low', 'hi-res'],
  high: ['high', 'normal', 'low', 'hi-res'],
  // The player asks for 'lossless' by default; FLAC when the response carries
  // it, the best AAC otherwise. Dolby is absent on purpose — see AUDIO_TIERS.
  lossless: ['hi-res', 'high', 'normal', 'low'],
  'hi-res': ['hi-res', 'high', 'normal', 'low'],
};

// `qn` only matters on the legacy (pre-DASH) path now: playurl with fnval
// 4048 answers every DASH audio track at once, so the modern path never asks
// for a quality. When there is no dash, `qn` still selects the muxed durl
// quality, and yt-dlp's `accept_quality` walk is the same knob. The mapping
// is the web player's:
//
//   app tier   qn   label
//   low        16   360P 流畅
//   normal     32   480P 清晰
//   high       64   720P 高清   (WEB default; works signed out)
//   lossless   80   1080P 高清  (TV/APP default; requires login)
//   hi-res     127  8K 超高清   (requires membership)
const QN_FOR_QUALITY = {
  low: 16,
  normal: 32,
  high: 64,
  lossless: 80,
  'hi-res': 127,
};
const QN_SIGNED_OUT_CAP = 64;
// The reverse map, for reporting a legacy durl's actual tier.
const TIER_FOR_QN = {
  16: 'low',
  32: 'normal',
  64: 'high',
  80: 'lossless',
  127: 'hi-res',
};

// yt-dlp's artist/space flow is an InAdvancePagedList with no ceiling; this
// source materialises `topTracks` in one call, so the walk is bounded.
const MAX_ARTIST_PAGES = 40;

// Python's `string.printable`, for the dm_img_str/dm_cover_img_str noise.
const PRINTABLE = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ \t\n\r\x0b\x0c';

// yt-dlp's BilibiliBaseIE.__screen_dimensions: a weighted pick the fingerprint
// script expects to see from a real browser.
const SCREEN_DIMENSIONS = [
  [[1920, 1080], 18],
  [[1366, 768], 18],
  [[1536, 864], 17],
  [[1280, 720], 8],
  [[2560, 1440], 7],
  [[1440, 900], 5],
  [[1600, 900], 5],
];

// One-line preview of a return value, for src.log. Long strings and objects
// are clipped so a search page full of rows does not flood the log buffer.
function previewValue(v, limit) {
  limit = limit || 240;
  var s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch (e) {
    s = String(v);
  }
  if (s === undefined) s = 'undefined';
  if (s.length > limit) s = s.slice(0, limit) + '…(' + s.length + ' chars)';
  return s;
}

function cleanTitle(s) {
  if (!s) {
    src.log('cleanTitle(' + previewValue(s) + ') → "" (empty input)');
    return '';
  }
  const str = String(s)
    .replace(/<em class="keyword">/g, '')
    .replace(/<\/em>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
  src.log('cleanTitle(' + previewValue(s) + ') → ' + previewValue(str));
  return str;
}

function cleanPic(pic) {
  if (!pic) {
    src.log('cleanPic → "" (empty input)');
    return '';
  }
  var out = pic.startsWith('http') ? pic : 'https:' + (pic.startsWith('//') ? '' : '//') + pic;
  src.log('cleanPic(' + previewValue(pic) + ') → ' + previewValue(out));
  return out;
}

function parseDuration(d) {
  if (d == null) {
    src.log('parseDuration(' + previewValue(d) + ') → 0 (empty input)');
    return 0;
  }
  if (typeof d === 'number') {
    var ms = Math.round(d * 1000);
    src.log('parseDuration(' + d + 's) → ' + ms + 'ms');
    return ms;
  }
  var parts = String(d).trim().split(':').map(p => parseInt(p, 10) || 0);
  if (parts.length === 3) {
    var ms3 = ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
    src.log('parseDuration("' + d + '") → ' + ms3 + 'ms');
    return ms3;
  }
  if (parts.length === 2) {
    var ms2 = ((parts[0] * 60) + parts[1]) * 1000;
    src.log('parseDuration("' + d + '") → ' + ms2 + 'ms');
    return ms2;
  }
  var ms1 = (parts[0] || 0) * 1000;
  src.log('parseDuration("' + d + '") → ' + ms1 + 'ms');
  return ms1;
}

/** A v4-shaped UUID; yt-dlp uses `uuid.uuid4()` for exactly this purpose. */
function randomUuid() {
  const h = src.crypto.randomHex(16);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
    ((parseInt(h[16], 16) & 0x3 | 0x8).toString(16)) + h.slice(17, 20) + '-' +
    h.slice(20, 32);
}

/**
 * buvid3, once per realm — BiliBiliSearchIE._search_results' bootstrap.
 *
 * Search (and much of the web API) is behind risk control that answers -412
 * to a cookieless client. yt-dlp sets `{uuid4}infoc` when the cookie is
 * absent; the request below does the same, and the cookie lands in the
 * source's own jar on the bare domain so every later api.bilibili.com call
 * carries it.
 */
async function ensureBuvid() {
  try {
    const existing = await src.cookie.get('buvid3');
    if (existing) return;
    const buvid = randomUuid() + 'infoc';
    // The bare domain, not api.bilibili.com — one jar entry covering every
    // bilibili.com subdomain the document talks to.
    await src.cookie.set('buvid3', buvid, 'https://www.bilibili.com');
    src.log('ensureBuvid → buvid3 ' + previewValue(buvid, 16) + '… set');
  } catch (e) {
    // Search may still work (or the next call retries); not fatal here.
    src.log('ensureBuvid → failed: ' + previewValue(String(e && e.message || e), 120));
  }
}

/**
 * The WBI mixin key, from the nav endpoint.
 *
 * BilibiliBaseIE._get_wbi_key caches it for 30 seconds; the source caches it
 * for an hour because the realm is per source and the keys rarely rotate.
 * A failure to read nav is reported rather than papered over: a wrong mixin
 * key signs a w_rid the server refuses (-403), which is harder to diagnose
 * than a thrown error naming nav.
 */
async function getWbiMixinKey() {
  const cached = src.cache.get('bili_wbi_mixin_key');
  if (cached) {
    src.log('getWbiMixinKey → cached key ' + previewValue(cached, 16) + '…');
    return String(cached);
  }

  const res = await src.get('https://api.bilibili.com/x/web-interface/nav', { headers: BROWSER_HEADERS });
  const json = src.parse.json(res.body);
  const wbi = json && json.data && json.data.wbi_img;
  if (!wbi || !wbi.img_url || !wbi.sub_url) {
    src.log('getWbiMixinKey → nav answered without wbi_img: ' + previewValue(res.body, 160));
    throw new Error('cannot read WBI keys from the nav endpoint');
  }
  const imgKey = wbi.img_url.slice(wbi.img_url.lastIndexOf('/') + 1, wbi.img_url.lastIndexOf('.'));
  const subKey = wbi.sub_url.slice(wbi.sub_url.lastIndexOf('/') + 1, wbi.sub_url.lastIndexOf('.'));
  const rawKey = imgKey + subKey;

  let mixinKey = '';
  for (let i = 0; i < 32; i++) {
    mixinKey += rawKey[WBI_ENC_TAB[i]] || '';
  }
  src.cache.put('bili_wbi_mixin_key', mixinKey, 3600000);
  src.log('getWbiMixinKey → new mixin key ' + previewValue(mixinKey, 16) + '…');
  return mixinKey;
}

/**
 * WBI signing, per docs/misc/sign/wbi.md and BilibiliBaseIE._sign_wbi.
 *
 * The step that is easy to lose: values are stripped of `!'()*` *before*
 * encoding, because that is what the server repeats before hashing — sign
 * the unfiltered value and every request answers -403.
 */
async function signWbiQuery(params) {
  const mixinKey = await getWbiMixinKey();
  const allParams = { ...params, wts: Math.floor(src.time.now() / 1000) };
  const pairs = [];
  for (const k of Object.keys(allParams).sort()) {
    const v = allParams[k];
    if (v === undefined || v === null) continue;
    const filtered = String(v).replace(/[!'()*]/g, '');
    pairs.push(src.url.encode(k) + '=' + src.url.encode(filtered));
  }
  const queryStr = pairs.join('&');
  const signed = queryStr + '&w_rid=' + src.crypto.md5(queryStr + mixinKey);
  src.log('signWbiQuery → ' + previewValue(signed));
  return signed;
}

/**
 * The dm_img_* request fingerprint — BilibiliBaseIE._dm_params.
 *
 * Bilibili's risk control compares these against the browser fingerprint it
 * expects; yt-dlp synthesises them (an empty dm_img_list, random printable
 * base64 noise for the two image strings, and a compact dm_img_inter built
 * from the same arithmetic the vendor script uses). Without them a playurl
 * or space request is materially more likely to be answered with -412.
 */
function dmParams() {
  const rand = (n) => Math.floor(Math.random() * n);
  const noise = (n) => {
    let out = '';
    for (let i = 0; i < n; i++) out += PRINTABLE[rand(PRINTABLE.length)];
    return out;
  };
  const getWh = (width, height) => {
    const rnd = Math.floor(114 * Math.random());
    return [2 * width + 2 * height + 3 * rnd, 4 * width - height + rnd, rnd];
  };
  const getOf = (scrollTop, scrollLeft) => {
    const rnd = Math.floor(514 * Math.random());
    return [3 * scrollTop + 2 * scrollLeft + rnd, 4 * scrollTop - 4 * scrollLeft + 2 * rnd, rnd];
  };
  let total = 0;
  for (const entry of SCREEN_DIMENSIONS) total += entry[1];
  let pick = Math.random() * total;
  let dimensions = SCREEN_DIMENSIONS[0][0];
  for (const entry of SCREEN_DIMENSIONS) {
    pick -= entry[1];
    if (pick < 0) {
      dimensions = entry[0];
      break;
    }
  }
  return {
    dm_img_list: '[]',
    dm_img_str: src.crypto.base64Encode(noise(16 + rand(49))).slice(0, -2),
    dm_cover_img_str: src.crypto.base64Encode(noise(32 + rand(97))).slice(0, -2),
    dm_img_inter: JSON.stringify({
      ds: [],
      wh: getWh(dimensions[0], dimensions[1]),
      of: getOf(rand(101), 0),
    }),
  };
}

/**
 * Video search — BiliBiliSearchIE._search_results.
 *
 * The parameters are yt-dlp's verbatim (Search_key and keyword are the same
 * value; the rest tell the backend this is the web client's own search
 * request). The endpoint is the unsigned one: the buvid3 bootstrap above is
 * what risk control checks, and yt-dlp never WBI-signs search.
 */
async function biliSearchUrl(key, page) {
  await ensureBuvid();
  const params = {
    Search_key: key,
    keyword: key,
    page: page || 1,
    context: '',
    duration: 0,
    tids_2: '',
    __refresh__: 'true',
    search_type: 'video',
    tids: 0,
    highlight: 1,
  };
  const query = Object.keys(params)
    .map((k) => src.url.encode(k) + '=' + src.url.encode(params[k]))
    .join('&');
  const url = 'https://api.bilibili.com/x/web-interface/search/type?' + query;
  src.log('biliSearchUrl("' + previewValue(key) + '", ' + (page || 1) + ') → ' + url);
  return url;
}

/**
 * The user half of search, per docs/search/search_request.md's 分类搜索:
 * same endpoint and the same parameter set, `search_type=bili_user`. Rows are
 * UP主 (mid, uname, upic), which the artist rules map onto the artist page.
 * bilibili.py has no user search; the video half above it does.
 */
async function biliUserSearchUrl(key, page) {
  await ensureBuvid();
  const params = {
    Search_key: key,
    keyword: key,
    page: page || 1,
    context: '',
    duration: 0,
    tids_2: '',
    __refresh__: 'true',
    search_type: 'bili_user',
    tids: 0,
    highlight: 1,
  };
  const query = Object.keys(params)
    .map((k) => src.url.encode(k) + '=' + src.url.encode(params[k]))
    .join('&');
  const url = 'https://api.bilibili.com/x/web-interface/search/type?' + query;
  src.log('biliUserSearchUrl("' + previewValue(key) + '", ' + (page || 1) + ') → ' + url);
  return url;
}

/**
 * The audio-area charts, per docs/audio/rank.md (music.bilibili.com/pc/rank).
 * No counterpart in bilibili.py — kept as the source's browse surface.
 *
 * Browse is two stages deep, so the four sections carry both shapes the
 * toplist API answers with: 当期 sections point straight at the current
 * issue's song list, and 每期 sections point at the period list whose rows
 * descend into the same song list for their own issue. The latest issue id
 * needs a fetch to know, so this runs at browse time (cached briefly), not
 * at import.
 */
async function biliExploreUrl() {
  await ensureBuvid();
  const cached = src.cache.get('bili_explore_sections');
  if (cached) return cached;

  const charts = [
    { listType: 1, name: '音乐热榜' },
    { listType: 2, name: '原创音乐榜' },
  ];
  const sections = [];
  for (const chart of charts) {
    let latestId;
    try {
      const res = await src.get('https://api.bilibili.com/x/copyright-music-publicity/toplist/all_period?list_type=' + chart.listType, { headers: BROWSER_HEADERS });
      const list = src.parse.json(res.body)?.data?.list || {};
      // Years iterate ascending on numeric-like keys; the newest issue is
      // the one with the greatest publish time across all of them.
      let newest = 0;
      for (const year of Object.keys(list)) {
        for (const period of list[year] || []) {
          if ((period.publish_time || 0) >= newest) {
            newest = period.publish_time || 0;
            latestId = period.ID;
          }
        }
      }
    } catch (e) {
      src.log('biliExploreUrl(' + chart.name + ') → all_period failed: ' + previewValue(String(e && e.message || e), 120));
    }
    if (latestId) {
      sections.push({ title: chart.name + '·当期', url: 'https://api.bilibili.com/x/copyright-music-publicity/toplist/music_list?list_id=' + latestId });
    }
    sections.push({ title: chart.name + '·每期', url: 'https://api.bilibili.com/x/copyright-music-publicity/toplist/all_period?list_type=' + chart.listType });
  }

  const out = JSON.stringify(sections);
  src.cache.put('bili_explore_sections', out, 600000);
  src.log('biliExploreUrl → ' + previewValue(out));
  return out;
}

/** The bvid a chart row plays through — its MV, else the video it is known from. */
function biliChartBvid(item) {
  return item.mv_bvid || item.creation_bvid || '';
}

/**
 * Rows for both documents the chart API answers with.
 *
 * `toplist/all_period` returns the issue list as an object keyed by year
 * (ascending on numeric keys, so it is re-sorted newest first — the current
 * issue must be the first row a user sees); `toplist/music_list` returns one
 * issue's songs. Rows without an mv/creation bvid are skipped: the audio
 * behind them has no usable stream without a login-backed entitlement route,
 * and a row that cannot play is worse than a shorter chart.
 */
function biliExploreRows(result) {
  const data = result && result.data ? result.data : {};
  const list = data.list;
  if (Array.isArray(list)) {
    const rows = [];
    for (const item of list) {
      const bvid = biliChartBvid(item);
      if (!bvid) continue;
      rows.push({
        kind: 'track',
        trackId: bvid,
        bvid: bvid,
        title: item.music_title || item.creation_title || bvid,
        artist: item.singer || item.creation_nickname || '',
        album: item.album || '',
        artwork: item.mv_cover || item.creation_cover || '',
        durationMs: item.creation_duration ? item.creation_duration * 1000 : undefined,
      });
    }
    src.log('biliExploreRows → ' + rows.length + ' song row(s) of ' + list.length);
    return rows;
  }

  const periods = [];
  for (const year of Object.keys(list || {})) {
    for (const period of list[year] || []) {
      periods.push({ year: year, period: period });
    }
  }
  periods.sort((a, b) => (b.period.publish_time || 0) - (a.period.publish_time || 0));
  const rows = periods.map(({ year, period }) => ({
    kind: 'folder',
    trackId: 'bili_toplist_' + period.ID,
    title: (year ? year + '年 ' : '') + '第' + period.priod + '期',
    childUrl: 'https://api.bilibili.com/x/copyright-music-publicity/toplist/music_list?list_id=' + period.ID,
  }));
  src.log('biliExploreRows → ' + rows.length + ' issue row(s)');
  return rows;
}

/** The bvid, from wherever the row kept it. `track.id` is the URN segment, which the search rules already make the bvid. */
function trackBvid(track) {
  return String(track.bvid || track.onlineId || track.id || '').replace(/^bili_video_/, '');
}

/**
 * The cid of a video's first page, cached per realm.
 *
 * DASH is per-page and every playurl/lyric call needs one, so the cache is
 * what keeps a track from costing an extra round trip on both resolve and
 * lyric fetch. yt-dlp reads the cid from the page's `__INITIAL_STATE__`
 * (`videoData.pages[part-1].cid`) and falls back to `x/player/pagelist` for
 * anthologies; a source never downloads the page, so pagelist is the flow.
 */
async function ensureCid(track) {
  if (track.cid) return track.cid;
  const bvid = trackBvid(track);
  const cacheKey = 'bili_cid_' + bvid;
  const cached = src.cache.get(cacheKey);
  if (cached) return cached;
  try {
    const res = await src.get('https://api.bilibili.com/x/player/pagelist?bvid=' + src.url.encode(bvid) + '&jsonp=jsonp', { headers: BROWSER_HEADERS });
    const json = src.parse.json(res.body);
    const cid = json && json.data && json.data[0] && json.data[0].cid;
    if (cid) {
      src.cache.put(cacheKey, cid, 3600000);
      src.log('ensureCid(' + bvid + ') → ' + cid);
      return cid;
    }
    src.log('ensureCid(' + bvid + ') → pagelist answered without cid: ' + previewValue(res.body, 160));
  } catch (e) {
    src.log('ensureCid(' + bvid + ') → failed: ' + previewValue(String(e && e.message || e), 120));
  }
  return undefined;
}

/** Whether this realm holds a session — what playurl's try_look turns on. */
async function biliSignedIn() {
  try {
    const sess = await src.cookie.get('SESSDATA');
    return !!(sess && String(sess).trim());
  } catch (e) {
    return false;
  }
}

/**
 * One playurl request — BilibiliBaseIE._download_playinfo.
 *
 * `fnval` is pinned at 4048 exactly as yt-dlp pins it: the standard DASH set
 * (4K, HDR, Dolby, Dolby Vision, AV1) minus Hi-Res' bit 4096, which is what
 * most often makes Bilibili answer `-400 请求错误`. The dm_* fingerprint
 * params ride along, and `try_look=1` (the preview flag) is added by the
 * caller when signed out and dropped here when signed in, mirroring
 * `if self.is_logged_in: params.pop('try_look', None)`.
 *
 * Error codes are normalised as yt-dlp normalises them: the negative Bilibili
 * code times -1, so `-400` reports as 400, `-401`/`-352` are expected
 * ("please wait and try later") and everything else is a plain failure.
 */
async function fetchBiliPlayurl(bvid, cid, query, signedIn) {
  const params = {
    bvid: bvid,
    cid: cid,
    fnval: 4048,
    ...dmParams(),
    ...(query || {}),
  };
  if (signedIn) delete params.try_look;
  const signedQuery = await signWbiQuery(params);
  const res = await src.get('https://api.bilibili.com/x/player/wbi/playurl?' + signedQuery, { headers: BROWSER_HEADERS });
  const json = src.parse.json(res.body);
  const code = Number(json.code) * -1;
  if (code === 0) return json.data;
  let msg = 'Unable to download video info: ' + code + (json.message ? ': ' + json.message : '');
  if (code === 401 || code === 352) msg += ', please wait and try later';
  throw new Error(msg);
}

/**
 * Every DASH audio candidate in the response — BilibiliBaseIE.extract_formats'
 * collection order. `dash.audio` first, then Dolby, then FLAC appended last.
 *
 * `format` is classified from the codecs string; `qTier` from the id's web
 * label (AUDIO_TIERS). Dolby is flagged undecodable because Chromium cannot
 * decode E-AC-3 — it is reported, never selected.
 */
function collectBiliAudios(dash) {
  const audios = [];
  const push = (a, fallbackTier, undecodable) => {
    if (!a) return;
    const id = a.id || a.new_id;
    const codecs = String(a.codecs || '').toLowerCase();
    const format = codecs.includes('flac') ? 'flac' : codecs.includes('ec-3') || codecs.includes('eac3') ? 'eac3' : 'm4a';
    audios.push({ ...a, format, qTier: AUDIO_TIERS[id] || fallbackTier || 'normal', undecodable: undecodable === true });
  };
  for (const a of dash.audio || []) push(a);
  for (const a of (dash.dolby && dash.dolby.audio) || []) push(a, 'lossless', true);
  const flac = dash.flac && dash.flac.audio;
  if (flac) push(flac, 'hi-res');
  return audios;
}

/** The best candidate for the requested tier, decoded formats only. */
function selectBiliAudio(audios, prefs) {
  let candidates = audios.filter((a) => !a.undecodable);
  if (prefs && Array.isArray(prefs.acceptFormats) && prefs.acceptFormats.length > 0) {
    const accepted = candidates.filter((a) => prefs.acceptFormats.some((fmt) => a.format === String(fmt).toLowerCase()));
    if (accepted.length > 0) candidates = accepted;
  }

  const ladder = AUDIO_LADDER[prefs && prefs.quality] || AUDIO_LADDER.high;
  for (const tier of ladder) {
    const chosen = candidates.filter((a) => a.qTier === tier).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    if (chosen) return chosen;
  }
  // Nothing on the ladder (an unknown tier set) — fall back to bitrate,
  // still skipping what cannot be decoded.
  return candidates.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
}

/**
 * The audio stream, per BilibiliBaseIE._download_playinfo and BiliBiliIE.
 *
 * yt-dlp reads `window.__playinfo__` from the video page when logged in and
 * only then falls back to the API with `try_look=1`. A source never
 * downloads the page (no HTML metadata step), so the API branch is the whole
 * flow: signed out, the first request carries try_look=1.
 *
 * When the response carries `dash`, every audio track is already in it —
 * across tiers — so the app's tier ladder picks the one `prefs.quality`
 * asked for without a second request. When it does not, the video is
 * pre-DASH: durl is the stream and `accept_quality` is what it could be;
 * yt-dlp re-asks each qn, the source asks once for the qn its tier maps to.
 */
async function resolveBiliStream(track, prefs) {
  const bvid = trackBvid(track);
  if (!bvid) {
    src.log('resolveBiliStream → no bvid in track ' + previewValue(track, 160) + ' — throwing');
    throw new Error('cannot resolve a Bilibili stream without a bvid');
  }
  const cid = track.cid || await ensureCid(track);
  if (!cid) {
    src.log('resolveBiliStream: no cid for bvid ' + bvid + ' — throwing');
    throw new Error('cannot resolve cid for bvid ' + bvid);
  }

  const signedIn = await biliSignedIn();
  src.log('resolveBiliStream(' + bvid + ') → ' + (signedIn ? 'signed in' : 'signed out, try_look=1') +
    ', quality=' + (prefs && prefs.quality || 'default'));
  let data = await fetchBiliPlayurl(bvid, cid, signedIn ? {} : { try_look: 1 }, signedIn);

  if (!data.dash) {
    // Legacy (pre-DASH) path. The response's own `quality` is the default
    // ask; move it to this app tier's qn when the video offers it.
    const accept = (data.accept_quality || []).map(Number);
    let qn = QN_FOR_QUALITY[prefs && prefs.quality] || 64;
    if (!signedIn) qn = Math.min(qn, QN_SIGNED_OUT_CAP);
    if (accept.length > 0 && accept.indexOf(qn) < 0) {
      const offered = accept.filter((v) => v <= qn);
      qn = offered.length ? Math.max.apply(null, offered) : Math.max.apply(null, accept);
    }
    if (Number(data.quality) !== qn) {
      data = await fetchBiliPlayurl(bvid, cid, { qn: qn }, signedIn);
    }
    if (!data.dash) {
      const durl = data.durl || [];
      if (durl.length === 0) {
        src.log('resolveBiliStream(' + bvid + ') → no dash and no durl — throwing');
        throw new Error('No playable audio stream returned from Bilibili');
      }
      if (durl.length > 1) {
        // yt-dlp's `multi_video` workaround: these fragments are the parts of
        // one flv stream, and one ruleStream URL cannot carry all of them.
        throw new Error('legacy Bilibili stream is split into ' + durl.length +
          ' flv fragments, which one stream URL cannot represent');
      }
      const url = durl[0].url;
      const quality = TIER_FOR_QN[Number(data.quality)] || '';
      const bitrateKbps = durl[0].size && durl[0].length ? Math.round(durl[0].size * 8 / durl[0].length) : '';
      src.cache.put('bili_stream_' + bvid, JSON.stringify({ quality: quality, bitrateKbps: bitrateKbps }), 7200000);
      src.log('resolveBiliStream(' + bvid + ') → legacy durl ' + previewValue(url) + ' [' + (quality || '?') + '/' + data.quality + ']');
      return url;
    }
  }

  const chosen = selectBiliAudio(collectBiliAudios(data.dash), prefs);
  const url = chosen && (chosen.baseUrl || chosen.base_url ||
    (chosen.backupUrl && chosen.backupUrl[0]) || (chosen.backup_url && chosen.backup_url[0]));
  if (!url) {
    src.log('resolveBiliStream(' + bvid + ') → no audio stream in response — throwing');
    throw new Error('No playable audio stream returned from Bilibili');
  }
  // What the app gets to see: the tier this resolve served and its nominal
  // bitrate. Kept in the realm's cache because `ruleStream.quality` and
  // `.bitrateKbps` are rendered as separate rules after the URL, and
  // answering them by re-running playurl would be a second round trip per
  // playback. Same window as the signed URL itself.
  src.cache.put('bili_stream_' + bvid, JSON.stringify({
    quality: chosen.qTier,
    bitrateKbps: Math.round((chosen.bandwidth || 0) / 1000),
  }), 7200000);
  src.log('resolveBiliStream(' + bvid + ') → ' + previewValue(url) + ' [' + (chosen.qTier || '?') + '/' + (chosen.format || '?') + ']');
  return url;
}

/**
 * The tier and bitrate the last resolve chose for a track.
 *
 * `ruleStream.quality` / `.bitrateKbps` are rendered after `ruleStream.url`
 * and cannot re-derive the choice without a second playurl request, so the URL
 * rule leaves its answer in `src.cache`. Empty string means "not resolved in
 * this realm", which the runtime reads as the field being absent.
 */
function lastBiliStream(track) {
  const raw = src.cache.get('bili_stream_' + trackBvid(track));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function biliStreamQuality(track) {
  const last = lastBiliStream(track);
  return last && last.quality ? String(last.quality) : '';
}

function biliStreamBitrate(track) {
  const last = lastBiliStream(track);
  return last && last.bitrateKbps ? String(last.bitrateKbps) : '';
}

/**
 * Subtitles as LRC — BilibiliBaseIE._get_subtitles.
 *
 * The endpoint is `x/player/wbi/v2` and yt-dlp calls it unsigned, with
 * `aid`+`cid` when the aid is known and `bvid`+`cid` otherwise; the source
 * does the same. The response may say `need_login_subtitle` (CC tracks are
 * login-only) and that is logged rather than silently read as "no lyrics".
 */
async function getBiliLyrics(track) {
  const bvid = trackBvid(track);
  if (!bvid) {
    src.log('getBiliLyrics → no bvid in track — returning ""');
    return '';
  }
  const cid = track.cid || await ensureCid(track);
  if (!cid) {
    src.log('getBiliLyrics(' + bvid + ') → "" (no cid)');
    return '';
  }

  const params = track.aid
    ? 'aid=' + src.url.encode(String(track.aid)) + '&cid=' + src.url.encode(String(cid))
    : 'bvid=' + src.url.encode(bvid) + '&cid=' + src.url.encode(String(cid));
  const res = await src.get('https://api.bilibili.com/x/player/wbi/v2?' + params, { headers: BROWSER_HEADERS });
  const json = src.parse.json(res.body);
  if (json.code !== 0) {
    src.log('getBiliLyrics(' + bvid + ') → "" (v2 code ' + json.code + ': ' + previewValue(json.message) + ')');
    return '';
  }
  const videoInfo = json.data || {};
  if (videoInfo.need_login_subtitle) {
    src.log('getBiliLyrics(' + bvid + ') → subtitles need a login; the anonymous list may be empty');
  }
  const subtitles = (videoInfo.subtitle && videoInfo.subtitle.subtitles) || [];
  const usable = subtitles.filter((s) => s && s.subtitle_url && s.lan);
  if (usable.length === 0) {
    src.log('getBiliLyrics(' + bvid + ') → "" (video has no subtitles)');
    return '';
  }

  // A video can carry an uploaded CC track and an AI-generated one for the
  // same language; the uploaded one is the author's text, the AI one a guess.
  const isZh = (s) => String(s.lan || '').toLowerCase().indexOf('zh') === 0;
  const isAi = (s) => /^ai/i.test(String(s.lan || ''));
  const chosen = usable.find((s) => isZh(s) && !isAi(s)) || usable.find(isZh) || usable[0];
  const subUrl = chosen.subtitle_url;
  src.log('getBiliLyrics(' + bvid + ') → subtitle lan=' + previewValue(chosen.lan) + ' of ' + usable.length);

  const fullUrl = subUrl.startsWith('//') ? 'https:' + subUrl : subUrl;
  const contentRes = await src.get(fullUrl, { headers: BROWSER_HEADERS });
  const body = src.parse.json(contentRes.body)?.body;
  if (!Array.isArray(body)) {
    src.log('getBiliLyrics(' + bvid + ') → "" (subtitle body is not a list)');
    return '';
  }

  const lrc = body
    .filter((item) => item && typeof item.from === 'number')
    .map((item) => {
      const mins = Math.floor(item.from / 60).toString().padStart(2, '0');
      const secs = (item.from % 60).toFixed(2).padStart(5, '0');
      return '[' + mins + ':' + secs + ']' + (item.content || '');
    })
    .join('\n');
  src.log('getBiliLyrics(' + bvid + ') → ' + body.length + ' line(s)');
  return lrc;
}

async function getBiliQrCode() {
  const res = await src.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', { headers: BROWSER_HEADERS });
  const data = src.parse.json(res.body);
  if (data.code !== 0 || !data.data) {
    src.log('getBiliQrCode → failed: ' + (data.message || data.code));
    throw new Error('Failed to generate Bilibili QR code: ' + (data.message || data.code));
  }
  src.log('getBiliQrCode → qr key ' + previewValue(data.data.qrcode_key));
  return {
    url: data.data.url,
    key: data.data.qrcode_key,
  };
}

async function pollBiliQrCode(key) {
  const res = await src.get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(key), { headers: BROWSER_HEADERS });
  const json = src.parse.json(res.body);
  const data = json?.data;
  const pollCode = data?.code;
  if (pollCode === 0) {
    // SESSDATA/bili_jct arrive as Set-Cookie on this response and land in the
    // source's jar on their own; only the refresh token needs storing.
    src.log('pollBiliQrCode → confirmed');
    return {
      state: 'confirmed',
      token: data.refresh_token,
      refresh_token: data.refresh_token,
    };
  } else if (pollCode === 86038) {
    src.log('pollBiliQrCode → expired');
    return { state: 'expired' };
  } else if (pollCode === 86090) {
    src.log('pollBiliQrCode → scanned, waiting for confirm');
    return { state: 'scanned' };
  } else {
    src.log('pollBiliQrCode → pending (code ' + pollCode + ')');
    return { state: 'pending' };
  }
}

// Cookie refresh, per docs/login/refresh/Cookie.md. The correspond page's RSA
// key is fixed; OAEP-SHA256 and a hex ciphertext are what the server repeats.
const REFRESH_PUBKEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg',
  'Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71',
  'nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40',
  'JNrRuoEUXpabUzGB8QIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');

async function refreshBiliCookie() {
  const refreshToken = (await src.vars.get('refresh_token')) || (await src.vars.get('bili_refresh_token'));
  if (!refreshToken) {
    src.log('refreshBiliCookie → no refresh_token in vars — throwing');
    throw new Error('No refresh_token found');
  }

  // 1. Is a refresh due, and what timestamp signs the correspond path?
  const infoRes = await src.get('https://passport.bilibili.com/x/passport-login/web/cookie/info', { headers: BROWSER_HEADERS });
  const info = src.parse.json(infoRes.body);
  if (info.code !== 0 || !info.data?.timestamp) {
    src.log('refreshBiliCookie → cookie/info failed: ' + (info.message || info.code));
    throw new Error('cookie/info check failed: ' + (info.message || info.code));
  }

  // 2. correspond_path = RSA-OAEP-SHA256("refresh_" + timestamp), lowercase hex.
  const correspondPath = src.crypto.rsaOaepEncrypt('refresh_' + info.data.timestamp, REFRESH_PUBKEY);

  // 3. The correspond page carries the refresh_csrf for this device.
  const correspondRes = await src.get('https://www.bilibili.com/correspond/1/' + correspondPath, { headers: BROWSER_HEADERS });
  const match = correspondRes.body.match(/<div id="1-name">\s*([\s\S]*?)\s*<\/div>/);
  if (!match) {
    src.log('refreshBiliCookie → refresh_csrf not found in correspond page');
    throw new Error('refresh_csrf not found in correspond page');
  }
  const refreshCsrf = match[1].trim();

  // 4. Refresh. New SESSDATA/bili_jct land in the jar via Set-Cookie; the
  //    response body carries the *new* refresh_token, which the old one is
  //    replaced by.
  const csrf = (await src.cookie.get('bili_jct')) || '';
  const refreshRes = await src.post(
    'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
    'csrf=' + src.url.encode(csrf) +
      '&refresh_csrf=' + src.url.encode(refreshCsrf) +
      '&source=main_web' +
      '&refresh_token=' + src.url.encode(refreshToken),
    { headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const refreshed = src.parse.json(refreshRes.body);
  if (refreshed.code !== 0) {
    src.log('refreshBiliCookie → refresh failed: ' + (refreshed.message || refreshed.code));
    throw new Error('Cookie refresh failed: ' + (refreshed.message || refreshed.code));
  }
  const newRefreshToken = refreshed.data?.refresh_token;
  if (newRefreshToken) {
    await src.vars.put('refresh_token', newRefreshToken);
  }

  // 5. Confirm — with the *new* csrf and the *old* refresh token, or the new
  //    cookies stay provisional and the next restart is logged out again.
  const newCsrf = (await src.cookie.get('bili_jct')) || csrf;
  await src.post(
    'https://passport.bilibili.com/x/passport-login/web/confirm/refresh',
    'csrf=' + src.url.encode(newCsrf) + '&refresh_token=' + src.url.encode(refreshToken),
    { headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  src.log('refreshBiliCookie → refreshed' + (newRefreshToken ? ' (new token stored)' : ' (kept existing token)'));
  return {
    token: newRefreshToken || refreshToken,
    refresh_token: newRefreshToken || refreshToken,
  };
}

/**
 * The uploader name off a space page — BilibiliSpaceListBaseIE._get_uploader.
 *
 * HTML, not an API: used only when a collection/series response carries no
 * owner, and fatal=False in yt-dlp — an empty name is better than failing the
 * playlist over a missing title tag.
 */
async function getBiliUploader(uid) {
  try {
    const res = await src.get('https://space.bilibili.com/' + src.url.encode(String(uid)), { headers: BROWSER_HEADERS });
    const match = res.body.match(/<title\b[^>]*>([^<]+)的个人空间-/);
    return match ? match[1].trim() : '';
  } catch (e) {
    return '';
  }
}

/**
 * One page of an upper's uploads — BilibiliSpaceVideoIE's fetch_page.
 *
 * The parameter set is yt-dlp's verbatim (keyword/order_avoided/platform/
 * tid/web_location/special_type/index + dm_*), WBI-signed, with the Referer
 * and Origin of a video list page. The error table is yt-dlp's: HTTP 412 and
 * codes -401/-352 are named as blocked/rejected rather than surfacing as an
 * empty list.
 */
async function fetchBiliSpacePage(uid, pn) {
  const params = {
    keyword: '',
    mid: String(uid),
    order: 'pubdate',
    order_avoided: 'true',
    platform: 'web',
    pn: pn,
    ps: 30,
    tid: 0,
    web_location: '333.1387',
    special_type: '',
    index: 0,
    ...dmParams(),
  };
  const query = await signWbiQuery(params);
  const res = await src.get('https://api.bilibili.com/x/space/wbi/arc/search?' + query, {
    headers: {
      ...BROWSER_HEADERS,
      Referer: 'https://space.bilibili.com/' + uid + '/video',
      Origin: 'https://space.bilibili.com',
      'Accept-Language': 'en,zh-CN;q=0.9,zh;q=0.8',
    },
  });
  if (res.status === 412) {
    throw new Error('Request is blocked by server (412), please wait and try later.');
  }
  const json = src.parse.json(res.body);
  if (json.code === -401) {
    throw new Error('Request is blocked by server (401), please wait and try later.');
  } else if (json.code === -352) {
    throw new Error('Request is rejected by server (352)');
  } else if (json.code !== 0) {
    throw new Error('Request failed (' + json.code + '): ' + (json.message || 'Unknown error'));
  }
  return json.data || {};
}

async function getBiliArtist(id) {
  const uid = String(id);
  let name = uid;
  let face = '';
  let sign = '';
  try {
    const cardRes = await src.get('https://api.bilibili.com/x/web-interface/card?mid=' + src.url.encode(uid), { headers: BROWSER_HEADERS });
    const cardData = src.parse.json(cardRes.body)?.data?.card;
    if (cardData) {
      name = cardData.name || uid;
      face = cleanPic(cardData.face || '');
      sign = cardData.sign || '';
    }
  } catch (e) {}

  let albums = [];
  try {
    const seasonsRes = await src.get('https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid=' + src.url.encode(uid) + '&page_num=1&page_size=20', { headers: BROWSER_HEADERS });
    const itemsLists = src.parse.json(seasonsRes.body)?.data?.items_lists;
    const seasons = itemsLists?.seasons_list || [];
    const series = itemsLists?.series_list || [];
    for (const s of seasons) {
      const meta = s.meta || s;
      // The mid rides in the id: seasons_archives_list needs the owner's mid
      // alongside the season id, and an id that does not carry it cannot
      // produce a valid playlist call later.
      albums.push({
        id: 'bili_season_' + uid + '_' + (meta.season_id || meta.id),
        title: meta.name || '',
        artwork: cleanPic(meta.cover || ''),
        trackCount: meta.total,
      });
    }
    for (const s of series) {
      const meta = s.meta || s;
      albums.push({
        id: 'bili_series_' + uid + '_' + (meta.series_id || meta.id),
        title: meta.name || '',
        artwork: cleanPic(meta.cover || ''),
        trackCount: meta.total,
      });
    }
  } catch (e) {}

  // The uploads walk — BilibiliSpaceVideoIE. Pages are bounded because the
  // artist rule returns one materialised list; yt-dlp pages lazily instead.
  const topTracks = [];
  try {
    const first = await fetchBiliSpacePage(uid, 1);
    const pageInfo = first.page || {};
    const ps = pageInfo.ps || 30;
    const total = pageInfo.count || 0;
    const pageCount = Math.min(MAX_ARTIST_PAGES, Math.max(1, Math.ceil(total / ps)));
    let vlist = (first.list && first.list.vlist) || [];
    for (let pn = 1; pn <= pageCount && vlist.length > 0; pn++) {
      for (const entry of vlist) {
        if (entry.meta && Number(entry.meta.attribute) === 156) {
          // A hidden-mode collection does not show its videos in uploads;
          // yt-dlp extracts it as a playlist instead, and this source exposes
          // it as an album beside the seasons and series above.
          const meta = entry.meta;
          albums.push({
            id: 'bili_season_' + uid + '_' + meta.id,
            title: cleanTitle(meta.title || entry.title || ''),
            artwork: cleanPic(meta.cover || entry.pic || ''),
            trackCount: meta.total,
          });
          continue;
        }
        if (!entry.bvid) continue;
        topTracks.push({
          id: entry.bvid,
          bvid: entry.bvid,
          title: cleanTitle(entry.title || ''),
          artwork: cleanPic(entry.pic || ''),
          duration: entry.length,
          durationMs: parseDuration(entry.length),
        });
      }
      src.log('getBiliArtist(' + uid + ') → arc/search page ' + pn + '/' + pageCount + ': ' +
        vlist.length + ' row(s), ' + topTracks.length + ' track(s)');
      if (pn < pageCount) {
        const next = await fetchBiliSpacePage(uid, pn + 1);
        vlist = (next.list && next.list.vlist) || [];
      }
    }
  } catch (e) {
    src.log('getBiliArtist(' + uid + ') → arc/search failed: ' + previewValue(String(e && e.message || e), 160));
  }

  const artist = {
    name,
    bio: sign,
    artwork: face,
    albums,
    topTracks,
  };
  src.log('getBiliArtist(' + uid + ') → ' + albums.length + ' album(s), ' + topTracks.length + ' track(s), name=' + previewValue(name));
  return artist;
}

/**
 * The `window.__INITIAL_STATE__` object out of a Bilibili player page.
 *
 * BilibiliBaseIE parses the same object with `_search_json`; the source walks
 * the braces itself (a marker, then balanced braces with string awareness)
 * instead of regex-matching a non-greedy run, because the object nests and a
 * lazy match can cut it mid-value.
 */
function extractInitialState(html) {
  const marker = /window\.__INITIAL_STATE__\s*=\s*/.exec(html);
  if (!marker) return null;
  let start = marker.index + marker[0].length;
  while (start < html.length && /\s/.test(html[start])) start++;
  if (html[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

/** The initial state of a player page, cached per realm (one playlist walk). */
async function getBiliInitialState(url) {
  const cacheKey = 'bili_initial_' + url;
  const cached = src.cache.get(cacheKey);
  if (cached) return cached;
  const res = await src.get(url, { headers: BROWSER_HEADERS });
  const state = extractInitialState(res.body);
  if (!state) {
    throw new Error('Unable to extract initial state from ' + url);
  }
  src.cache.put(cacheKey, state, 300000);
  return state;
}

/**
 * What a playlist id names, wherever the user got it from.
 *
 * Besides the document's own `bili_*` ids, a fav folder or a collection is
 * often at hand as a bare number (the fav mlid) or as a URL copied from the
 * browser — `favlist?fid=…`, `channel/collectiondetail…sid=…`,
 * `channel/seriesdetail…sid=…`, `/lists/<sid>?type=…`. The URL patterns are
 * yt-dlp's `_VALID_URL` patterns for the four list extractors, and each
 * spelling lands on the flow yt-dlp uses for it.
 *
 * `bilibili.com/list/…` and `medialist/play/…` are BilibiliPlaylistIE: the
 * entity is whatever the page's `__INITIAL_STATE__` says it is, so these are
 * carried as a `medialist` target with the page URL and resolved at fetch
 * time. A bare season id is the one shape that cannot be honoured: the
 * archives call needs the owner's mid alongside it, and a season id alone
 * does not carry one (verified: a mismatched mid answers -404).
 */
function parsePlaylistTarget(raw) {
  const sid = String(raw || '').trim();

  const medialistUrl = sid.match(/(?:www\.)?bilibili\.com\/(?:list|medialist\/play)\/(\w+)/);
  if (medialistUrl) return { kind: 'medialist', url: sid, id: medialistUrl[1] };

  // The canonical id this source hands back for a medialist — `getPlaylist`
  // is called with it on the next page, so it must parse without the URL.
  const medialistId = sid.match(/^bili_medialist_(\d+)_(\d+)$/);
  if (medialistId) return { kind: 'medialist', canonicalId: sid, type: Number(medialistId[1]), id: medialistId[2] };

  const collectMatch = sid.match(/(?:^bili_collect_)(\d+)$/) || sid.match(/^(\d+)$/);
  if (collectMatch) return { kind: 'collect', id: collectMatch[1] };

  const seasonMatch =
    sid.match(/space\.bilibili\.com\/(\d+)\/channel\/collectiondetail\?.*?sid=(\d+)/) ||
    sid.match(/space\.bilibili\.com\/(\d+)\/lists\/(\d+)(?![^#]*\btype=series)/) ||
    sid.match(/^bili_season_(\d+)_(\d+)$/);
  if (seasonMatch) return { kind: 'season', mid: seasonMatch[1], id: seasonMatch[2] };
  if (/^bili_season_\d+$/.test(sid)) {
    throw new Error('season id "' + sid + '" carries no mid — open it again from the artist page, or paste the space.bilibili.com collectiondetail URL');
  }

  const seriesMatch =
    sid.match(/space\.bilibili\.com\/(\d+)\/(?:channel\/)?seriesdetail\?.*?sid=(\d+)/) ||
    sid.match(/space\.bilibili\.com\/(\d+)\/lists\/(\d+)[^#]*\btype=series/) ||
    sid.match(/^bili_series_(\d+)_(\d+)$/);
  if (seriesMatch) return { kind: 'series', mid: seriesMatch[1], id: seriesMatch[2] };

  const favMatch = sid.match(/space\.bilibili\.com\/\d+\/favlist\?.*?fid=(\d+)/);
  if (favMatch) return { kind: 'collect', id: favMatch[1] };

  return null;
}

function seasonPlaylist(mid, seasonId, data, pn, ps) {
  const meta = data.meta || {};
  const archives = data.archives || [];
  const total = (data.page && data.page.total) || archives.length;
  const hasMore = pn * ps < total;
  return {
    id: 'bili_season_' + mid + '_' + seasonId,
    name: meta.name || '',
    artwork: cleanPic(meta.cover || ''),
    description: meta.description || '',
    owner: (meta.owner && meta.owner.name) || (archives[0] && archives[0].owner && archives[0].owner.name) || '',
    items: archives.map((a) => ({
      id: a.bvid,
      bvid: a.bvid,
      title: cleanTitle(a.title || ''),
      duration: a.duration,
      cover: cleanPic(a.pic || ''),
      artist: (a.owner && a.owner.name) || (meta.owner && meta.owner.name) || '',
    })),
    hasMore,
    cursor: hasMore ? String(pn + 1) : undefined,
    trackCount: total,
  };
}

function seriesPlaylist(mid, seriesId, meta, data, pn, ps) {
  const info = meta || data.meta || {};
  const archives = data.archives || [];
  const total = (data.page && data.page.total) || archives.length;
  const hasMore = pn * ps < total;
  return {
    id: 'bili_series_' + mid + '_' + seriesId,
    name: info.name || '',
    artwork: cleanPic(info.cover || ''),
    description: info.description || '',
    owner: (archives[0] && archives[0].owner && archives[0].owner.name) || '',
    items: archives.map((a) => ({
      id: a.bvid,
      bvid: a.bvid,
      title: cleanTitle(a.title || ''),
      duration: a.duration,
      cover: cleanPic(a.pic || ''),
      artist: (a.owner && a.owner.name) || '',
    })),
    hasMore,
    cursor: hasMore ? String(pn + 1) : undefined,
    trackCount: total,
  };
}

async function fetchBiliSeasonPlaylist(mid, seasonId, pn, ps) {
  const referer = 'https://space.bilibili.com/' + mid + '/channel/collectiondetail?sid=' + seasonId;
  const res = await src.get(
    'https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=' + src.url.encode(mid) +
      '&season_id=' + src.url.encode(seasonId) + '&page_num=' + pn + '&page_size=' + ps,
    { headers: { ...BROWSER_HEADERS, Referer: referer } },
  );
  const json = src.parse.json(res.body);
  if (json.code !== 0) {
    throw new Error('collection ' + seasonId + ' failed: ' + (json.message || json.code));
  }
  const result = seasonPlaylist(mid, seasonId, json.data || {}, pn, ps);
  if (!result.owner) {
    result.owner = await getBiliUploader(mid);
  }
  src.log('getBiliPlaylist(season ' + seasonId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + result.hasMore + ', name=' + previewValue(result.name));
  return result;
}

async function fetchBiliSeriesPlaylist(mid, seriesId, pn, ps) {
  // yt-dlp reads the series metadata from its own endpoint before the
  // archives page; the archives response's `meta` is only a fallback.
  let meta;
  try {
    const metaRes = await src.get('https://api.bilibili.com/x/series/series?series_id=' + src.url.encode(seriesId), { headers: BROWSER_HEADERS });
    const metaJson = src.parse.json(metaRes.body);
    if (metaJson.code === 0) meta = metaJson.data && metaJson.data.meta;
  } catch (e) {
    src.log('getBiliPlaylist(series ' + seriesId + ') → x/series/series failed: ' + previewValue(String(e && e.message || e), 120));
  }
  const res = await src.get(
    'https://api.bilibili.com/x/series/archives?mid=' + src.url.encode(mid) +
      '&series_id=' + src.url.encode(seriesId) + '&pn=' + pn + '&ps=' + ps,
    { headers: BROWSER_HEADERS },
  );
  const json = src.parse.json(res.body);
  if (json.code !== 0) {
    throw new Error('series ' + seriesId + ' failed: ' + (json.message || json.code));
  }
  const result = seriesPlaylist(mid, seriesId, meta, json.data || {}, pn, ps);
  if (!result.owner) {
    result.owner = await getBiliUploader(mid);
  }
  src.log('getBiliPlaylist(series ' + seriesId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + result.hasMore + ', name=' + previewValue(result.name));
  return result;
}

/**
 * A player-page playlist — BilibiliPlaylistIE.
 *
 * `bilibili.com/list/<mid>?sid=<sid>`, `…/list/ml<id>` and `…/list/watchlater`
 * are all the medialist API: `x/v2/medialist/resource/list`, paged by the
 * `oid` of the last item rather than by page number. The entity behind the
 * id — series, fav medialist, watchlater — is whatever the page's
 * `__INITIAL_STATE__` says it is, which is why this branch fetches the page
 * where the season/series branches do not.
 *
 * The canonical id (`bili_medialist_<type>_<biz_id>`) is what the runtime
 * hands back on the next page, so the initial state is also cached under it
 * and a cursor call does not need the URL again.
 */
async function fetchBiliMedialist(target, pn, ps, cursor) {
  let state;
  if (target.canonicalId) {
    state = src.cache.get('bili_initial_id_' + target.canonicalId);
    if (!state) {
      throw new Error('playlist session for ' + target.canonicalId + ' expired — open it again from its URL');
    }
  } else {
    state = await getBiliInitialState(target.url);
  }

  // yt-dlp checks both `error` and `listError`, and reads `trueCode` for the
  // real status: -400 watchlater needs login, -403 is private, 11010 gone.
  const error = [state.error, state.listError].find((e) => e && e.code);
  if (error && error.code !== 200) {
    const code = error.trueCode;
    if (code === -400 && String(target.id) === 'watchlater') {
      throw new Error('You need to login to access your watchlater playlist');
    }
    if (code === -403) {
      throw new Error('This is a private playlist. You need to login as its owner');
    }
    if (code === 11010) {
      throw new Error('Playlist is no longer available');
    }
    throw new Error('Could not access playlist: ' + code + ' ' + (error.message || ''));
  }

  const playlist = state.playlist || {};
  const info = state.mediaListInfo || {};
  const canonicalId = target.canonicalId ||
    ('bili_medialist_' + (playlist.type || '?') + '_' + (playlist.id || target.id));
  if (!target.canonicalId) {
    src.cache.put('bili_initial_id_' + canonicalId, state, 300000);
  }

  const params = {
    ps: ps,
    with_current: 'false',
    type: playlist.type,
    biz_id: playlist.id,
    tid: state.tid,
    sort_field: state.sortFiled,
    desc: state.desc,
    oid: cursor,
  };
  const query = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => src.url.encode(k) + '=' + src.url.encode(params[k]))
    .join('&');
  const res = await src.get('https://api.bilibili.com/x/v2/medialist/resource/list?' + query, { headers: BROWSER_HEADERS });
  const json = src.parse.json(res.body);
  if (json.code !== 0) {
    throw new Error('medialist ' + canonicalId + ' failed: ' + (json.message || json.code));
  }
  const data = json.data || {};
  const mediaList = data.media_list || [];
  const last = mediaList[mediaList.length - 1];
  const hasMore = !!data.has_more;

  const result = {
    id: canonicalId,
    name: info.title || '',
    artwork: cleanPic(info.cover || ''),
    description: info.intro || '',
    owner: (info.upper && info.upper.name) || '',
    items: mediaList.map((m) => ({
      id: m.bv_id || String(m.id),
      bvid: m.bv_id,
      title: cleanTitle(m.title || ''),
      duration: m.duration,
      cover: cleanPic(m.cover || ''),
      artist: (m.upper && m.upper.name) || '',
      artistId: m.upper ? String(m.upper.mid) : undefined,
      upper: m.upper ? { id: String(m.upper.mid), name: m.upper.name } : undefined,
      cid: m.pages && m.pages[0] ? m.pages[0].id : undefined,
    })),
    hasMore,
    cursor: hasMore && last ? String(last.id) : undefined,
    trackCount: info.media_count,
  };
  src.log('getBiliPlaylist(medialist ' + canonicalId + ', ' + (cursor ? 'cursor ' + cursor : 'first page') + ') → ' + result.items.length + ' item(s), hasMore=' + hasMore + ', name=' + previewValue(result.name));
  return result;
}

/**
 * A favourites folder — BilibiliFavoritesListIE.
 *
 * yt-dlp fetches the metadata from `x/v3/fav/resource/list` (page 1) and the
 * entry list from `x/v3/fav/resource/ids`, which answers every bvid at once;
 * it never pages the folder itself. The source keeps yt-dlp's two calls and
 * additionally reads the requested page of `resource/list`, because ids carry
 * no titles and a playlist row without one is not a row a user can pick.
 * Pagination is therefore local over the ids list, with the page's rows
 * enriched by the matching `resource/list` page.
 */
async function fetchBiliFavPlaylist(mediaId, pn, ps) {
  const idsUrl = 'https://api.bilibili.com/x/v3/fav/resource/ids?media_id=' + src.url.encode(mediaId);
  let allIds = src.cache.get('bili_fav_ids_' + mediaId);
  if (!Array.isArray(allIds)) {
    try {
      const idsRes = await src.get(idsUrl, { headers: BROWSER_HEADERS });
      const idsJson = src.parse.json(idsRes.body);
      if (idsJson.code === -403) {
        throw new Error('This is a private favorites list. You need to log in as its owner');
      }
      allIds = (idsJson.data || [])
        .map((item) => (item && (item.bvid || item.bv_id)) ? String(item.bvid || item.bv_id) : '')
        .filter(Boolean);
      src.cache.put('bili_fav_ids_' + mediaId, allIds, 600000);
      src.log('getBiliPlaylist(collect ' + mediaId + ') → resource/ids: ' + allIds.length + ' entr(ies)');
    } catch (e) {
      if (String(e && e.message || e).indexOf('private favorites') >= 0) throw e;
      src.log('getBiliPlaylist(collect ' + mediaId + ') → resource/ids failed: ' + previewValue(String(e && e.message || e), 120));
      allIds = [];
    }
  }

  const res = await src.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=' + src.url.encode(mediaId) + '&pn=' + pn + '&ps=' + ps + '&platform=web', { headers: BROWSER_HEADERS });
  const json = src.parse.json(res.body);
  if (json.code === -403) {
    throw new Error('This is a private favorites list. You need to log in as its owner');
  }
  const data = json.data || {};
  const info = data.info || {};
  const medias = (data.medias || []).filter((m) => m && m.bvid);
  const byBvid = {};
  for (const m of medias) byBvid[m.bvid] = m;

  let rows;
  let total;
  let hasMore;
  if (allIds.length > 0) {
    const pageIds = allIds.slice((pn - 1) * ps, pn * ps);
    rows = pageIds.map((bvid) => byBvid[bvid] || { bvid: bvid });
    total = allIds.length;
    hasMore = pn * ps < total;
  } else {
    rows = medias;
    total = info.media_count || 0;
    hasMore = data.has_more === undefined ? pn * ps < total : !!data.has_more;
  }

  const result = {
    id: 'bili_collect_' + mediaId,
    name: info.title || '',
    artwork: cleanPic(info.cover || ''),
    description: info.intro || '',
    owner: (info.upper && info.upper.name) || '',
    items: rows.map((m) => ({
      id: m.bvid,
      bvid: m.bvid,
      title: cleanTitle(m.title || ''),
      duration: m.duration,
      cover: cleanPic(m.cover || ''),
      artist: (m.upper && m.upper.name) || '',
      artistId: m.upper ? String(m.upper.mid) : undefined,
      upper: m.upper ? { id: String(m.upper.mid), name: m.upper.name } : undefined,
      cid: m.cid,
    })),
    hasMore,
    cursor: hasMore ? String(pn + 1) : undefined,
    trackCount: total,
  };
  src.log('getBiliPlaylist(collect ' + mediaId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + hasMore + ', name=' + previewValue(result.name));
  return result;
}

async function getBiliPlaylist(id, page) {
  const target = parsePlaylistTarget(id);
  const pn = page?.cursor ? parseInt(page.cursor, 10) : 1;
  const ps = page?.limit || 30;
  const sid = String(id);

  if (!target) {
    throw new Error('cannot interpret playlist id ' + sid + ' — a fav id, a bili_collect/season/series id, or a space.bilibili.com / bilibili.com/list URL');
  }

  if (target.kind === 'season') {
    return fetchBiliSeasonPlaylist(target.mid, target.id, pn, ps);
  }

  if (target.kind === 'series') {
    return fetchBiliSeriesPlaylist(target.mid, target.id, pn, ps);
  }

  if (target.kind === 'medialist') {
    return fetchBiliMedialist(target, pn, ps, page?.cursor);
  }

  return fetchBiliFavPlaylist(target.id, pn, ps);
}

async function getBiliLibraryList(kind, page) {
  if (kind !== 'playlist') {
    src.log('getBiliLibraryList(' + kind + ') → 0 item(s) (kind not supported)');
    return { items: [], hasMore: false };
  }

  const navRes = await src.get('https://api.bilibili.com/x/web-interface/nav', { headers: BROWSER_HEADERS });
  const navData = src.parse.json(navRes.body);
  const mid = navData?.data?.mid;
  if (!mid) {
    src.log('getBiliLibraryList(playlist) → 0 item(s) (not signed in, no mid)');
    return { items: [], hasMore: false };
  }

  const items = [];

  try {
    const createdRes = await src.get('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + src.url.encode(String(mid)), { headers: BROWSER_HEADERS });
    const createdData = src.parse.json(createdRes.body)?.data;
    for (const f of createdData?.list || []) {
      items.push({
        id: 'bili_collect_' + f.id,
        addedAt: f.ctime ? f.ctime * 1000 : undefined,
      });
    }
  } catch (e) {}

  try {
    const colRes = await src.get('https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid=' + src.url.encode(String(mid)) + '&pn=1&ps=50&platform=web', { headers: BROWSER_HEADERS });
    const colData = src.parse.json(colRes.body)?.data;
    for (const f of colData?.list || []) {
      items.push({
        id: 'bili_collect_' + f.id,
        addedAt: f.ctime ? f.ctime * 1000 : undefined,
      });
    }
  } catch (e) {}

  const libraryResult = {
    items,
    hasMore: false,
    total: items.length,
  };
  src.log('getBiliLibraryList(playlist) → ' + items.length + ' list(s) for mid ' + mid);
  return libraryResult;
}
