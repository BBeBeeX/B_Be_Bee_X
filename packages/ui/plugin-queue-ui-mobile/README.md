# @BBeBee/plugin-queue-ui-mobile

Layer 5（ui）— `plugin-queue`（headless）的移动视图包：`plugin-queue-ui-desktop` 的孪生半边。

## 概述

同样的 hooks、同样的行为——只有元素与形状不同。从 `plugin-player` 的移动视图包整体迁入。`ctx.player` / `ctx.sources` 经 `inject`；对 headless 包是运行时依赖。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'queue-ui-mobile'`）：

| id | 组件 |
|---|---|
| `queue.view` | `QueueScreen` |

**`QueueScreen({ ctx })`** — 与桌面同构的 up-next 列表（`List` + `TrackRow`、空态 🎵 "Nothing queued"、`active` 按 `currentItemId`）。行内容来自 headless 的 `useTracksByUrn`（一次 `getTracks` 批量解析）：**封面 + 标题 + 艺人**；尚未有目录答案时经 `queueTrackFallback` 显示——当前项借用 transport 的 nowPlaying 元数据，其余显示 "Loading…"，**绝不显示 URN**。点击 `playFromContext(urn)`——曲目按定义就在队列里，语义是跳到该项、原队列不动。

**`bound(ctx, Screen)`** — 与所有视图包相同：闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用。

## 声明与导出

```ts
export const name = 'plugin-queue-ui-mobile'
export const inject = ['ui', 'player', 'sources']
export function QueueScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## 测试（`src/screen.test.tsx`）

DOM host 组件（`configureNative`）：空态、行渲染与跳转、目录未答时不显示 URN、已作答时显示标题/艺人。

## 相关文档

- `packages/ui/plugin-queue-ui-desktop/README.md`：孪生半边
- `packages/feature/plugin-queue/README.md`：headless 侧
- `packages/ui/plugin-now-playing-ui-mobile/README.md`：现在播什么（本包的对侧）
- `apps/mobile/`：`configureNative` 与路由挂载点
