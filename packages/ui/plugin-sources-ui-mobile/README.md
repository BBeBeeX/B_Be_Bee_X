# @BBeBee/plugin-sources-ui-mobile

Layer 5（ui）— `plugin-sources`（headless）的移动视图包：`plugin-sources-ui-desktop` 的孪生半边。

## 概述

与桌面版**同一组 hooks、同一组视图 id、同一套行为**——只有元素与形状不同。领域状态全部来自 `@BBeBee/plugin-sources/hooks`；kit 原语经 `nativePrimitives()` 取用（`ui-kit-mobile` 的 `configureNative` 注入）；对 headless 包只有 devDependency。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect，fiber 名 `'sources-ui-mobile'`）：`sources.library` / `sources.album` / `sources.import` / `sources.debug`，与桌面同构。（`sources.settings` 同样尚未实现。）

**各屏幕**（行为与桌面一致，以下列移动端差异）：

- **`LibraryScreen`** — Tracks/Albums 双 tab（`accessibilityRole: 'tablist'`）；专辑列表内联在屏内（`Pressable` + `accessibilityRole: 'button'`，无独立 `AlbumGrid`）；`List`（FlashList）+ `TrackRow`。点击播放/导航语义与桌面相同：单曲只入队自身，专辑行交给路由。
- **`AlbumScreen({ urn })`** — header 居中**竖排**（200px `Artwork`、标题 `numberOfLines: 2`），桌面为横排。"Play album" 禁用而非隐藏、单轨从 index 起播，语义与桌面逐字相同。
- **`ImportScreen`** — 多行 `TextField` `rows: 10`（桌面 14）；placeholder 较短；报告文本 tone 恒 `'muted'`（桌面在 added/updated > 0 时用 `'accent'`）。预览、全部 issues、`summariseImport` 行为一致。
- **`DebugScreen({ sourceId })`** — 查询框与 "Run search" **竖排堆叠**（桌面横排）；`TraceList` 用 `View` + `borderLeftWidth/Color` + `Text variant: 'sm'`（无 aria-live 等价物）；编辑器 `rows: 10`。文件注释补了一句：这屏在手机上最重要——从论坛贴的源就是在设备上坏的，而"源即字符串"模型的全部意义就是当场能修。

**`bound(ctx, Screen)`** — 与所有视图包相同：闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用。

## 测试（`src/screens.test.tsx`）

jsdom + Testing Library。因 jsdom 没有 RN，先 `configureNative({…})` 注入 DOM host 组件冒充 View/Text/Pressable/Image/Modal/ActivityIndicator/TextInput，**FlashList 单独实现**（吃 `data/renderItem/ListEmptyComponent` 而非 children，把 `accessibilityLabel/Role`、`testID`、`onPress` 映射到 DOM 属性）——与 `apps/mobile` 交出真 RN 用的是**同一条缝**。

3 个用例（mobile 文件头明确定位：钉死共同假设（context 形状），而非全屏 parity）：

1. "renders the catalogue it was given" — 按 `inject` 派生的 scoped context + 真实 `sourcesPlugin`，库屏渲染出插入的 "Jóga"；
2. "plays a track without a player loaded, instead of reporting an error" — 与桌面同源的真机 bug 回归：`plugin-player` 刻意缺席（用户会点进去的常态），点击必须 no-op 而非抛错（`reportedDuring` 收集点击错误断言为空）；
3. "renders an empty library as an empty state, not a blank screen" — 空库显示 "No music yet"。

## 相关文档

- `docs/06-music-sources.md` §10：导入/编辑/追踪屏
- `packages/feature/plugin-sources/README.md`：headless 侧
- `packages/ui/plugin-sources-ui-desktop/README.md`：孪生半边（含更完整的桌面侧行为描述）
