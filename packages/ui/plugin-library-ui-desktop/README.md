# @BBeBee/plugin-library-ui-desktop

Layer 5（ui）— `plugin-library`（headless）的桌面视图包：库首页、歌单详情、合集详情、收藏。

## 概述

布局、手势与事件接线；所有派生值来自 `@BBeBee/plugin-library/hooks` 与 `@BBeBee/ui-menus`。`inject = ['ui', 'library', 'player']`，`sources`/`downloads` 经 `serviceOf` 可选读取（没有就不画对应控件）。

## 注册的视图

| id | 组件 | 说明 |
|---|---|---|
| `library.home` | `LibraryScreen` | 库首页：Playlists / Albums / Collections 三段并排（桌面滚动一页） |
| `library.playlist` | `PlaylistDetailScreen` | 歌单曲目；smart 歌单只读，不画删除键 |
| `library.collection` | `CollectionScreen` | 合集成员：track 行可播（TrackRow + 右键菜单），album/playlist 行点入各自页面 |
| `library.favorites` | `FavoritesScreen` | 收藏曲目 |

**LibraryScreen**：头部计数 + Favourites 入口；新建歌单/新建合集输入行；每行带 `⋯`（右键同样触发菜单）。歌单菜单与合集菜单由 `usePlaylistMenu`/`useCollectionMenu` 驱动；打开前先解析列表（歌单的曲目 URN、合集的 track 成员），避免对空列表生效的菜单项。Albums 走 `useAlbums`（`ctx.sources.listAlbums`），点击导航 `album.view`。

**CollectionScreen**：`useCollectionDetail` 按成员 kind hydrate；专辑/歌单成员渲染 `MemberRow`（图标 + 标题 + 副标题），track 成员渲染 `TrackRow` 并复用曲目菜单。顶部 "Play" 用合集里的曲目 URN 整体播放。

## 测试

`screens.test.tsx`（jsdom + `withListLayout`）：库首页创建/删除/导航、歌单详情移除项传 item id、收藏取消保存、合集成员混合渲染与导航。
