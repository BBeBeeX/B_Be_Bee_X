# @BBeBee/plugin-queue-ui-desktop

Layer 5（ui）— `plugin-queue`（headless）的桌面视图包：up-next 队列屏。

## 概述

把 `queue.view` 绑到桌面 kit 上，从 `plugin-player` 的视图包整体迁入。领域状态全部来自 `@BBeBee/plugin-player/hooks`（队列模型是 player 的），`ctx.player` / `ctx.sources` 经 `inject` 访问。对 headless 包是运行时依赖（view id）。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'queue-ui-desktop'`）：

| id | 组件 |
|---|---|
| `queue.view` | `QueueScreen` |

**`QueueScreen({ ctx })`** — up-next 列表。空队列 → `EmptyState`（🎵 "Nothing queued"）；否则 `List<QueueItem>`（`estimatedItemSize: tokens.size.row`，`keyExtractor: item.id`）+ `TrackRow`，`active: item.id === state.currentItemId`。行内容来自 headless 的 `useTracksByUrn`（一次 `getTracks` 批量解析）：**封面 + 标题 + 艺人**；尚未有目录答案时（写入进行中、源被移除）经 `queueTrackFallback` 显示——当前项借用 transport 的 nowPlaying 元数据，其余显示 "Loading…"，**绝不显示 URN**。行点击是 `playFromContext(urn)`：曲目按定义就在队列里，故语义是**跳到该项**、原队列原封不动。

**`bound(ctx, Screen)`** — 闭包本插件 `apply` 时的 context（shell 的 context 只有 `ui`，hooks 读 `ctx.player` 会抛 `cannot get property "player" without inject`——"设备上抛错、测试全绿"正是此 bug 的形状，因为测试建的是 root context）。必须 `h(Screen, …)` 而非函数调用。

## 声明与导出

```ts
export const name = 'plugin-queue-ui-desktop'
export const inject = ['ui', 'player', 'sources']
export function QueueScreen
export async function apply(ctx)      // generator effect：registerView × 1
export default { name, inject, apply }
```

## 测试（`src/screens.test.tsx`）

队列屏的标记断言：空态文案、行渲染、点击是跳转而非重新入队、目录未答时不显示 URN。

## 相关文档

- `docs/05-audio-playback.md`：transport 状态与队列
- `packages/feature/plugin-queue/README.md`：headless 侧与 view id
- `packages/ui/plugin-queue-ui-mobile/README.md`：孪生半边
- `packages/ui/plugin-now-playing-ui-desktop/README.md`：现在播什么（本包的对侧）
