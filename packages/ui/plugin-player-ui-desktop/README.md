# @BBeBee/plugin-player-ui-desktop

Layer 5（ui）— `plugin-player`（headless）的桌面视图包。

## 概述

布局、手势与事件接线——别无其他。每个值都来自 headless 包的 hook，如果这里有个 `if` 在移动视图里也成立，它就属于 `plugin-player/hooks`（docs/08 §1）。

**平台形状的差异**：桌面上的"正在播放"面是一个**常驻底部走带条**而非整屏——这是真正由平台决定的差异，也正是 ADR-2 接受把视图写两遍的原因。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'player-ui-desktop'`，绑定到 headless 的 `PLAYER_VIEWS` id）：

| id | 组件 |
|---|---|
| `player.now-playing` | `NowPlayingBar` |
| `player.queue` | `QueueScreen` |

**组件**：

- **`NowPlayingBar({ ctx })`** — 常驻底部走带条（`role="region"` + `aria-label="Now playing"`，上边框分隔、`bg.raised` 底）。`useTransport`/`usePosition`/`useDuration`/`useTransportAvailability` 四个 headless hook 供数。三段布局：
  - 左：⏮ / ⏯ / ⏭ 三个 `IconButton`。**⏯ 是一个控件两个状态**（`can.canPause ? '⏸' : '▶'`，label 同步切换）——"一个时而变暂停的播放键是每个播放器都有的，两个控件就错了"；可用性由 `useTransportAvailability` 决定 disabled。
  - 中：进度区。**`stalled` 不是 `paused`**：UI 显示 "Buffering…"、锁屏继续报 playing，underrun 时谁也不闪。`Slider` 只接 `onCommit`（"每一帧都 seek 的 scrubber 不可用"），`disabled: !can.canSeek`；时间标签用 `formatDuration`。
  - 右：🔇/🔊 切换 + 音量 `Slider`（0–100，`onCommit` 换算回 0–1）。
- **`QueueScreen({ ctx })`** — up-next 列表。空队列 → `EmptyState`（🎵 "Nothing queued"）；否则 `List<QueueItem>`（`estimatedItemSize: tokens.size.row`，`keyExtractor: item.id`）+ `TrackRow`，`active: item.id === state.currentItemId`。一个诚实让步（注释明说）：
  1. 队列里是 URN 不是 track——行组件用 `{ urn, title: urn, artists: [] }` 充数，"标题随后续里程碑的目录读取到来"。

  行点击是 `playFromContext(urn)`：曲目按定义就在队列里，故语义是**跳到该项**、原队列原封不动——早先没有跳转 API 时只能 `playNow([urn])` 收窄可供性，那个让步已随 `playFromContext` 的到来撤销。

**`bound(ctx, Screen)`** — 闭包本插件 `apply` 时的 context（shell 的 context 只有 `ui`，hooks 读 `ctx.player` 会抛 `cannot get property "player" without inject`——"设备上抛错、测试全绿"正是此 bug 的形状，因为测试建的是 root context）。必须 `h(Screen, …)` 而非函数调用（hook 链会被拼错）。

## 声明与导出

```ts
export const name = 'plugin-player-ui-desktop'
export const inject = ['ui', 'player']
export function NowPlayingBar / QueueScreen
export async function apply(ctx)      // generator effect：registerView × 2
export default { name, inject, apply }
```

## 测试

`src/index.test.tsx`：走带条与队列屏的标记断言（控件可达性、stalled 文案、空态）。

## 相关文档

- `docs/05-audio-playback.md`：transport 状态（`stalled` 语义）
- `packages/feature/plugin-player/README.md`：hooks 与视图 id 的来源
- `packages/ui/plugin-player-ui-mobile/README.md`：孪生半边（整屏版）
