# @BBeBee/plugin-sources-ui-desktop

Layer 5（ui）— `plugin-sources`（headless）的桌面视图包：布局、手势与事件接线，别无其他。

## 概述

把 headless 贡献的 4 个视图 id（`SOURCES_VIEWS`）绑到桌面 kit 组件上。全部领域状态来自 `@BBeBee/plugin-sources/hooks`；服务经注入的 `ctx.sources` 访问；对 headless 包只有 devDependency（类型/常量/测试用）——不是运行时 import，符合"Layer 5 对 Layer 4 仅 types"的规则。

**共同纪律**（文件头注释）：loading / empty / failed 三态必须区分——混同会让用户面对一块空白而不知是没扫完还是读库失败。`Pending`（`EmptyState`）与 `Failed`（⚠ + 错误信息 + "Try again" 重试）是这条纪律的实现。

## 源文件

### `src/index.tsx`

**注册的视图**（`apply` 经 generator effect `yield ctx.ui.registerView(...)`，fiber 名 `'sources-ui-desktop'`）：

| id | 组件 |
|---|---|
| `sources.library` | `LibraryScreen` |
| `sources.album` | `AlbumScreen` |
| `sources.import` | `ImportScreen` |
| `sources.debug` | `DebugScreen` |

> `sources.settings`（源列表设置屏）已由 headless 贡献描述符、`useSources`/`useLiveSourceIds` hooks 也已备好，但**两侧都尚未实现**——当前最明显的缺口。

**各屏幕**：

- **`LibraryScreen`** — 主屏。Tracks/Albums 双 tab（`role="tablist"` + 两个 `Button`，激活态 primary）；`useTracks`/`useAlbums`（headless 的 `PagedState`：items/hasMore/loadMore/reload、generation 防重、监听 `library/changed` 自动重载）→ 统一三态分支 → `List` + `TrackRow`（`showAlbum: true`，`estimatedItemSize: tokens.size.row`，`onEndReached: loadMore`）；空态 📁 "No music yet"。**点单曲只把这一首入队**（`playNow([urn])`）；专辑列表行点击 → `onOpenAlbum(album.urn)` 由 shell 路由接走（`/album/:urn`）。desktop 侧有内部组件 `AlbumGrid`（名字如此，实为单列行布局：`<button>` + `Artwork` 缩略 + 标题/年份，`estimatedItemSize: 220`）。
- **`AlbumScreen({ urn })`** — `useAlbum` → header（横排：160px `Artwork` + 标题/艺人 + "Play album"）+ 曲目 `List`（`showArtwork: false`）。播放语义：**"Play album" → `playNow(全部曲目)`，`disabled: 无曲目`——禁用而非隐藏**（"没有可播曲目的专辑"是真实状态，藏掉按钮就藏掉了原因）；点单轨 → `playNow(全部 URN, { startIndex: index })`——"在专辑语境下播放这一轨 = 从这里开始播整张"。
- **`ImportScreen`** — 粘贴源字符串（单个文档或整个 set）。本屏存在的理由：论坛粘贴来的 set 是不透明的，"静默加进 11 个源"的导入是用户无法撤销的，所以**按按钮之前就要点名将会导入什么**。`useSourceImport`（输入即解析的 `preview`、每次提交的**全部** `issues`、`busy`/`report`/`submit`/`reset`）→ 多行 `TextField`（`rows: 14`，placeholder 含 `ruleStream`）→ 预览块（`aria-label='What will be imported'`，"N source(s)" + 名字列表）→ `Import` 按钮（`disabled: busy || !preview`）+ `Clear` → 结果行 `summariseImport(report)`："N added, N updated, N unchanged, N rejected"，**永不为空字符串**（"nothing to import" 也要说出来，否则读起来像按钮没工作）。
- **`DebugScreen({ sourceId })`** — 单源诊断，**tracer 与编辑器刻意合一**（docs/06 §10）：修一个腐坏源的循环是"跑一步 → 看哪条规则挂了 → 改 → 再跑"，拆成两屏就把几秒钟的修复变成导航练习。`useSourceTrace`（事件**到达即追加**——对无响应服务器的诊断恰恰是"一行 http 后面什么没有"；generation 防交错）+ `useSourceEditor`（保存走 `import()` 按 `sourceUrl` 去重、**保 id**——URN/缓存/引用全部存活；冲突显式报错而非覆盖）。UI：搜索词 + "Run search"（横排一行）→ `TraceList` → "The document" + 多行编辑器（`rows: 16`）→ "Save and re-run"（`disabled: !dirty`）+ "Revert"。`TraceList` 是 `<ol aria-live="polite">`、mono 字体、每条左侧 3px 色条（error 红）；`traceLine` 按 4 种 `TraceEvent.kind` 排版：`http` → `METHOD url → status (Nms)`（**status 0 显式写成 "no response"**）、`rule` → `block.field [engine] rule → output`、`error` → `✗`、`result` → `✓`。**包括成功的每一步都显示**——失败通常发生在空结果往前两步；数据已在上游 redacted，这里只排版。

**`bound(ctx, Screen)`** — 绑定到**本插件**的 context 而非 shell 的（shell 渲染视图用的是 `app.ready(['ui'])` 的 context，读 `ctx.sources` 会抛 `cannot get property … without inject`）；必须 `h(Screen, …)` 而非 `Screen(…)`——函数调用会把子组件的 hooks 拼进父组件的 hook 链表。

## 测试（`src/screens.test.tsx`）

jsdom + Testing Library，**对真实 `ctx.sources` 渲染而非 mock**——值得钉住的是交互语义（粘贴后提交前显示什么、坏文档给用户留下什么）。harness：真实 `FsNode`/`DbNode(':memory:')`/`sourcesPlugin`，然后从**包自己的 `inject` 派生** scoped context（两者不会漂移）。9 个用例：导入预览先于写入（`sources` 仍为 0）、空输入禁用、导入成功报 "1 added"、坏粘贴**保留输入 + 一次给出全部问题**、编辑器逐字节显示 `docJson`、未改时 save 禁用、保存后 **id 不变**、未跑 trace 显示 "No trace yet"、以及最重的 Library 用例——`withListLayout` 里点击曲目时**经 `window.addEventListener('error')` 收集**未捕获错误断言为零（"plays a track without a player loaded, instead of throwing"——真机 bug 的回归测试：测试建的 root context 对缺席服务答 `undefined`，设备上的 scoped context 会抛）。

## 相关文档

- `docs/08-ui-architecture.md`：descriptors、双壳、渲染规则
- `packages/feature/plugin-sources/README.md`：headless 侧的 hooks 与视图 id
- `packages/ui/plugin-sources-ui-mobile/README.md`：孪生半边
