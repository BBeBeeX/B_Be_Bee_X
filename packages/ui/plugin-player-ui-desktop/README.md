# @BBeBee/plugin-player-ui-desktop

Layer 5（ui）— `plugin-player`（headless）的桌面视图包：up-next 队列屏。

## 概述

只余一屏：**队列页**。"正在播放"的两块面（常驻底部走带条与整屏播放页）已拆到 `plugin-now-playing-ui-desktop`——走带服务不该因为一块屏幕改动而改动（docs/08 §1）。

布局、手势与事件接线——别无其他。每个值都来自 headless 包的 hook，如果这里有个 `if` 在移动视图里也成立，它就属于 `plugin-player/hooks`。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'player-ui-desktop'`）：

| id | 组件 |
|---|---|
| `player.queue` | `QueueScreen` |

**`QueueScreen({ ctx })`** — up-next 列表。空队列 → `EmptyState`（🎵 "Nothing queued"）；否则 `List<QueueItem>`（`estimatedItemSize: tokens.size.row`，`keyExtractor: item.id`）+ `TrackRow`，`active: item.id === state.currentItemId`。行内容来自 headless 的 `useTracksByUrn`（一次 `getTracks` 批量解析）：**封面 + 标题 + 艺人**；尚未有目录答案时（写入进行中、源被移除）经 `queueTrackFallback` 显示——当前项借用 transport 的 nowPlaying 元数据，其余显示 "Loading…"，**绝不显示 URN**。行点击是 `playFromContext(urn)`：曲目按定义就在队列里，故语义是**跳到该项**、原队列原封不动。

**`bound(ctx, Screen)`** — 闭包本插件 `apply` 时的 context（shell 的 context 只有 `ui`，hooks 读 `ctx.player` 会抛 `cannot get property "player" without inject`——"设备上抛错、测试全绿"正是此 bug 的形状，因为测试建的是 root context）。必须 `h(Screen, …)` 而非函数调用（hook 链会被拼错）。

## 声明与导出

```ts
export const name = 'plugin-player-ui-desktop'
export const inject = ['ui', 'player', 'sources']
export function QueueScreen
export async function apply(ctx)      // generator effect：registerView × 1
export default { name, inject, apply }
```

## 测试

`src/index.test.tsx`：队列屏的标记断言——空态文案、行渲染、点击是跳转而非重新入队、目录未答时不显示 URN。走带条与播放页的测试随组件迁到 `plugin-now-playing-ui-desktop`。

## 相关文档

- `docs/05-audio-playback.md`：transport 状态（`stalled` 语义）
- `packages/feature/plugin-player/README.md`：hooks 与视图 id 的来源
- `packages/ui/plugin-now-playing-ui-desktop/README.md`：走带条与播放页（本包拆出的部分）
