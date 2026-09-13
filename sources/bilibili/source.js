const WBI_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
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
  let str = String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
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

async function getWbiMixinKey() {
  const cached = src.cache.get('bili_wbi_mixin_key');
  if (cached) {
    src.log('getWbiMixinKey → cached key ' + previewValue(cached));
    return String(cached);
  }

  let rawKey = 'ea1db124c0474257a4be650bd4024229ffd086a47a8e4832a286561f211c8114';
  try {
    const res = await src.get('https://api.bilibili.com/x/web-interface/nav');
    const json = src.parse.json(res.body);
    const wbi = json?.data?.wbi_img;
    if (wbi?.img_url && wbi?.sub_url) {
      const imgKey = wbi.img_url.slice(wbi.img_url.lastIndexOf('/') + 1, wbi.img_url.lastIndexOf('.'));
      const subKey = wbi.sub_url.slice(wbi.sub_url.lastIndexOf('/') + 1, wbi.sub_url.lastIndexOf('.'));
      rawKey = imgKey + subKey;
    }
  } catch (e) {
    // fallback to default key
  }

  let mixinKey = '';
  for (let i = 0; i < 32; i++) {
    mixinKey += rawKey[WBI_ENC_TAB[i]] || '';
  }
  src.cache.put('bili_wbi_mixin_key', mixinKey, 3600000);
  src.log('getWbiMixinKey → new mixin key ' + previewValue(mixinKey));
  return mixinKey;
}

async function signWbiQuery(params) {
  const mixinKey = await getWbiMixinKey();
  const wts = Math.floor(src.time.now() / 1000);
  const allParams = { ...params, wts };
  const keys = Object.keys(allParams).sort();
  const pairs = [];
  for (const k of keys) {
    const v = allParams[k];
    if (v !== undefined && v !== null) {
      pairs.push(src.url.encode(k) + '=' + src.url.encode(String(v)));
    }
  }
  const queryStr = pairs.join('&');
  const w_rid = src.crypto.md5(queryStr + mixinKey);
  const signed = queryStr + '&w_rid=' + w_rid;
  src.log('signWbiQuery → ' + previewValue(signed));
  return signed;
}

async function biliSearchUrl(key, page) {
  const query = await signWbiQuery({
    keyword: key,
    search_type: 'video',
    page: page || 1,
  });
  const url = 'https://api.bilibili.com/x/web-interface/wbi/search/type?' + query;
  src.log('biliSearchUrl("' + previewValue(key) + '", ' + (page || 1) + ') → ' + url);
  return url;
}

async function resolveBiliStream(track, prefs) {
  const bvid = track.onlineId || String(track.id).replace(/^bili_video_/, '');
  let cid = track.cid;
  if (!cid) {
    try {
      const pRes = await src.get('https://api.bilibili.com/x/player/pagelist?bvid=' + bvid);
      const pJson = src.parse.json(pRes.body);
      cid = pJson?.data?.[0]?.cid;
    } catch (e) {}
  }
  if (!cid) {
    src.log('resolveBiliStream: no cid for bvid ' + bvid + ' — throwing');
    throw new Error('cannot resolve cid for bvid ' + bvid);
  }

  const query = await signWbiQuery({
    bvid: bvid,
    cid: cid,
    qn: 127,
    fnval: 4048,
    fourk: 1,
    platform: 'pc',
  });
  const res = await src.get('https://api.bilibili.com/x/player/wbi/playurl?' + query);
  const data = src.parse.json(res.body)?.data;
  const dash = data?.dash || {};
  let audios = [];

  if (dash.flac?.audio) {
    audios.push({ ...dash.flac.audio, qTier: 'hi-res', format: 'flac' });
  }
  if (dash.dolby?.audio) {
    for (const a of dash.dolby.audio) audios.push({ ...a, qTier: 'dolby', format: 'm4a' });
  }
  for (const a of dash.audio || []) {
    const format = (a.codecs || '').toLowerCase().includes('flac') ? 'flac' : 'm4a';
    audios.push({
      ...a,
      format,
      qTier: a.id === 30250 ? 'hi-res' : a.id === 30280 ? 'high' : a.id >= 30232 ? 'normal' : 'low',
    });
  }

  if (Array.isArray(prefs?.acceptFormats) && prefs.acceptFormats.length > 0) {
    const accepted = audios.filter(a => {
      const url = a.baseUrl || a.base_url || a.backupUrl?.[0] || a.backup_url?.[0] || '';
      return prefs.acceptFormats.some(fmt => a.format === fmt || url.includes('.' + fmt));
    });
    if (accepted.length > 0) audios = accepted;
  }

  let chosen;
  if (prefs?.quality === 'low') {
    const low = audios.find(a => a.qTier === 'low');
    if (low) chosen = low;
  } else if (prefs?.quality === 'hi-res') {
    const hires = audios.find(a => a.qTier === 'hi-res');
    if (hires) chosen = hires;
  }

  if (!chosen) {
    audios.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    chosen = audios[0];
  }

  const url = chosen?.baseUrl || chosen?.base_url || chosen?.backupUrl?.[0] || chosen?.backup_url?.[0];
  if (!url) {
    src.log('resolveBiliStream(' + bvid + ', qn=' + (prefs?.quality || 'best') + ') → no audio stream in response (' + audios.length + ' candidates) — throwing');
    throw new Error('No playable audio stream returned from Bilibili');
  }
  src.log('resolveBiliStream(' + bvid + ') → ' + previewValue(url) + ' [' + (chosen.qTier || '?') + '/' + (chosen.format || '?') + ']');
  return url;
}

