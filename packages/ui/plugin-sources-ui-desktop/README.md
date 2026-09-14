# @BBeBee/plugin-sources-ui-desktop

Layer 5（ui）— `plugin-sources`（headless）的桌面视图包：布局、手势与事件接线，别无其他。

## 概述

把 headless 贡献的 6 个视图 id（`SOURCES_VIEWS`）绑到桌面 kit 组件上。全部领域状态来自 `@BBeBee/plugin-sources/hooks`；服务经注入的 `ctx.sources` 访问；对 headless 包只有 devDependency（类型/常量/测试用）——不是运行时 import，符合"Layer 5 对 Layer 4 仅 types"的规则。

**共同纪律**（文件头注释）：loading / empty / failed 三态必须区分——混同会让用户面对一块空白而不知是没扫完还是读库失败。`Pending`（`EmptyState`）与 `Failed`（⚠ + 错误信息 + "Try again" 重试）是这条纪律的实现。

## 源文件

### `src/index.tsx`

**注册的视图**（`apply` 经 generator effect `yield ctx.ui.registerView(...)`，fiber 名 `'sources-ui-desktop'`）：

| id | 组件 |
|---|---|
| `sources.library` | `LibraryScreen` |
| `sources.search` | `SearchScreen` |
| `sources.album` | `AlbumScreen` |
| `sources.settings` | `SourcesListScreen` |
| `sources.import` | `ImportScreen` |
| `sources.test` | `TestScreen` |

六个视图在桌面与移动两侧都已实现。

**各屏幕**：

- **`LibraryScreen`** — 主屏。Tracks/Albums 双 tab（`role="tablist"` + 两个 `Button`，激活态 primary）；`useTracks`/`useAlbums`（headless 的 `PagedState`：items/hasMore/loadMore/reload、generation 防重、监听 `library/changed` 自动重载）→ 统一三态分支 → `List` + `TrackRow`（`showAlbum: true`，`estimatedItemSize: tokens.size.row`，`onEndReached: loadMore`）；空态 📁 "No music yet"。**点单曲 = 带语境点播**（headless 的 `playFromList(ctx, urn, { query })`）：`playFromContext` 先查队列——已有该曲则跳转、队列不动；没有则把当前 scope 指代的**整个列表**（全部/本地/收藏，经 `listAllTracks` 翻页取全，非已加载的页）换入队列并从点击处播；专辑列表行点击 → `onOpenAlbum(album.urn)` 由 shell 路由接走（`/album/:urn`）。desktop 侧有内部组件 `AlbumGrid`（名字如此，实为单列行布局：`<button>` + `Artwork` 缩略 + 标题/年份，`estimatedItemSize: 220`）。
- **`AlbumScreen({ urn })`** — `useAlbum` → header（横排：160px `Artwork` + 标题/艺人 + "Play album"）+ 曲目 `List`（`showArtwork: false`）。播放语义：**"Play album" → `playNow(全部曲目)`（显式的"从头播这张"手势，直接替换队列），`disabled: 无曲目`——禁用而非隐藏**（"没有可播曲目的专辑"是真实状态，藏掉按钮就藏掉了原因）；点单轨 → `playFromList(ctx, urn, { urns: 全部曲目, context: { kind: 'album', urn, label } })`——同样跳转优先，否则整张专辑成为队列并从点击处起播。**播放不导航**：走带条/mini-player 自己宣布正在播放，用户停在原地。
- **`ImportScreen`** — 粘贴源字符串（单个文档或整个 set）。本屏存在的理由：论坛粘贴来的 set 是不透明的，"静默加进 11 个源"的导入是用户无法撤销的，所以**按按钮之前就要点名将会导入什么**。`useSourceImport`（输入即解析的 `preview`、每次提交的**全部** `issues`、`busy`/`report`/`submit`/`reset`）→ 多行 `TextField`（`rows: 14`，placeholder 含 `ruleStream`）→ 预览块（`aria-label='What will be imported'`，"N source(s)" + 名字列表）→ `Import` 按钮（`disabled: busy || !preview`）+ `Clear` → 结果行 `summariseImport(report)`："N added, N updated, N unchanged, N rejected"，**永不为空字符串**（"nothing to import" 也要说出来，否则读起来像按钮没工作）。
- **`SearchScreen`** — 跨源搜索。hero 态：搜索条在顶部、源开关垂直居中；提交后两者收缩到顶部，剩余高度给结果。状态全部来自 headless：`useSearchSourceSelection`（**排除式**选择——所有可搜索的源默认选中，后导入的源自动加入下一次搜索）、`useSourceSearch`（`searchAll`，generation 防后发结果被先发覆盖）、`searchResultRows`（摊平成单条虚拟 `List`：每源 header + track/album/artist/playlist 行）。每个源的失败、超时、无结果都保留自己的 header（`entry.error.message` / "still searching…" / "no matches · N ms"）；track 行点击走 `playFromList`（本段队列 + `{ kind: 'search', label }` 语境），专辑行导航 `/album/:urn`。Clear 回到 hero；搜索框为空或一个源都没选时 Search 禁用。
- **`TestScreen({ sourceId })`** — 单源逐能力测试（docs/06 §10）。桌面用原生 `<select>` 选源；每个测试区只在 provider 的派生能力/方法存在时出现——Search（`capabilities.search.tracks`）、Browse、Album/Artist/Playlist/Lyrics（方法存在）、Library list（`capabilities.library.read`）、Stream（有 provider 即有，质量选项来自 `capabilities.streaming.qualities`），外加两个与文档无关的探针：经源自身 client 发 HTTP（GET/POST、URL、headers JSON、body）与脚本（文档函数在作用域内，code + args JSON）。所有运行流进右栏 `TraceList`（`<ol aria-live="polite">`、mono 字体、每条左侧 3px 色条）：`http` → `METHOD url → status (Nms)`（**status 0 显式写成 "no response"**）、`error` → `✗`、`result` → `✓`、`log` → `·`，`value` 事件用 `JsonTree`（解析失败则原样文本）。左栏 440px 独立滚动，未跑过显示 "No trace yet"。**包括成功的每一步都显示**——失败通常发生在空结果往前两步；数据已在上游 redacted，这里只排版。

