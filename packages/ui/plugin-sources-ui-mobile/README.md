# @BBeBee/plugin-sources-ui-mobile

Layer 5（ui）— `plugin-sources`（headless）的移动视图包：`plugin-sources-ui-desktop` 的孪生半边。

## 概述

与桌面版**同一组 hooks、同一组视图 id、同一套行为**——只有元素与形状不同。领域状态全部来自 `@BBeBee/plugin-sources/hooks`；kit 原语经 `nativePrimitives()` 取用（`ui-kit-mobile` 的 `configureNative` 注入）；对 headless 包只有 devDependency。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect，fiber 名 `'sources-ui-mobile'`）：`sources.search` / `sources.settings` / `sources.import` / `sources.test`，四个与桌面同构。库首页在 `plugin-library-ui-mobile`，专辑详情在 `plugin-album-ui-mobile`。

**各屏幕**（行为与桌面一致，以下列移动端差异）：

- **`AlbumScreen`** — 已迁至 `plugin-album-ui-mobile`（`album.view`）：居中竖排 header、200px 封面、返回库的兜底导航。库与搜索屏只负责导航到该 route id。
- **`ImportScreen`** — 多行 `TextField` `rows: 10`（桌面 14）；placeholder 较短；报告文本 tone 恒 `'muted'`（桌面在 added/updated > 0 时用 `'accent'`）。预览、全部 issues、`summariseImport` 行为一致。
- **`SearchScreen`** — 与桌面同一组 hooks 与同一套行模型：hero 态（搜索条 + 源开关居中）→ 提交后收缩到顶部、结果占满剩余高度；Clear 回 hero。差异只在布局：搜索框与 Search/Clear 按钮**竖排堆叠**（桌面横排），源开关横排 wrap，结果仍是一条 `List`（FlashList）承载每源 section，track 点击 `playFromList`，专辑行交给路由。
- **`TestScreen({ sourceId })`** — 与桌面同构，差异全在控件：源选择器是 **Button + 展开的选项列表**（RN 没有原生 `<select>`），测试区与字段竖排堆叠，Stream 区没有质量输入框（走默认质量），trace 用 `View` + `borderLeftWidth/Color` + `Text variant: 'sm'`（无 aria-live 等价物）。文件注释补了一句：这屏在手机上最重要——从论坛贴的源就是在设备上坏的，而"源即字符串"模型的全部意义就是当场能修。

**`bound(ctx, Screen)`** — 与所有视图包相同：闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用。

## 测试（`src/screens.test.tsx`）

jsdom + Testing Library。因 jsdom 没有 RN，先 `configureNative({…})` 注入 DOM host 组件冒充 View/Text/Pressable/Image/Modal/ActivityIndicator/TextInput，**FlashList 单独实现**（吃 `data/renderItem/ListEmptyComponent` 而非 children，把 `accessibilityLabel/Role`、`testID`、`onPress` 映射到 DOM 属性）——与 `apps/mobile` 交出真 RN 用的是**同一条缝**。

11 个用例（mobile 文件头明确定位：钉死共同假设（context 形状），而非全屏 parity）：

1. **Library（4）**——渲染给定目录（按 `inject` 派生的 scoped context + 真实 `sourcesPlugin`，库屏渲染出插入的 "Jóga"）；无 player 时点击必须 no-op（`reportedDuring` 收集点击错误断言为空——与桌面同源的真机 bug 回归）；空库显示 "No music yet"；All/Local/Favorites scope 切换；
2. **SourcesList（2）**——列出已导入源（名字 / URL / Test 按钮）、空列表显示 "No sources yet"；
3. **Test（1）**——无 sandbox 的构建里跑脚本，inline 报 "no JavaScript sandbox" 而不是静默失败；
4. **Search（4）**——搜索前只有搜索条与源开关、每源独立 section、失败源报错且其余源照常、被 toggle 关掉的源不会被问。移动端测试用 `query` prop 预填搜索词（host `TextInput` 不模拟输入）。

## 相关文档

- `docs/06-music-sources.md` §10：导入/编辑/追踪屏
- `packages/feature/plugin-sources/README.md`：headless 侧
- `packages/ui/plugin-sources-ui-desktop/README.md`：孪生半边（含更完整的桌面侧行为描述）
