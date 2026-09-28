# @BBeBee/plugin-album-ui-desktop

Layer 5（ui）— `plugin-album`（headless）的桌面视图包：专辑页的布局与事件接线。

## 概述

把 `album.view` 绑到桌面 kit 上。全部领域状态来自 `@BBeBee/plugin-album/hooks`；`ctx.sources` 经 `inject` 访问（读专辑必须），`player` / `downloads` 用 `serviceOf`（可选——没有就少一个控件，而不是整屏报错）。本包依赖 headless 的 `@BBeBee/plugin-album`（hooks 与 route id）。

从 `plugin-sources-ui-desktop` 整体迁入（route/view/`useAlbum` 一起走），库与搜索屏现在只负责导航到 `ALBUM_VIEWS.album`。

## 源文件

### `src/index.tsx`

**注册的视图**：`album.view` → `AlbumScreen`（generator effect，fiber 名 `'album-ui-desktop'`）。

**`AlbumScreen({ urn })`** — `useAlbum` → 三态分支（`Pending` / "Album unavailable" + 原因 / 内容）：

- **header（随列表滚走）**：横排 232px `Artwork`（经 `CachedArtwork` 走 `ctx.cache`，未命中先画 fallback，不把远端 URL 交给第二个请求）+ 标题 + 艺人 + "Play album"。hero 与操作栏放进 `List` 的 `header` 插槽随内容滚走；播放按钮靠近顶部时 `StickyDetailBar` 吸顶栏（标题 + 播放按钮）从视口上方滑入，滚过其一半高度时吸附（缩放动作），表头吸附在吸顶栏正下方。页面背景与吸顶栏底色取自封面 `dominantColor`（`useImageColor`，缺失时画布提取，失败回退中性渐变）；
- **操作栏与多维排序**：
  - 绿色主播放按钮（`▶`）、随机播放、爱心收藏按钮（`♥`/`♡` 接线 `library.setSaved`，收藏后同步在音乐库中呈现）与 `⋯` 更多操作；
  - 专辑三点菜单提供「加入文件夹」（原加入合集）、「添加到音乐库/从音乐库中删除」、「加入播放列表」、「下载」（本地专辑自动隐藏）与「睡眠定时器」，移除了原冗余的「加入歌单」与「转至专辑」；
  - 右侧提供排序下拉菜单（如 `默认顺序 ≣` / `标题 ≣`），点击弹出 `ContextMenu` 支持在默认序号、标题、时长、播放量之间快速切换并支持升降序切换。
- **曲目列表与表头交互**：
  - 表头列（`#`、`标题`、播放量、`🕒 时长`）支持鼠标点击排序，再次点击切换升序/降序，高亮当前排序列并展示箭头指示器（`▲`/`▼`）。
  - 曲目 `List`：`showArtwork: false`，`estimatedItemSize: tokens.size.row`，空专辑显示 "This album has no tracks"；本地专辑单曲行不显示下载按钮；
  - 行内 `TrackLibraryActionButton`：未收藏显示 `＋`，点击**双写**两个存储（先 `sources.setLoved` 再 `library.setSaved`）；已收藏显示 `♥`，点击弹出「添加到歌单」弹层。在库状态由实时收藏集合 + `library/changed` 时重读 loved 决定——专辑数据里的 `track.loved` 只是加载时快照，页面在 `library/changed`（kind `track`）时按事件 URN 重读目录，取消收藏后该行回到 `＋`；
- **播放语义**（本屏存在的理由）：
  - "Play album" → `player.playNow(排序后的全部曲目)`——**显式的"从头播这张"手势，直接替换队列**；`disabled: 无曲目`，禁用而非隐藏。
  - 点单轨 → `player.playFromContext(track, 排序后的全部曲目, { context: { kind: 'album', urn, label } })`——播放语境与当前页面排序完全一致。
  - **播放不导航**：走带条自己宣布正在播放，用户停在原地。
- **下载**：非本地专辑时 `onDownload` → `ctx.downloads.enqueue([urn])`；本地专辑（`BBeBee:local:`）自动隐去下载按钮与菜单项；没有 `ctx.downloads` 的构建不画这个按钮。

**`bound(ctx, Screen)`** — 绑定到本插件的 context（shell 渲染视图用的是 `app.ready(['ui'])` 的 context，读 `ctx.sources` 会抛 `cannot get property … without inject`）；`h(Screen, …)` 而非函数调用，否则子组件 hooks 会拼进父组件链表。

## 测试（`src/screens.test.tsx`）

jsdom + Testing Library，`withListLayout` 给虚拟列表量高；harness 注册 sources/player/downloads/ui 桩并从 `inject` 派生 scoped context。测试用例涵盖：

1. 画出专辑 + "Play album" → `playNow([A, B])`（逐字；hero 与吸顶栏各有一个 Play album，取第一个）；
2. 点 "Jóga" → `playFromContext(B, [A, B], { kind: 'album', urn, label: 'Homogenic' })`；
3. 下载按钮 → `downloads.enqueue([A])` 且**不触碰播放**；
4. 缺失专辑 → "Album unavailable" + "no album"，而不是一张空页；
5. 点击表头列进行排序切换，并验证点击曲目时 `playFromContext` 接收反转/排序后的 URN 列表；
6. 操作栏排序下拉菜单切换排序键，并验证排序后的播放队列上下文；
7. 专辑级爱心按钮切换 `isSaved`（`♥`/`♡` 图标随状态翻转）；
8. 行内 `TrackLibraryActionButton`：`＋` 点击写入收藏并即时变 `♥`，再点弹出「添加到歌单」弹层；
9. 本地专辑隐藏全部下载入口；
10. 三点菜单项集合与「添加到音乐库」动作；
11. 专辑列表头存在并支持排序切换。

## 相关文档

- `packages/feature/plugin-album/README.md`：headless 侧与 route id
- `packages/ui/plugin-album-ui-mobile/README.md`：孪生半边
- `packages/ui/plugin-sources-ui-desktop/README.md`：库/搜索屏（导航入口）
