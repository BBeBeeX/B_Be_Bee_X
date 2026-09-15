# @BBeBee/plugin-queue

Layer 4（feature）— **up-next 队列页**，从 `plugin-player` 拆出。

## 概述

一个**表面（surface）插件**：

- 拥有 route `queue.view`（`/queue`，tab-bar + sidebar，order 20）与 view id；
- **不声明服务键**——队列模型（有序项、当前项、跳转语义）属于 `ctx.player`；读它的 hooks（`useQueue`/`useTracksByUrn`/`queueTrackFallback`）留在 `plugin-player/hooks`，随服务走；
- 与 `plugin-now-playing` 的分工：那个插件管"现在播什么"（整屏 + 走带条），这个管"接下来播什么"。

拆出的收益：`plugin-player` 现在没有任何 route/view（只剩三个 command），transport 服务不必因为一块屏幕改动而改动。

## 源文件

### `src/index.ts`

`apply(ctx)`：`ctx.logger.info('plugin-queue: loaded')`，然后 `ctx.inject(['ui'], scoped => scoped.effect(function*(){ yield scoped.ui.contribute({ kind: 'route', id: QUEUE_ROUTES.queue, path: '/queue', title: 'Queue', icon: 'list', placement: ['tab-bar', 'sidebar'], order: 20 }) }, 'queue-ui-contributions'))`。

`ui` 不存在的构建不会卡住（子 fiber 未激活只是没有贡献）。

### `src/views.ts`

```ts
QUEUE_VIEWS = { queue: 'queue.view' }
QUEUE_ROUTES = QUEUE_VIEWS   // 同值
```

## 测试

`src/index.test.ts`（4）——注册 route 描述符（内容逐字断言）、没有 `ui` 时正常加载、两条卸载快照（有/无 ui）无泄漏。

## 导出

```ts
// '.'
export const name = 'plugin-queue'
export function apply(ctx)
// './views'：QUEUE_VIEWS / QUEUE_ROUTES
```

## 相关文档

- `docs/05-audio-playback.md` §2：队列与 transport 状态
- `docs/08-ui-architecture.md` §2–§3：descriptor、双壳、placement
- 视图半边：`packages/ui/plugin-queue-ui-desktop/`、`packages/ui/plugin-queue-ui-mobile/`
- 被拆出的来源：`packages/feature/plugin-player/README.md`
