# @BBeBee/plugin-player-ui-mobile

Layer 5（ui）— `plugin-player`（headless）的移动视图包：桌面版的孪生半边。

## 概述

同样的 hooks、同样的视图 id、同样的行为——只有元素与**形状**不同。移动端"正在播放"是**整屏**而非底栏，这是 ADR-2 接受付费的平台差异。布局与事件接线之外的东西一律放回 `plugin-player/hooks`。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'player-ui-mobile'`）：

| id | 组件 |
|---|---|
| `player.now-playing` | `NowPlayingScreen` |
| `player.queue` | `QueueScreen` |

**组件**：

- **`NowPlayingScreen({ ctx })`** — 全屏播放器（居中竖排、`bg.base` 底）。与桌面走带条用同一组 hook（`useTransport`/`usePosition`/`useDuration`/`useTransportAvailability`）。差异：
  - **封面先行且大**：`Artwork size: 280, radius: lg`——"在手机上这个屏大部分就是封面，这是底栏唯一做不到的事"；
  - 曲名 `Text variant:'xl' numberOfLines:1`（队列条目同桌面：显示 URN，标题随后续里程碑的目录读取到来）；
  - `stalled` → "Buffering…"（`stalled` 不是 `paused`，与桌面同语义）；
  - 进度 `Slider`（只接 `onCommit`）+ 两端时间；走带三键与桌面逐字相同——⏯ 仍是一个控件两个状态、仍由可用性 hook 决定 disabled，主键用 `tokens.size.iconLarge`。
- **`QueueScreen({ ctx })`** — 与桌面同构的 up-next 列表（`List` + `TrackRow`、空态 🎵 "Nothing queued"、`active` 按 `currentItemId`）。行内容来自 headless 的 `useTracksByUrn`（一次 `getTracks` 批量解析）：**封面 + 标题 + 艺人**，目录答不出的 URN 落回显示自身。点击 `playFromContext(urn)`——曲目按定义就在队列里，语义是跳到该项、原队列不动；早先只能 `playNow([urn])` 收窄可供性，该让步已随跳转 API 的到来撤销。

**`bound(ctx, Screen)`** — 与所有视图包相同：闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用。文件头注释记录了那次真机事故：hooks 读 `ctx.player` 在设备上抛 `cannot get property "player" without inject`、测试却全绿（测试建 root context，缺席服务答 `undefined`）。

## 声明与导出

```ts
export const name = 'plugin-player-ui-mobile'
export const inject = ['ui', 'player', 'sources']
export function NowPlayingScreen / QueueScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## 相关文档

- `packages/ui/plugin-player-ui-desktop/README.md`：孪生半边（走带条语义的完整描述）
- `packages/feature/plugin-player/README.md`：hooks、视图 id、transport 状态机
- `apps/mobile/`：`configureNative` 与路由挂载点
