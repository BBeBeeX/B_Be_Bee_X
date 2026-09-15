# @BBeBee/plugin-album-ui-mobile

Layer 5（ui）— `plugin-album`（headless）的移动视图包：`plugin-album-ui-desktop` 的孪生半边。

## 概述

与桌面版**同一组 hooks、同一套播放语义**——只有元素与形状不同。领域状态来自 `@BBeBee/plugin-album/hooks`；kit 原语经 `nativePrimitives()` 取用；`ctx.sources` 经 `inject`，`player` / `downloads` 走 `serviceOf`（可选）。依赖 headless 的 `@BBeBee/plugin-album` 与 `@BBeBee/plugin-sources`（返回库的兜底 route id）。

## 源文件

### `src/index.tsx`

**注册的视图**：`album.view` → `AlbumScreen`（generator effect，fiber 名 `'album-ui-mobile'`）。

**移动端差异**（行为与桌面一致）：

- 顶部一条 **`‹ Library` 返回控件**：shell 传了 `onBack` 就用它；没有时兜底 `ui.navigate(SOURCES_VIEWS.library)`——不让用户停在一个走不出去的屏上（错误态的 "Back to library" 按钮走同一条路）；
- header **居中竖排**（200px 封面、标题 `numberOfLines: 2`），桌面为横排；
- "Play album" 同样**禁用而非隐藏**；
- 单轨点播与桌面逐字相同：`playFromContext(track, 全部曲目, { context: { kind: 'album', urn, label } })`，跳转优先，否则整张专辑成为队列并从点击处起播；**播放不导航**，mini-player 自己宣布正在播放；
- 下载按钮 → `ctx.downloads.enqueue([urn])`，没有 downloads 就不画。

**`bound(ctx, Screen)`** — 与所有视图包相同：闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用。

## 测试（`src/screen.test.tsx`）

jsdom + Testing Library。先 `configureNative({…})` 注入 DOM host 组件（含 `FlashList` 桩），与 `apps/mobile` 交出真 RN 用的是同一条缝。4 个用例：

1. 画出专辑 + "Play album" → `playNow([A, B])`；
2. 点 "Jóga" → `playFromContext(B, [A, B], { kind: 'album', urn, label: 'Homogenic' })`；
3. 下载按钮 → `enqueue([A])`（DOM host 会把点击冒泡进行 `Pressable`，RN 的 responder 不会——"不触发播放"由桌面孪生钉住，那里 kit 显式 stopPropagation）；
4. 缺失专辑 → "Album unavailable" + "Back to library" 兜底导航到 `sources.library`。

## 相关文档

- `packages/feature/plugin-album/README.md`：headless 侧
- `packages/ui/plugin-album-ui-desktop/README.md`：孪生半边（含更完整的桌面侧行为描述）
- `packages/ui/plugin-sources-ui-mobile/README.md`：库/搜索屏（导航入口）
