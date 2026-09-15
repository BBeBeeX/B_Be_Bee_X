# @BBeBee/plugin-library

Layer 4（feature）— `ctx.library`：用户的**整理**（playlists、favourites、collections），以及现在的**库首页**。

## 概述

- **读面**：`sources.library` 已删除，库首页由本插件的 `library.home` 承担：同时显示 playlists、albums（读 `ctx.sources`）与 collections。
- **collections 是文件夹**：成员可任意 URN —— **album、playlist、track**（以及 artist）；可嵌套（`parent_id`）。歌单/专辑以**自身引用**入合集，其中的歌曲因此"间接"进入库；不复制目录行。
- **playlists 是队列式有序歌曲表**：可有 smart 规则、可来自远端源；详情页可单曲删除。
- 目录读仍在 `ctx.sources`；本插件只写 `playlists` / `playlist_items` / `library_items` / `collections` / `collection_items`（docs/07 §4.6）。

## 视图与路由

```ts
LIBRARY_VIEWS = {
  home: 'library.home',            // /library       sidebar + tab-bar, order 0
  playlist: 'library.playlist',    // /playlist/:urn 无 placement
  collection: 'library.collection',// /collection/:id 无 placement
  favorites: 'library.favorites',  // /favorites     sidebar, order 1
}
```

## 源文件

| 文件 | 内容 |
|---|---|
| `src/index.ts` | `Library` 服务：favourites（`library_items`，幂等保存/置顶）、playlists（创建/改名/删除/加删移曲目/智能规则，`track_count`/`duration_ms` 与曲目同事务重算）、collections（嵌套、成员增删）；emit `library/changed` 与 `library/collections-changed`；贡献 4 条 route |
| `src/playlists.ts` | `playlists` + `playlist_items`；`between()` 分数索引移动一行、`recount` 同事务、smart 树解析为参数化 SQL（`smart.ts`） |
| `src/smart.ts` | 规则树 → WHERE，字段白名单 + 值一律绑定（`inLast` 只对日期字段等） |
| `src/saved.ts` | `library_items`：保存保留原 `added_at`、pinned 优先 |
| `src/collections.ts` | 文件夹语义：任意 URN、`(collection_id, urn)` 幂等、同级分数索引、FK 级联删子树 |
| `src/hooks.ts` | 双壳共享：`usePlaylists/usePlaylist/useSaved/useCollections/useToggleFavorite/useCollectionDetail`（成员按 kind hydrate：track→Track、album→标题/艺人、playlist→名称/曲目数） |
| `src/views.ts` | 上面的 id 常量 |

## 事件与能力

- emit：`library/changed(kind, urns)`、`library/collections-changed()`。
- manifest：`db:read:core`、`db:write:core`；`contributes.services: ['library']`。
- 对 `@BBeBee/ui-menus`：歌单菜单"加入合集"把**歌单 URN** 作为成员加入（不是快照）；曲目菜单"加入合集"加曲目 URN。

## 测试

`smart.test.ts`（编译器安全边界）、`playlists.test.ts`（顺序/移动单行/智能只读/派生列一致）、`saved.test.ts`、`collections.test.ts`（嵌套/幂等/级联）、`index.test.ts`（生命周期/泄漏/事件）、`hooks.test.tsx`。

## 相关文档

- `docs/07-data-model.md` §4.6：五张表与 smart 规则
- `docs/08-ui-architecture.md` §2–§4：descriptor 与 hooks
- 视图半边：`packages/ui/plugin-library-ui-desktop/`、`packages/ui/plugin-library-ui-mobile/`
- 菜单模型：`packages/ui/ui-menus/`
