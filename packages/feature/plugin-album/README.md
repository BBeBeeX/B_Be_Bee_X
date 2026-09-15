# @BBeBee/plugin-album

Layer 4（feature）— **专辑页**：route/view 描述符与 `useAlbum` 读，从 `plugin-sources` 中拆出。

## 概述

一个**表面（surface）插件**，刻意很薄：

- 它拥有专辑 route（`/album/:urn`）与 view id（`album.view`）；
- 它**不声明服务键**——专辑没有自己的状态：详情是读，播放是 `ctx.player` 的事；
- 目录读仍走 `ctx.sources.getAlbum`：读留在写旁边（MD-3，docs/11 §1.3），`plugin-sources` 依旧是唯一持有目录表的服务。

拆分的收益：`plugin-sources` 不再背着一块屏幕；专辑专属的工作（跨源链接、补全、专辑编辑）从此有一个不属于源注册表的家。

> `placement: []` 而不是省略：桌面 shell 对**缺失** placement 的 route 默认当作 `sidebar`（`r.placement?.includes('sidebar') ?? true`），省略会在侧栏多出一条孤零零的 "Album"。空数组才是"只靠导航到达"（docs/08 §3）。

## 源文件

### `src/index.ts`

`apply(ctx)`：

1. `ctx.logger.info('plugin-album: loaded')`；
2. `ctx.inject(['ui'], scoped => scoped.effect(function*(){ yield scoped.ui.contribute({ kind: 'route', id: 'album.view', path: '/album/:urn', title: 'Album', placement: [], order: 0 }) }, 'album-ui-contributions'))`。

`ui` 不存在的构建不会卡住：嵌套 inject 是**子 fiber**，未激活只是没有贡献；父插件卸载时子 fiber 一起卸载（返回的 disposer `fiber.dispose()`）。

### `src/hooks.ts`

| Hook | 说明 |
|---|---|
| `useAlbum(ctx, urn?)` | `AsyncState<AlbumDetail>`；`undefined` data 与读失败都进 `error`（屏幕对两者说同一句话："这张专辑显示不了"）；`urn` 为空时 `idle`。 |

### `src/views.ts`

```ts
ALBUM_VIEWS = { album: 'album.view' }
ALBUM_ROUTES = ALBUM_VIEWS   // 同值
```

## 测试

- `src/index.test.ts`（4）——注册 route 描述符（内容逐字断言）、没有 `ui` 时正常加载、两条卸载快照（有/无 ui）无泄漏。
- `src/hooks.test.tsx`（3）——读到专辑、缺失专辑进 error 而非空成功、无 urn 时 idle。

## 导出

```ts
// '.'
export const name = 'plugin-album'
export function apply(ctx)
// './hooks'：useAlbum
// './views'：ALBUM_VIEWS / ALBUM_ROUTES
```

## 相关文档

- `docs/08-ui-architecture.md` §2–§3：descriptor、双壳、placement
- `packages/feature/plugin-sources/README.md`：`getAlbum/listAlbums` 仍在那边
- 视图半边：`packages/ui/plugin-album-ui-desktop/`、`packages/ui/plugin-album-ui-mobile/`
