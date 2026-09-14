// Bilibili source library — every rule in source.json lands here.
//
// Endpoint reference: bilibili-api-collect (github.com/bilibili-plugins/bilibili-api-collect)
//   docs/misc/sign/wbi.md            — WBI signing (w_rid/wts)
//   docs/misc/buvid.md               — buvid3/buvid4 via x/frontend/finger/spi
//   docs/search/search_request.md    — x/web-interface/wbi/search/type
//   docs/video/videostreamurl.md     — x/player/wbi/playurl, DASH audio ids
//   docs/video/subtitle.md           — x/player/wbi/v2 → subtitle JSON
//   docs/login/login_action/QR.md    — QR generate/poll
//   docs/login/refresh/Cookie.md     — cookie refresh (RSA-OAEP + correspond)
//
// Browsers identify every api.bilibili.com call; without a browser User-Agent
// and a buvid3 cookie the risk control answers -412 to search, so the helpers
// below attach BROWSER_HEADERS explicitly (src.get bypasses the document's
// top-level `header`, which only covers the runtime's own fetches).

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com',
};

// Per docs/misc/sign/wbi.md: the first 32 entries index the concatenated
// img_key+sub_key into the mixin key. Fixed by the web client, not secret.
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
  // it (bit 4096 is no longer requested — see resolveBiliStream), the best AAC
  // otherwise. Dolby is absent on purpose — see AUDIO_TIERS.
  lossless: ['hi-res', 'high', 'normal', 'low'],
  'hi-res': ['hi-res', 'high', 'normal', 'low'],
};

// `qn` is playurl's quality hint. It decides what the account is offered, so
// each app quality asks for the qn that matches it:
//
//   app tier   qn   label
//   low        16   360P 流畅
//   normal     32   480P 清晰
//   high       64   720P 高清   (WEB default; works signed out)
//   lossless   80   1080P 高清  (TV/APP default; requires login)
//   hi-res     127  8K 超高清   (requires membership)
//
// Signed out nothing above 64 is served, so the ask is capped there: the
// effective default is 64 signed out and 80 signed in — which is exactly what
// the player's default `lossless` resolves to — and anything above those is
// only ever requested because the user chose it.
const QN_FOR_QUALITY = {
  low: 16,
  normal: 32,
  high: 64,
  lossless: 80,
  'hi-res': 127,
};
const QN_SIGNED_OUT_CAP = 64;

// The fallback order when playurl refuses an ask, highest first. HDR and
// Dolby Vision (125/126) sit at the same resolution as the level below them
// and exist for the video track, so a refused audio resolve steps over them
// rather than re-asking at the same size.
const QN_LADDER = [127, 120, 116, 112, 100, 80, 74, 64, 32, 16];

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

/**
 * buvid3/buvid4, once per realm.
 *
 * Search (and much of the web API) is behind risk control that answers -412
 * to a cookieless client. The spi endpoint is the documented bootstrap: it
 * hands out the device ids the web client would otherwise get on first visit,
 * and they go into the source's own cookie jar on the bare domain so every
 * later api.bilibili.com call carries them.
 */
async function ensureBuvid() {
  if (src.cache.get('bili_buvid_ok')) return;
  try {
    const res = await src.get('https://api.bilibili.com/x/frontend/finger/spi', { headers: BROWSER_HEADERS });
    const data = src.parse.json(res.body)?.data;
    if (data?.b_3) {
      // The bare domain, not api.bilibili.com — one jar entry covering every
      // bilibili.com subdomain the document talks to.
      await src.cookie.set('buvid3', data.b_3, 'https://www.bilibili.com');
      if (data.b_4) await src.cookie.set('buvid4', data.b_4, 'https://www.bilibili.com');
      src.cache.put('bili_buvid_ok', true, 6 * 3600000);
      src.log('ensureBuvid → buvid3 ' + previewValue(data.b_3, 16) + '… set');
    } else {
      src.log('ensureBuvid → spi answered without b_3: ' + previewValue(res.body, 120));
    }
  } catch (e) {
    // Search may still work (or the next call retries); not fatal here.
    src.log('ensureBuvid → failed: ' + previewValue(String(e && e.message || e), 120));
  }
}