**`bound(ctx, Screen)`** — 绑定到**本插件**的 context 而非 shell 的（shell 渲染视图用的是 `app.ready(['ui'])` 的 context，读 `ctx.sources` 会抛 `cannot get property … without inject`）；必须 `h(Screen, …)` 而非 `Screen(…)`——函数调用会把子组件的 hooks 拼进父组件的 hook 链表。

## 测试（`src/screens.test.tsx`）

jsdom + Testing Library，**对真实 `ctx.sources` 渲染而非 mock**——值得钉住的是交互语义（粘贴后提交前显示什么、坏文档给用户留下什么）。harness：真实 `FsNode`/`DbNode(':memory:')`/`sourcesPlugin`，然后从**包自己的 `inject` 派生** scoped context（两者不会漂移）。14 个用例，四组：

1. **Import（4）**——预览先于写入（`sources` 仍为 0）、空输入禁用、导入成功报 "1 added"、坏粘贴**保留输入 + 一次给出全部问题**；
2. **Test（3）**——测试区随 provider 的能力/方法出现且不多不少、选择器默认第一源、未跑 trace 显示 "No trace yet"；
3. **Library（3）**——最重的一条：`withListLayout` 里点击曲目时**经 `window.addEventListener('error')` 收集**未捕获错误断言为零（"plays a track without a player loaded, instead of throwing"——真机 bug 的回归测试：测试建的 root context 对缺席服务答 `undefined`，设备上的 scoped context 会抛）；另两条是带列表语境点播且不导航、All/Local/Favorites scope 切换；
4. **Search（4）**——搜索前只有搜索条与源开关（没有空结果屏）、每源一个独立 section（标题、"1 track"、track 标题）、失败源报错且其余源照常显示、被 toggle 关掉的源不会被问。

## 相关文档

- `docs/08-ui-architecture.md`：descriptors、双壳、渲染规则
- `packages/feature/plugin-sources/README.md`：headless 侧的 hooks 与视图 id
- `packages/ui/plugin-sources-ui-mobile/README.md`：孪生半边