async function getBiliLyrics(track) {
  const bvid = track.onlineId || String(track.id).replace(/^bili_video_/, '');
  let cid = track.cid;
  if (!cid) {
    try {
      const pRes = await src.get('https://api.bilibili.com/x/player/pagelist?bvid=' + bvid);
      const pJson = src.parse.json(pRes.body);
      cid = pJson?.data?.[0]?.cid;
    } catch (e) {}
  }
  if (!cid) {
    src.log('getBiliLyrics(' + bvid + ') → "" (no cid)');
    return '';
  }

  const subRes = await src.get('https://api.bilibili.com/x/player/wbi/v2?cid=' + cid + '&bvid=' + bvid);
  const subData = src.parse.json(subRes.body)?.data?.subtitle?.subtitles;
  if (!Array.isArray(subData) || subData.length === 0) {
    src.log('getBiliLyrics(' + bvid + ') → "" (video has no subtitles)');
    return '';
  }

  const subUrl = subData[0]?.subtitle_url;
  if (!subUrl) {
    src.log('getBiliLyrics(' + bvid + ') → "" (subtitle entry has no url)');
    return '';
  }

  let fullUrl = subUrl;
  if (subUrl.startsWith('//')) {
    fullUrl = 'https:' + subUrl;
  } else if (subUrl.startsWith('/')) {
    fullUrl = (typeof baseUrl !== 'undefined' && baseUrl ? baseUrl : 'https://api.bilibili.com') + subUrl;
  }
  const contentRes = await src.get(fullUrl);
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
    .join('\\n');
  src.log('getBiliLyrics(' + bvid + ') → ' + body.length + ' line(s)');
  return lrc;
}

