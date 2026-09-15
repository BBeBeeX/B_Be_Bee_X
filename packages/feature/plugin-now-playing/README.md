# @BBeBee/plugin-now-playing

Layer 4（feature）— **"正在播放"的两块面**：整屏播放器与常驻走带条，从 `plugin-player` 拆出。

## 概述

一个**表面（surface）插件**：

- 拥有 route `now-playing.view`（`/now-playing`，tab-bar，order 10）与 `now-playing.bar` 的 **view id**；
- **不声明服务键**——transport 状态与队列属于 `ctx.player`；读它们的 hooks（`useTransport`/`usePosition`/`useDuration`/`useTransportAvailability`）留在 `plugin-player/hooks`，随服务走；
- 队列页（`player.queue`）留在 `plugin-player-ui-*`：待播列表与"现在播什么"是两个问题，而队列模型是 player 的。

拆分的收益：`plugin-player` 不必因为一块屏幕改动而改动；播放页可以做自己的演进（可视化、歌词、封面主题），而不触碰传输状态机。

## 源文件

### `src/index.ts`

`apply(ctx)`：

1. `ctx.logger.info('plugin-now-playing: loaded')`；
2. `ctx.inject(['ui'], scoped => scoped.effect(function*(){ yield scoped.ui.contribute({ kind: 'route', id: NOW_PLAYING_ROUTES.nowPlaying, path: '/now-playing', title: 'Now playing', icon: 'play', placement: ['tab-bar'], order: 10 }) }, 'now-playing-ui-contributions'))`。

`placement: ['tab-bar']` 与拆出前一致：手机上是整屏 tab，桌面由走带条打开——给走带条已能到达的屏再加一个 tab 就是同一间屋子的第二扇门。`ui` 不存在的构建不会卡住（子 fiber 未激活只是没有贡献）。

### `src/views.ts`

```ts
NOW_PLAYING_VIEWS = { nowPlaying: 'now-playing.view', bar: 'now-playing.bar' }
NOW_PLAYING_ROUTES = { nowPlaying: 'now-playing.view' }   // bar 不是 route，是 shell 按 id 取用的视图
```

## 测试

`src/index.test.ts`（4）——注册 route 描述符（内容逐字断言）、没有 `ui` 时正常加载、两条卸载快照（有/无 ui）无泄漏。

## 导出

```ts
// '.'
export const name = 'plugin-now-playing'
export function apply(ctx)
// './views'：NOW_PLAYING_VIEWS / NOW_PLAYING_ROUTES
```

## 相关文档

- `docs/05-audio-playback.md`：transport 状态机（`ctx.player`）
- `docs/08-ui-architecture.md` §2–§3：descriptor、双壳、placement
- 视图半边：`packages/ui/plugin-now-playing-ui-desktop/`、`packages/ui/plugin-now-playing-ui-mobile/`
- 被拆出的来源：`packages/feature/plugin-player/README.md`