async function getWbiMixinKey() {
  const cached = src.cache.get('bili_wbi_mixin_key');
  if (cached) {
    src.log('getWbiMixinKey → cached key ' + previewValue(cached, 16) + '…');
    return String(cached);
  }

  // A stale raw key signs a w_rid the server refuses (-403), so this only
  // ever bridges a nav outage; the real keys come from nav below.
  let rawKey = 'ea1db124c0474257a4be650bd4024229ffd086a47a8e4832a286561f211c8114';
  try {
    const res = await src.get('https://api.bilibili.com/x/web-interface/nav', { headers: BROWSER_HEADERS });
    const json = src.parse.json(res.body);
    const wbi = json?.data?.wbi_img;
    if (wbi?.img_url && wbi?.sub_url) {
      const imgKey = wbi.img_url.slice(wbi.img_url.lastIndexOf('/') + 1, wbi.img_url.lastIndexOf('.'));
      const subKey = wbi.sub_url.slice(wbi.sub_url.lastIndexOf('/') + 1, wbi.sub_url.lastIndexOf('.'));
      rawKey = imgKey + subKey;
    }
  } catch (e) {
    src.log('getWbiMixinKey → nav failed, using fallback key: ' + previewValue(String(e && e.message || e), 120));
  }

  let mixinKey = '';
  for (let i = 0; i < 32; i++) {
    mixinKey += rawKey[WBI_ENC_TAB[i]] || '';
  }
  src.cache.put('bili_wbi_mixin_key', mixinKey, 3600000);
  src.log('getWbiMixinKey → new mixin key ' + previewValue(mixinKey, 16) + '…');
  return mixinKey;
}

/**
 * WBI signing, per docs/misc/sign/wbi.md.
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

async function biliSearchUrl(key, page) {
  await ensureBuvid();
  const query = await signWbiQuery({
    keyword: key,
    search_type: 'video',
    page: page || 1,
  });
  const url = 'https://api.bilibili.com/x/web-interface/wbi/search/type?' + query;
  src.log('biliSearchUrl("' + previewValue(key) + '", ' + (page || 1) + ') → ' + url);
  return url;
}

/**
 * The user half of search, per docs/search/search_request.md's 分类搜索:
 * same endpoint, `search_type=bili_user`. Rows are UP主 (mid, uname, upic),
 * which the artist rules map onto the artist page — one fetch per page, same
 * WBI + buvid3 requirements as the video search.
 */
async function biliUserSearchUrl(key, page) {
  await ensureBuvid();
  const query = await signWbiQuery({
    keyword: key,
    search_type: 'bili_user',
    page: page || 1,
  });
  const url = 'https://api.bilibili.com/x/web-interface/wbi/search/type?' + query;
  src.log('biliUserSearchUrl("' + previewValue(key) + '", ' + (page || 1) + ') → ' + url);
  return url;
}

/**
 * The audio-area charts, per docs/audio/rank.md (music.bilibili.com/pc/rank).
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

/**
 * The cid of a video's first page, cached per realm.
 *
 * DASH is per-page: every playurl/lyric call needs one, and search results do
 * not carry it, so without the cache every track cost an extra round trip on
 * both resolve and lyric fetch.
 */