async function getBiliQrCode() {
  const res = await src.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
    },
  });
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
  const res = await src.get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(key), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
    },
  });
  const json = src.parse.json(res.body);
  const data = json?.data;
  const pollCode = data?.code;
  if (pollCode === 0) {
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

async function refreshBiliCookie() {
  const refreshCsrf = (await src.vars.get('refresh_token')) || (await src.vars.get('bili_refresh_token'));
  if (!refreshCsrf) {
    src.log('refreshBiliCookie → no refresh_token in vars — throwing');
    throw new Error('No refresh_token found');
  }

  // 1. Check if refresh needed
  const infoRes = await src.get('https://passport.bilibili.com/x/passport-login/web/cookie/info', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
    },
  });
  const info = src.parse.json(infoRes.body);
  if (info.code !== 0) {
    src.log('refreshBiliCookie → cookie/info failed: ' + (info.message || info.code));
    throw new Error('cookie/info check failed: ' + (info.message || info.code));
  }
  const timestamp = info.data?.timestamp || src.time.now();

  // 2. Generate correspondPath using RSA-OAEP SHA-256
  const pubkey = [
    '-----BEGIN PUBLIC KEY-----',
    'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg',
    'Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71',
    'nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40',
    'JNrRuoEUXpabUzGB8QIDAQAB',
    '-----END PUBLIC KEY-----',
  ].join('\\n');

  const correspondPath = src.crypto.rsaOaepEncrypt('refresh_' + timestamp, pubkey);

  // 3. Fetch correspond page to extract refresh_csrf
  const correspondRes = await src.get('https://www.bilibili.com/correspond/1/' + correspondPath, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
    },
  });
  const match = correspondRes.body.match(/<div id="1-name">\s*([\s\S]*?)\s*<\/div>/);
  if (!match) {
    src.log('refreshBiliCookie → refresh_csrf not found in correspond page');
    throw new Error('refresh_csrf not found in correspond page');
  }
  const refreshCsrfVal = match[1].trim();

  // 4. Get csrf (bili_jct from cookies)
  const csrf = (await src.cookie.get('bili_jct')) || '';

  // 5. Post to cookie/refresh
  const refreshPostRes = await src.post('https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
    'csrf=' + src.url.encode(csrf) +
    '&refresh_csrf=' + src.url.encode(refreshCsrfVal) +
    '&source=main_web' +
    '&refresh_token=' + src.url.encode(refreshCsrf),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    }
  );
  const refreshData = src.parse.json(refreshPostRes.body);
  if (refreshData.code !== 0) {
    src.log('refreshBiliCookie → refresh failed: ' + (refreshData.message || refreshData.code));
    throw new Error('Cookie refresh failed: ' + (refreshData.message || refreshData.code));
  }
  const newRefreshToken = refreshData.data?.refresh_token;
  if (newRefreshToken) {
    await src.vars.put('refresh_token', newRefreshToken);
  }

  // 6. Confirm refresh
  const newCsrf = (await src.cookie.get('bili_jct')) || csrf;
  await src.post('https://passport.bilibili.com/x/passport-login/web/confirm/refresh',
    'csrf=' + src.url.encode(newCsrf) +
    '&refresh_token=' + src.url.encode(refreshCsrf),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    }
  );

  src.log('refreshBiliCookie → refreshed' + (newRefreshToken ? ' (new token stored)' : ' (kept existing token)'));
  return {
    token: newRefreshToken || refreshCsrf,
    refresh_token: newRefreshToken || refreshCsrf,
  };
}

