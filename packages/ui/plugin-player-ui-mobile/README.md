# @BBeBee/plugin-player-ui-mobile

Layer 5（ui）— `plugin-player`（headless）的移动视图包：up-next 队列屏。

## 概述

只余一屏：**队列页**。整屏播放器与迷你播放条（`NowPlayingScreen` / `NowPlayingBar`）已拆到 `plugin-now-playing-ui-mobile`——走带服务不该因为一块屏幕改动而改动（docs/08 §1）。

同样的 hooks、同样的行为——只有元素与形状不同。布局与事件接线之外的东西一律放回 `plugin-player/hooks`。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'player-ui-mobile'`）：

| id | 组件 |
|---|---|
| `player.queue` | `QueueScreen` |

**`QueueScreen({ ctx })`** — 与桌面同构的 up-next 列表（`List` + `TrackRow`、空态 🎵 "Nothing queued"、`active` 按 `currentItemId`）。行内容来自 headless 的 `useTracksByUrn`（一次 `getTracks` 批量解析）：**封面 + 标题 + 艺人**；尚未有目录答案时经 `queueTrackFallback` 显示——当前项借用 transport 的 nowPlaying 元数据，其余显示 "Loading…"，**绝不显示 URN**。点击 `playFromContext(urn)`——曲目按定义就在队列里，语义是跳到该项、原队列不动。

**`bound(ctx, Screen)`** — 与所有视图包相同：闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用。文件头注释记录了那次真机事故：hooks 读 `ctx.player` 在设备上抛 `cannot get property "player" without inject`、测试却全绿（测试建 root context，缺席服务答 `undefined`）。

## 声明与导出

```ts
export const name = 'plugin-player-ui-mobile'
export const inject = ['ui', 'player', 'sources']
export function QueueScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## 相关文档

- `packages/ui/plugin-player-ui-desktop/README.md`：孪生半边
- `packages/feature/plugin-player/README.md`：hooks、视图 id、transport 状态机
- `packages/ui/plugin-now-playing-ui-mobile/README.md`：整屏播放器与迷你条（本包拆出的部分）
- `apps/mobile/`：`configureNative` 与路由挂载点