async function ensureCid(track) {
  if (track.cid) return track.cid;
  const bvid = trackBvid(track);
  const cacheKey = 'bili_cid_' + bvid;
  const cached = src.cache.get(cacheKey);
  if (cached) return cached;
  try {
    const res = await src.get('https://api.bilibili.com/x/player/pagelist?bvid=' + src.url.encode(bvid), { headers: BROWSER_HEADERS });
    const cid = src.parse.json(res.body)?.data?.[0]?.cid;
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

/** The bvid, from wherever the row kept it. `track.id` is the URN segment, which the search rules already make the bvid. */
function trackBvid(track) {
  return String(track.bvid || track.onlineId || track.id || '').replace(/^bili_video_/, '');
}

/**
 * One playurl request at one `qn`.
 *
 * `fnval` is pinned at 4048 — the standard DASH set (4K, HDR, Dolby, Dolby
 * Vision, AV1) — on purpose. Bit 4096 (Hi-Res) is what most often makes
 * Bilibili answer `-400 请求错误`, and a FLAC nobody can fetch is worth less
 * than the AAC that plays; the richer video bits (HDR/Dolby/8K) are on the
 * bitmap because they are what a `qn` above 4K needs, and the API ignores
 * the ones a video does not offer *when* qn and bitmap agree.
 */
async function fetchBiliPlayurl(bvid, cid, qn) {
  const query = await signWbiQuery({
    bvid: bvid,
    cid: cid,
    qn: qn,
    fnval: 4048,
    fourk: 1,
    platform: 'pc',
  });
  const res = await src.get('https://api.bilibili.com/x/player/wbi/playurl?' + query, { headers: BROWSER_HEADERS });
  return src.parse.json(res.body);
}

/** Whether this realm holds a session — what the qn cap turns on. */
async function biliSignedIn() {
  try {
    const sess = await src.cookie.get('SESSDATA');
    return !!(sess && String(sess).trim());
  } catch (e) {
    return false;
  }
}

/**
 * The audio stream, per docs/video/videostreamurl.md.
 *
 * `qn` starts at what `prefs.quality` asks for, capped at 64 when signed out
 * (`QN_FOR_QUALITY`): the effective default is 64 signed out and 80 signed in,
 * and only an explicit user choice ever asks above those. A refused ask walks
 * *down* the quality ladder rather than failing the resolve — Bilibili
 * answers non-zero codes to requests for tiers an account or a video does not
 * have, and the next tier down is usually fine. `fnval` stays 4048.
 *
 * The audio track itself is then picked by tier ladder from prefs.quality —
 * the player sends 'lossless' — with every step degrading to a decodable AAC
 * rather than to the Dolby track the bandwidth sort used to select.
 */
async function resolveBiliStream(track, prefs) {
  const bvid = trackBvid(track);
  if (!bvid) {
    src.log('resolveBiliStream → no bvid in track ' + previewValue(track, 160) + ' — throwing');
    throw new Error('cannot resolve a Bilibili stream without a bvid');
  }
  const cid = await ensureCid(track);
  if (!cid) {
    src.log('resolveBiliStream: no cid for bvid ' + bvid + ' — throwing');
    throw new Error('cannot resolve cid for bvid ' + bvid);
  }

  const signedIn = await biliSignedIn();
  const wanted = QN_FOR_QUALITY[prefs?.quality] || (signedIn ? 80 : 64);
  const capped = signedIn ? wanted : Math.min(wanted, QN_SIGNED_OUT_CAP);
  const start = Math.max(0, QN_LADDER.indexOf(capped));
  src.log('resolveBiliStream(' + bvid + ') → qn ' + capped + (signedIn ? ' (signed in)' : ' (signed out)') + ', quality=' + (prefs?.quality || 'default'));

  let data;
  for (let i = start; i < QN_LADDER.length; i++) {
    const qn = QN_LADDER[i];
    data = await fetchBiliPlayurl(bvid, cid, qn);
    if (!data?.code || data.code === 0) break;
    src.log('resolveBiliStream(' + bvid + ') → qn ' + qn + ' refused: code ' + data.code + ' ' + previewValue(data.message) + ', trying lower');
  }
  if (data?.code && data.code !== 0) {
    src.log('resolveBiliStream(' + bvid + ') → playurl code ' + data.code + ': ' + previewValue(data.message));
    throw new Error('playurl failed: ' + (data.message || data.code));
  }

  const dash = data?.data?.dash || {};
  const audios = [];
  const push = (a, fallbackTier, undecodable) => {
    if (!a) return;
    const id = a.id || a.new_id;
    const codecs = String(a.codecs || '').toLowerCase();
    const format = codecs.includes('flac') ? 'flac' : codecs.includes('ec-3') || codecs.includes('eac3') ? 'eac3' : 'm4a';
    audios.push({ ...a, format, qTier: AUDIO_TIERS[id] || fallbackTier || 'normal', undecodable: undecodable === true });
  };
  push(dash.flac?.audio, 'hi-res');
  // Dolby maps to the app's premium tier but stays out of selection — see
  // AUDIO_TIERS. The flag is what excludes it, not its tier name.
  for (const a of dash.dolby?.audio || []) push(a, 'lossless', true);
  for (const a of dash.audio || []) push(a);

  let candidates = audios.filter(a => !a.undecodable);
  if (Array.isArray(prefs?.acceptFormats) && prefs.acceptFormats.length > 0) {
    const accepted = candidates.filter(a => prefs.acceptFormats.some(fmt => a.format === String(fmt).toLowerCase()));
    if (accepted.length > 0) candidates = accepted;
  }

  const ladder = AUDIO_LADDER[prefs?.quality] || AUDIO_LADDER.high;
  let chosen;
  for (const tier of ladder) {
    chosen = candidates.filter(a => a.qTier === tier).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    if (chosen) break;
  }
  if (!chosen) {
    // Nothing on the ladder (an unknown tier set) — fall back to bitrate,
    // still skipping what cannot be decoded.
    chosen = candidates.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
  }

  const url = chosen?.baseUrl || chosen?.base_url || chosen?.backupUrl?.[0] || chosen?.backup_url?.[0];
  if (!url) {
    src.log('resolveBiliStream(' + bvid + ', qn=' + (prefs?.quality || 'best') + ') → no audio stream in response (' + audios.length + ' candidates) — throwing');
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

async function getBiliLyrics(track) {
  const bvid = trackBvid(track);
  if (!bvid) {
    src.log('getBiliLyrics → no bvid in track — returning ""');
    return '';
  }
  const cid = await ensureCid(track);
  if (!cid) {
    src.log('getBiliLyrics(' + bvid + ') → "" (no cid)');
    return '';
  }

  // x/player/wbi/v2 is a WBI endpoint: unsigned, it answers -403 rather than
  // an empty subtitle list, which reads as "no lyrics" instead of "broken".
  const query = await signWbiQuery({ cid: cid, bvid: bvid });
  const subRes = await src.get('https://api.bilibili.com/x/player/wbi/v2?' + query, { headers: BROWSER_HEADERS });
  const subtitles = src.parse.json(subRes.body)?.data?.subtitle?.subtitles;
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    src.log('getBiliLyrics(' + bvid + ') → "" (video has no subtitles)');
    return '';
  }

  // A video can carry an uploaded CC track and an AI-generated one for the
  // same language; the uploaded one is the author's text, the AI one a guess.
  const isZh = s => String(s.lan || '').toLowerCase().indexOf('zh') === 0;
  const isAi = s => /^ai/i.test(String(s.lan || ''));
  const chosen = subtitles.find(s => isZh(s) && !isAi(s)) || subtitles.find(isZh) || subtitles[0];
  const subUrl = chosen?.subtitle_url;
  if (!subUrl) {
    src.log('getBiliLyrics(' + bvid + ') → "" (subtitle entry has no url)');
    return '';
  }
  src.log('getBiliLyrics(' + bvid + ') → subtitle lan=' + previewValue(chosen.lan) + ' of ' + subtitles.length);

  const fullUrl = subUrl.startsWith('//') ? 'https:' + subUrl : subUrl;
  const contentRes = await src.get(fullUrl, { headers: BROWSER_HEADERS });
  const body = src.parse.json(contentRes.body)?.body;
  if (!Array.isArray(body)) {
    src.log('getBiliLyrics(' + bvid + ') → "" (subtitle body is not a list)');
    return '';
  }

  const lrc = body
    .filter(item => item && typeof item.from === 'number')
    .map(item => {
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

  let topTracks = [];
  try {
    // The user's own archive list, WBI-signed, paged until the backend stops
    // answering with a full page — "all videos", not the first thirty. Risk
    // control on this endpoint is aggressive, so the keyword endpoint below
    // remains the fallback for at least a first page.
    const PS = 50;
    const MAX_PAGES = 40;
    for (let pn = 1; pn <= MAX_PAGES; pn++) {
      const query = await signWbiQuery({ mid: uid, pn: pn, ps: PS, order: 'pubdate' });
      const arcRes = await src.get('https://api.bilibili.com/x/space/wbi/arc/search?' + query, { headers: BROWSER_HEADERS });
      const vlist = src.parse.json(arcRes.body)?.data?.list?.vlist || [];
      for (const a of vlist) {
        topTracks.push({
          id: a.bvid,
          bvid: a.bvid,
          title: cleanTitle(a.title || ''),
          artwork: cleanPic(a.pic || ''),
          duration: a.length,
          durationMs: parseDuration(a.length),
        });
      }
      src.log('getBiliArtist(' + uid + ') → arc/search page ' + pn + ': ' + vlist.length + ' row(s), ' + topTracks.length + ' total');
      if (vlist.length < PS) break;
    }
  } catch (e) {
    src.log('getBiliArtist(' + uid + ') → arc/search failed, trying recArchives: ' + previewValue(String(e && e.message || e), 120));
  }
  if (topTracks.length === 0) {
    try {
      const videosRes = await src.get('https://api.bilibili.com/x/series/recArchivesByKeywords?mid=' + src.url.encode(uid) + '&keywords=&pn=1&ps=30', { headers: BROWSER_HEADERS });
      const archives = src.parse.json(videosRes.body)?.data?.archives || [];
      for (const a of archives) {
        topTracks.push({
          id: a.bvid,
          bvid: a.bvid,
          title: cleanTitle(a.title || ''),
          artwork: cleanPic(a.pic || ''),
          duration: a.duration,
          durationMs: (a.duration || 0) * 1000,
        });
      }
    } catch (e) {}
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
 * What a playlist id names, wherever the user got it from.
 *
 * Besides the document's own `bili_*` ids, a fav folder or a collection is
 * often at hand as a bare number (the fav mlid) or as a space.bilibili.com
 * URL copied from the browser — `favlist?fid=…`, `channel/collectiondetail…
 * sid=…`, `seriesdetail…sid=…`. All of them land on the same three targets.
 * A bare season id is the one shape that cannot be honoured: the archives
 * call needs the owner's mid alongside it, and a season id alone does not
 * carry one (verified: a mismatched mid answers -404).
 */
function parsePlaylistTarget(raw) {
  const sid = String(raw || '').trim();

  const collectMatch = sid.match(/(?:^bili_collect_)(\d+)$/) || sid.match(/^(\d+)$/);
  if (collectMatch) return { kind: 'collect', id: collectMatch[1] };

  const seasonMatch =
    sid.match(/space\.bilibili\.com\/(\d+)\/channel\/collectiondetail\?.*?sid=(\d+)/) ||
    sid.match(/^bili_season_(\d+)_(\d+)$/);
  if (seasonMatch) return { kind: 'season', mid: seasonMatch[1], id: seasonMatch[2] };
  if (/^bili_season_\d+$/.test(sid)) {
    throw new Error('season id "' + sid + '" carries no mid — open it again from the artist page, or paste the space.bilibili.com collectiondetail URL');
  }

  const seriesMatch =
    sid.match(/space\.bilibili\.com\/(\d+)\/(?:channel\/)?seriesdetail\?.*?sid=(\d+)/) ||
    sid.match(/^bili_series_(\d+)_(\d+)$/);
  if (seriesMatch) return { kind: 'series', mid: seriesMatch[1], id: seriesMatch[2] };

  const favMatch = sid.match(/space\.bilibili\.com\/\d+\/favlist\?.*?fid=(\d+)/);
  if (favMatch) return { kind: 'collect', id: favMatch[1] };

  return null;
}

async function getBiliPlaylist(id, page) {
  const target = parsePlaylistTarget(id);
  const pn = page?.cursor ? parseInt(page.cursor, 10) : 1;
  const ps = page?.limit || 30;
  const sid = String(id);

  if (!target) {
    throw new Error('cannot interpret playlist id ' + sid + ' — a fav id, a bili_collect/season/series id, or a space.bilibili.com favlist/collection URL');
  }

  if (target.kind === 'season') {
    const mid = target.mid;
    const seasonId = target.id;
    const res = await src.get('https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=' + src.url.encode(mid) + '&season_id=' + src.url.encode(seasonId) + '&page_num=' + pn + '&page_size=' + ps, { headers: BROWSER_HEADERS });
    const data = src.parse.json(res.body)?.data;
    const meta = data?.meta || {};
    const archives = data?.archives || [];
    const total = data?.page?.total || archives.length;
    const hasMore = pn * ps < total;
    const result = {
      id: 'bili_season_' + mid + '_' + seasonId,
      name: meta.name || '',
      artwork: cleanPic(meta.cover || ''),
      description: meta.description || '',
      owner: meta.owner?.name || archives[0]?.owner?.name || '',
      items: archives.map(a => ({
        id: a.bvid,
        bvid: a.bvid,
        title: cleanTitle(a.title || ''),
        duration: a.duration,
        cover: cleanPic(a.pic || ''),
        artist: a.owner?.name || meta.owner?.name || '',
      })),
      hasMore,
      cursor: hasMore ? String(pn + 1) : undefined,
      trackCount: total,
    };
    src.log('getBiliPlaylist(season ' + seasonId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + hasMore + ', name=' + previewValue(result.name));
    return result;
  }

  if (target.kind === 'series') {
    const mid = target.mid;
    const seriesId = target.id;
    const res = await src.get('https://api.bilibili.com/x/series/archives?mid=' + src.url.encode(mid) + '&series_id=' + src.url.encode(seriesId) + '&pn=' + pn + '&ps=' + ps, { headers: BROWSER_HEADERS });
    const data = src.parse.json(res.body)?.data;
    const meta = data?.meta || {};
    const archives = data?.archives || [];
    const total = data?.page?.total || archives.length;
    const hasMore = pn * ps < total;
    const result = {
      id: 'bili_series_' + mid + '_' + seriesId,
      name: meta.name || '',
      artwork: cleanPic(meta.cover || ''),
      description: meta.description || '',
      owner: meta.owner?.name || archives[0]?.owner?.name || '',
      items: archives.map(a => ({
        id: a.bvid,
        bvid: a.bvid,
        title: cleanTitle(a.title || ''),
        duration: a.duration,
        cover: cleanPic(a.pic || ''),
        artist: a.owner?.name || '',
      })),
      hasMore,
      cursor: hasMore ? String(pn + 1) : undefined,
      trackCount: total,
    };
    src.log('getBiliPlaylist(series ' + seriesId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + hasMore + ', name=' + previewValue(result.name));
    return result;
  }

  // A favourites folder. medias carries non-video entries (courses, audio,
  // chat logs); a video is the one with a bvid, and the only kind this
  // document can resolve a stream for.
  const mediaId = target.id;
  const res = await src.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=' + src.url.encode(mediaId) + '&pn=' + pn + '&ps=' + ps + '&platform=web', { headers: BROWSER_HEADERS });
  const data = src.parse.json(res.body)?.data;
  const info = data?.info || {};
  const medias = (data?.medias || []).filter(m => m && m.bvid);
  const total = info.media_count || 0;
  const hasMore = data?.has_more || false;
  const result = {
    id: 'bili_collect_' + mediaId,
    name: info.title || '',
    artwork: cleanPic(info.cover || ''),
    description: info.intro || '',
    owner: info.upper?.name || '',
    items: medias.map(m => ({
      id: m.bvid,
      bvid: m.bvid,
      title: cleanTitle(m.title || ''),
      duration: m.duration,
      cover: cleanPic(m.cover || ''),
      artist: m.upper?.name || '',
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