async function getBiliArtist(id) {
  const uid = String(id);
  let name = uid;
  let face = '';
  let sign = '';
  try {
    const cardRes = await src.get('https://api.bilibili.com/x/web-interface/card?mid=' + uid, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const cardData = src.parse.json(cardRes.body)?.data?.card;
    if (cardData) {
      name = cardData.name || uid;
      face = cleanPic(cardData.face || '');
      sign = cardData.sign || '';
    }
  } catch (e) {}

  let bio = sign;
  try {
    const noticeRes = await src.get('https://api.bilibili.com/x/space/notice?mid=' + uid, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const noticeData = src.parse.json(noticeRes.body)?.data;
    if (noticeData) bio = noticeData;
  } catch (e) {}

  let albums = [];
  try {
    const seasonsRes = await src.get('https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid=' + uid + '&page_num=1&page_size=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const itemsLists = src.parse.json(seasonsRes.body)?.data?.items_lists;
    const seasons = itemsLists?.seasons_list || [];
    const series = itemsLists?.series_list || [];
    for (const s of seasons) {
      const meta = s.meta || s;
      albums.push({
        id: 'bili_season_' + (meta.season_id || meta.id),
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
    const videosRes = await src.get('https://api.bilibili.com/x/series/recArchivesByKeywords?mid=' + uid + '&keywords=&pn=1&ps=30', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
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

  const artist = {
    name,
    bio,
    artwork: face,
    albums,
    topTracks,
  };
  src.log('getBiliArtist(' + uid + ') → ' + albums.length + ' album(s), ' + topTracks.length + ' track(s), name=' + previewValue(name));
  return artist;
}

async function getBiliPlaylist(id, page) {
  const sid = String(id);
  const pn = page?.cursor ? parseInt(page.cursor, 10) : 1;
  const ps = page?.limit || 30;

  if (sid.startsWith('bili_season_')) {
    const seasonId = sid.replace(/^bili_season_/, '');
    const res = await src.get('https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?season_id=' + seasonId + '&mid=1&page_num=' + pn + '&page_size=' + ps, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const data = src.parse.json(res.body)?.data;
    const meta = data?.meta || {};
    const archives = data?.archives || [];
    const total = data?.page?.total || archives.length;
    const hasMore = pn * ps < total;
    const result = {
      id: sid,
      name: meta.name || '',
      artwork: cleanPic(meta.cover || ''),
      description: meta.description || '',
      owner: meta.name || '',
      items: archives.map(a => ({
        id: a.bvid,
        bvid: a.bvid,
        title: cleanTitle(a.title || ''),
        duration: a.duration,
        cover: cleanPic(a.pic || ''),
        artist: meta.name || '',
      })),
      hasMore,
      cursor: hasMore ? String(pn + 1) : undefined,
      trackCount: total,
    };
    src.log('getBiliPlaylist(season ' + seasonId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + hasMore + ', name=' + previewValue(result.name));
    return result;
  } else if (sid.startsWith('bili_series_')) {
    const parts = sid.replace(/^bili_series_/, '').split('_');
    const mid = parts[0];
    const seriesId = parts[1];
    const res = await src.get('https://api.bilibili.com/x/series/archives?mid=' + mid + '&series_id=' + seriesId + '&pn=' + pn + '&ps=' + ps, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const data = src.parse.json(res.body)?.data;
    const meta = data?.meta || {};
    const archives = data?.archives || [];
    const total = data?.page?.total || archives.length;
    const hasMore = pn * ps < total;
    const result = {
      id: sid,
      name: meta.name || '',
      artwork: cleanPic(meta.cover || ''),
      description: meta.description || '',
      owner: meta.name || '',
      items: archives.map(a => ({
        id: a.bvid,
        bvid: a.bvid,
        title: cleanTitle(a.title || ''),
        duration: a.duration,
        cover: cleanPic(a.pic || ''),
      })),
      hasMore,
      cursor: hasMore ? String(pn + 1) : undefined,
      trackCount: total,
    };
    src.log('getBiliPlaylist(series ' + seriesId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + hasMore + ', name=' + previewValue(result.name));
    return result;
  } else {
    const mediaId = sid.replace(/^bili_collect_/, '');
    const res = await src.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=' + mediaId + '&pn=' + pn + '&ps=' + ps, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const data = src.parse.json(res.body)?.data;
    const info = data?.info || {};
    const medias = data?.medias || [];
    const hasMore = data?.has_more || false;
    const result = {
      id: sid,
      name: info.title || '',
      artwork: cleanPic(info.cover || ''),
      description: info.intro || '',
      owner: info.upper?.name || '',
      items: medias.map(m => ({
        id: m.bvid || String(m.id),
        bvid: m.bvid,
        title: cleanTitle(m.title || ''),
        duration: m.duration,
        cover: cleanPic(m.cover || ''),
        artist: m.upper?.name || '',
        artistId: m.upper ? String(m.upper.mid) : undefined,
        upper: m.upper ? { id: String(m.upper.mid), name: m.upper.name } : undefined,
      })),
      hasMore,
      cursor: hasMore ? String(pn + 1) : undefined,
      trackCount: info.media_count,
    };
    src.log('getBiliPlaylist(collect ' + mediaId + ', page ' + pn + ') → ' + result.items.length + ' item(s), hasMore=' + hasMore + ', name=' + previewValue(result.name));
    return result;
  }
}

async function getBiliLibraryList(kind, page) {
  if (kind !== 'playlist') {
    src.log('getBiliLibraryList(' + kind + ') → 0 item(s) (kind not supported)');
    return { items: [], hasMore: false };
  }

  const navRes = await src.get('https://api.bilibili.com/x/web-interface/nav', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
    },
  });
  const navData = src.parse.json(navRes.body);
  const mid = navData?.data?.mid;
  if (!mid) {
    src.log('getBiliLibraryList(playlist) → 0 item(s) (not signed in, no mid)');
    return { items: [], hasMore: false };
  }

  const items = [];

  try {
    const createdRes = await src.get('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + mid, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const createdData = src.parse.json(createdRes.body)?.data;
    const list = createdData?.list || [];
    for (const f of list) {
      items.push({
        id: 'bili_collect_' + f.id,
        name: f.title,
        addedAt: f.ctime ? f.ctime * 1000 : undefined,
      });
    }
  } catch (e) {}

  try {
    const colRes = await src.get('https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid=' + mid + '&pn=1&ps=50&platform=web', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    const colData = src.parse.json(colRes.body)?.data;
    const list = colData?.list || [];
    for (const f of list) {
      items.push({
        id: 'bili_collect_' + f.id,
        name: f.title,
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
