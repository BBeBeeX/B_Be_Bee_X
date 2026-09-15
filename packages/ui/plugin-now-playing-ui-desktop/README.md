# @BBeBee/plugin-now-playing-ui-desktop

Layer 5（ui）— `plugin-now-playing`（headless）的桌面视图包："正在播放"的两块面。

## 概述

把 `now-playing.bar` 与 `now-playing.view` 绑到桌面 kit 上，从 `plugin-player-ui-desktop` 整体迁入。领域状态全部来自 `@BBeBee/plugin-player/hooks`；`ctx.player` 经 `inject` 访问。对 headless 包是运行时依赖（hooks 与 view id）。

**平台形状的差异**：桌面上的"正在播放"面是一个**常驻底部走带条**（bar），整屏播放页由它打开——这是真正由平台决定的差异，也正是 ADR-2 接受把视图写两遍的原因。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'now-playing-ui-desktop'`）：

| id | 组件 |
|---|---|
| `now-playing.bar` | `NowPlayingBar` |
| `now-playing.view` | `NowPlayingScreen` |

- **`NowPlayingBar({ ctx, onOpenNowPlaying? })`** — 常驻底部走带条（`role="region"` + `aria-label="Now playing"`）。`useTransport`/`usePosition`/`useDuration`/`useTransportAvailability` 四个 headless hook 供数。三段布局：左侧封面（点击/回车打开播放页）与 ⏮ / ⏯ / ⏭ 三个 `IconButton`（**⏯ 是一个控件两个状态**，label 同步切换）；中间进度 `Slider`（只接 `onCommit`，`disabled: !can.canSeek`）+ `formatDuration` 两端时间——**`stalled` 显示 "Buffering…" 而非暂停**；右侧音量。打开播放页优先走 shell 的 `onOpenNowPlaying`，否则 `ui.navigate(NOW_PLAYING_VIEWS.nowPlaying)`。
- **`NowPlayingScreen({ ctx, onClose? })`** — 整屏播放页（居中竖排）。大封面（280px）、曲名/艺人/专辑、`Buffering…`、进度条与走带三键（与 bar 同语义）；左上角关闭键（`aria-label="Close now playing"`）。曲名未解析到时显示 "Loading…"，**绝不显示 URN**。
- 封面统一经 `CachedArtwork`（`useResolvedArtwork`）解析：缓存未命中先画 fallback，不把远端 URL 交给第二个请求。

**`bound(ctx, Screen)`** — 闭包本插件 `apply` 时的 context（shell 的 context 只有 `ui`，hooks 读 `ctx.player` 会抛 `cannot get property "player" without inject`）；必须 `h(Screen, …)` 而非函数调用。

## 声明与导出

```ts
export const name = 'plugin-now-playing-ui-desktop'
export const inject = ['ui', 'player']
export function NowPlayingBar / NowPlayingScreen
export async function apply(ctx)      // generator effect：registerView × 2
export default { name, inject, apply }
```

## 测试（`src/screens.test.tsx`）

静态标记断言（`renderToStaticMarkup`）：每个走带控件的 `aria-label`、一个控件两种状态的 play/pause、`stalled` 显示 Buffering 且仍可暂停、无时长时 Seek 禁用、队列末尾 Next 禁用、`--:--` 占位、标题/艺人与封面的打开按钮、整屏的关闭键与时间显示。

## 相关文档

- `packages/feature/plugin-now-playing/README.md`：headless 侧与 view id
- `packages/ui/plugin-now-playing-ui-mobile/README.md`：孪生半边
- `packages/ui/plugin-player-ui-desktop/README.md`：队列页（留在 player）
