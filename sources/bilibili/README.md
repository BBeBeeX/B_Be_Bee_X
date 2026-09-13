# Bilibili 源说明

BBeBee 的 Bilibili 音乐源:把 B 站的视频、音频榜单、UP 主投稿、收藏夹与合集变成可搜索、可浏览、可播放的音源。遵循本仓库"音乐源是文档不是插件"的模型——`source.json` 声明规则,`source.js` 提供被规则调用的 JS 库,由 `plugin-source-runtime` 在 QuickJS 沙盒里解释执行,本目录没有任何宿主能力。

接口全部对照 [bilibili-api-collect](https://github.com/bilibili-plugins/bilibili-api-collect) 实现,关键响应结构经直连实测核对(2026-09)。

---

## 功能一览

| # | 功能 | 入口 |
|---|---|---|
| 1 | 搜索视频(分页) | `search({ text })` → `SearchResult.tracks` |
| 2 | 搜索用户(UP主,分页) | `search({ text })` → `SearchResult.artists` |
| 3 | 音频榜单·当期/每期 | `browse()` → 音乐热榜/原创音乐榜 × 当期/每期 |
| 4 | UP 主数据 + 全部投稿 | `getArtist(mid)` → 用户卡片、合集、全部视频 |
| 5 | 收藏夹 / 合集 / 系列播放列表 | `getPlaylist(id)` → 分页取全 |
| 6 | 视频信息 / 音频流 / 字幕 | `getTrack` / `resolveStream` / `getLyrics` |
| 7 | 扫码登录 + Cookie 自动刷新 | `auth`(qrcode 流程) |

## 文件与构建

```
sources/bilibili/
├── source.json   # 元数据 + 规则(引用 jsLib 中的函数)
├── source.js     # jsLib:全部 @js: 规则落在这里
└── README.md     # 本文档
```

```bash
pnpm build:sources        # 编译 + 校验 → fixtures/sources/bilibili.json(单文件,jsLib 内联)
pnpm watch:sources        # 监视重建
node --experimental-strip-types scripts/sources/cli.ts --unpack fixtures/sources/bilibili.json   # 反解回双文件
```

语料回放测试:`packages/feature/plugin-source-runtime/src/bilibili.test.ts`(真实 QuickJS 沙盒 + 录制响应)。

## 规则块(source.json)

| 块 | 说明 |
|---|---|
| `header` | 顶层请求头规则(浏览器 UA + Referer),覆盖运行时自己发起的抓取(搜索/浏览) |
| `searchUrl` | `{{@js:biliSearchUrl(key, page)}}` — 视频搜索(WBI 签名) |
| `searchArtistUrl` | `{{@js:biliUserSearchUrl(key, page)}}` — 用户搜索(`search_type=bili_user`) |
| `ruleSearch` | 视频行:`trackId=$.bvid`,标题经 `cleanTitle`(去 `<em class="keyword">` 与实体),`parseDuration("3:33")` → 毫秒 |
| `ruleSearchArtist` | 用户行:`trackId=$.mid`、`title=$.uname`、`artwork=item.upic`,由运行时映射为 `Artist{urn,name,artwork}` |
| `exploreUrl` | `{{@js:biliExploreUrl()}}` — 生成 4 个 browse 栏目(见下) |
| `ruleExplore` | `trackList=@js:biliExploreRows(result)` — 同一规则处理两种榜单文档(期数列表 / 歌曲列表) |
| `ruleStream` | `url=resolveBiliStream(track, prefs)`;`headers`=Referer+UA(CDN 必需,经桌面 IPC `stream:set-headers` 注册);`seekable=true`(跳过 HEAD 探测);`expiresAt`=2 小时 |
| `ruleLyric` | `getBiliLyrics(track)` → LRC |
| `ruleArtist` | `getBiliArtist(id)` |
| `rulePlaylist` | `getBiliPlaylist(id, page)` |
| `ruleLibrary` | `getBiliLibraryList(kind, page)` — 登录后返回自己的收藏夹(`bili_collect_*`) |
| `loginType=qrcode` | `loginQrJs / loginPollJs / loginRefreshJs / loginCheckJs` |

**榜单浏览结构**(browse 两级:`explore` → `tracks`):

```
浏览根
├── 音乐热榜·当期   → toplist/music_list?list_id=<最新一期>   (直接出歌)
├── 音乐热榜·每期   → toplist/all_period?list_type=1          (期数列表,当期第一)
│     └── 2022年 第29期 → toplist/music_list?list_id=38      (该期歌曲)
├── 原创音乐榜·当期 / 每期                                       (同上,list_type=2)
```

`biliExploreRows(result)` 按文档形态分派:期数文档按 `publish_time` 降序(接口按年升序,须重排才能当期第一),行带 `kind: 'folder'` + `childUrl`;歌曲文档行映射到 `mv_bvid || creation_bvid`(MV/关联稿件视频),无 bvid 的纯音频行跳过(MA id 不是 auid,音频直连接口不可用,详见"已知限制")。

## jsLib 函数参考(source.js)

| 函数 | 作用 |
|---|---|
| `ensureBuvid()` | 一次性风控引导:`x/frontend/finger/spi` 取 `b_3/b_4` 写入源 cookie jar(`.bilibili.com` 域,缓存 6h)。没有 buvid3,搜索返回 -412 |
| `getWbiMixinKey()` | `x/web-interface/nav` 取 `wbi_img` 双 key,按固定置换表取前 32 位;缓存 1h,nav 失败时退回硬编码 key(仅应急) |
| `signWbiQuery(params)` | WBI 签名:`wts`(秒)入参 → 按 key 排序 → **值过滤 `!'()*`** → `encodeURIComponent` → `w_rid=md5(query+mixinKey)`。漏掉值过滤,服务端复算必不匹配 |
| `biliSearchUrl / biliUserSearchUrl` | 两个搜索端点的 URL 构造(均 WBI + buvid) |
| `biliExploreUrl()` | 榜单栏目构造(抓两榜期数,算最新 `ID`;栏目缓存 10 分钟) |
| `biliExploreRows(result)` | 期数/歌曲两种文档 → 统一 browse 行(`kind`、`childUrl`、`durationMs` 取 `creation_duration`) |
| `trackBvid(track) / ensureCid(track)` | 从 `track.bvid || onlineId || id` 取 bvid;`x/player/pagelist` 取第一页 cid,按 bvid 缓存 1h |
| `resolveBiliStream(track, prefs)` | 取流,见下节 |
| `getBiliLyrics(track)` | 签名调用 `x/player/wbi/v2` → 选字幕(人工中文 > AI 中文 > 第一条)→ JSON 转 LRC(真实换行) |
| `getBiliQrCode / pollBiliQrCode` | 二维码登录:`passport …/qrcode/generate|poll`;轮询码 0=确认(Set-Cookie 自动入 jar)、86090=已扫、86038=过期、86101=未扫 |
| `refreshBiliCookie()` | Cookie 刷新:`cookie/info`(timestamp)→ RSA-OAEP-SHA256(`refresh_<ts>`)hex → `correspond/1/<hex>` 页面抓 `refresh_csrf` → `cookie/refresh` → `confirm/refresh`;新 `refresh_token` 存入 `src.vars` |
| `getBiliArtist(id)` | 用户卡片(`x/web-interface/card`)+ 合集/系列(`seasons_series_list`,id 编码 mid)+ **全部投稿**(`x/space/wbi/arc/search`,ps=50 翻页至短页,上限 40 页;失败回退 `recArchivesByKeywords`) |
| `parsePlaylistTarget(raw)` | 播放列表 id 归一化,见下节 |
| `getBiliPlaylist(id, page)` | 收藏夹 / 合集 / 系列三分支,`hasMore`+`cursor` 分页 |
| `getBiliLibraryList(kind)` | 登录后:`fav/folder/created/list-all` + `collected/list` → 自建与收藏的收藏夹 |
| `cleanTitle / cleanPic / parseDuration / previewValue` | 文本/图片/时长工具与日志预览 |

## 音频流与音质

`resolveBiliStream` 对 `x/player/wbi/playurl` 发 WBI 签名请求,参数 `qn=127, fnval=8144, fourk=1`。**fnval 必须含 4096 位**,Hi-Res(30251)才会在响应里出现。

DASH 音频 id → 档位(文档口径,勿凭带宽猜测):

| id | 档位 | 编码 |
|---|---|---|
| 30216 | low | AAC 64K |
| 30232 | normal | AAC 132K |
| 30280 | high | AAC 192K |
| 30250 | dolby(永不选) | E-AC-3 — Chromium 解不了,按带宽排序它会赢,所以显式剔除 |
| 30251 | hi-res | FLAC |

选择按 `prefs.quality` 走档位阶梯(播放器默认 `lossless` → 优先 30251,没有就退到最好的 AAC),再过一遍 `prefs.acceptFormats`(桌面 codec 支持表无 dolby,天然兜底);每档内按带宽取最高。未登录时接口只发 30216/30232,阶梯自然落到底。

## 标识与 URN 约定

- 视频 trackId = `bvid`;榜单行同(mv/creation bvid)。URN:`BBeBee:<sourceId>:track:<bvid>`。
- 传给 stream/lyric 规则的 `track` = 存库 payload(原始行 + 规则求值字段)+ `id`(URN id 段),所以 `track.bvid`、`track.cid`(收藏夹行)都在。
- 播放列表 id 接受的输入(`parsePlaylistTarget`):

| 输入 | 归一化为 |
|---|---|
| `bili_collect_<mlid>` / 裸数字 / `space.bilibili.com/<mid>/favlist?fid=<mlid>` | 收藏夹(`x/v3/fav/resource/list`) |
| `bili_season_<mid>_<sid>` / `space.bilibili.com/<mid>/channel/collectiondetail?sid=<sid>` | 合集(`seasons_archives_list`,**mid 必需**,实测错 mid 返回 -404) |
| `bili_series_<mid>_<sid>` / `…/seriesdetail?sid=<sid>` | 系列(`x/series/archives`) |

## 登录与凭据

二维码登录后 `SESSDATA/bili_jct` 由 Set-Cookie 自动落入源的持久 cookie jar;`refresh_token` 存 `src.vars`(凭证级,登出清除)。`loginCheckJs: result?.code !== -101` 在每次搜索/浏览抓取后校验会话,false 触发 `AuthError` → 运行时自动跑 `loginRefreshJs` 刷新后重试一次。登录状态还解锁高音质(192K 以上 / Hi-Res 需大会员)与收藏夹列表。

## 风控要点

1. **buvid3 必需**——搜索等 web 接口对无该 cookie 的客户端直接 -412;`ensureBuvid` 在每次搜索/浏览前确保就位。
2. **浏览器 UA + Referer**——jsLib 每个请求显式带 `BROWSER_HEADERS`;文档顶层 `header` 覆盖运行时自发起的抓取。
3. **WBI 签名三步缺一不可**——wts、排序、值过滤 `!'()*`;签名正确性由语料测试用文档示例密钥独立复算 `w_rid` 钉死。
4. `concurrentRate: "5/1000"` 声明限速;搜索一次会发 1–2 个请求(视频 + 用户,后者失败可降级)。

## 已知限制

- **榜单纯音频行不可播**:榜单条目的 `music_id`(MA…)不是旧 auid,`music-service-c` 音频接口对它返回 4511001(实测);这类行(无 mv/creation bvid)被跳过。
- `load({strategy:'stream'})` 无移动端实现——长视频流播放目前仅桌面可用(仓库级 M2 缺口)。
- Hi-Res/杜比实际下发取决于账号权益;未登录音质上限 132K AAC。
- 用户搜索一次最多返回一页 20 条(接口行为);视频/用户各自分页正常。
- 合集 id 离不开 mid:旧格式 `bili_season_<sid>` 无法换算,会报带指引的错误。

## 使用的接口清单(对照 bilibili-api-collect)

| 接口 | 用途 | 文档 |
|---|---|---|
| `x/frontend/finger/spi` | buvid3/buvid4 | `docs/misc/buvid.md` |
| `x/web-interface/nav` | WBI keys、登录态 | `docs/misc/sign/wbi.md` |
| `x/web-interface/wbi/search/type` | 视频 / 用户搜索(WBI) | `docs/search/search_request.md` |
| `x/copyright-music-publicity/toplist/all_period` | 榜单每期列表 | `docs/audio/rank.md` |
| `x/copyright-music-publicity/toplist/music_list` | 榜单单期内容 | `docs/audio/rank.md` |
| `x/player/pagelist` | 分页 cid | `docs/video/…` |
| `x/player/wbi/playurl` | DASH 音频流(WBI) | `docs/video/videostreamurl.md` |
| `x/player/wbi/v2` | 字幕列表(WBI) | `docs/video/subtitle.md` |
| `x/web-interface/card` | 用户数据(头像/名称/id) | `docs/personal_space/…` |
| `x/space/wbi/arc/search` | UP 主全部投稿(WBI) | `docs/personal_space/…` |
| `x/series/recArchivesByKeywords` | 投稿列表回退 | `docs/…` |
| `x/polymer/web-space/seasons_series_list` / `seasons_archives_list` | 合集列表 / 合集内容 | `docs/…` |
| `x/series/archives` | 系列内容 | `docs/…` |
| `x/v3/fav/resource/list`、`fav/folder/created/list-all`、`fav/folder/collected/list` | 收藏夹内容与列表 | `docs/fav/…` |
| `passport …/qrcode/generate|poll`、`cookie/info|refresh`、`confirm/refresh` | 登录与 Cookie 刷新 | `docs/login/…` |
