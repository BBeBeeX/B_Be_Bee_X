# @BBeBee/plugin-now-playing-ui-mobile

Layer 5（ui）— `plugin-now-playing`（headless）的移动视图包：`plugin-now-playing-ui-desktop` 的孪生半边。

## 概述

同样的 hooks、同样的两块面——整屏播放器与迷你播放条（mini-player），只有元素与形状不同。从 `plugin-player-ui-mobile` 整体迁入。`ctx.player` 经 `inject`；对 headless 包是运行时依赖。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'now-playing-ui-mobile'`）：

| id | 组件 |
|---|---|
| `now-playing.view` | `NowPlayingScreen` |
| `now-playing.bar` | `NowPlayingBar` |

- **`NowPlayingScreen({ ctx, onClose? })`** — 全屏播放器（居中竖排、`bg.base` 底）。与桌面同一组 hook。**封面先行且大**（200px）——"在手机上这个屏大部分就是封面，这是底栏唯一做不到的事"；曲名 `numberOfLines: 2`；`stalled` → "Buffering…"；进度 `Slider` 只接 `onCommit`；走带三键与桌面逐字相同（⏯ 一个控件两个状态、可用性 hook 决定 disabled）。
- **`NowPlayingBar({ ctx, onOpenNowPlaying? })`** — 迷你播放条：封面 + 曲名/艺人 + ⏯，整条 `Pressable` 打开全屏（`accessibilityLabel: 'Open now playing'`）。空闲且无曲目时**不占高度**（`display: 'none'`）。打开优先走 shell 的 `onOpenNowPlaying`，否则 `ui.navigate(NOW_PLAYING_VIEWS.nowPlaying)`。
- 封面统一经 `CachedArtwork`（`useResolvedArtwork`）。

**`bound(ctx, Screen)`** — 与所有视图包相同：闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用。

## 声明与导出

```ts
export const name = 'plugin-now-playing-ui-mobile'
export const inject = ['ui', 'player']
export function NowPlayingBar / NowPlayingScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## 测试（`src/screen.test.tsx`）

DOM host 组件（`configureNative`）：迷你条渲染标题/艺人与 play/pause、点 ⏯ 触发 `togglePlay`、点条触发 `onOpenNowPlaying` 并导航到 `now-playing.view`；整屏渲染标题/艺人/专辑、关闭键回调、Next 触发 `next`。

## 相关文档

- `packages/ui/plugin-now-playing-ui-desktop/README.md`：孪生半边
- `packages/feature/plugin-now-playing/README.md`：headless 侧
- `packages/ui/plugin-player-ui-mobile/README.md`：队列页（留在 player）
- `apps/mobile/`：`configureNative` 与路由挂载点
