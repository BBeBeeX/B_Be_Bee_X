# @BBeBee/plugin-library-ui-mobile

Layer 5（ui）— `plugin-library`（headless）的移动视图包：桌面版的孪生半边。

## 概述

同样的 hooks 与行为，只有元素与形状不同。`inject = ['ui', 'library', 'player']`；`sources`/`downloads` 经 `serviceOf` 可选。

## 注册的视图

`library.home` / `library.playlist` / `library.collection` / `library.favorites`（generator effect `'library-ui-mobile'`）。

- **`LibraryScreen`** — 库首页。Playlists / Albums / Collections 三段共用**一个 FlashList**（手机一次只滚一个面；嵌套 scroller 是两者都坏的老路），按行 union 渲染 section 头与行；歌单/合集行支持长按与 `⋯` 打开菜单，专辑行进入 `album.view`。
- **`PlaylistDetailScreen`** — 与桌面同构；smart 歌单无移除键。
- **`CollectionScreen`** — 合集成员：album/playlist 行进各自页面；顶部 Play 播放合集曲目。
- **`FavoritesScreen`** — 收藏曲目。

## 测试

`screen.test.tsx`（DOM host 组件）：库首页渲染/创建/删除与导航、歌单详情、收藏取消保存、合集混合成员与导航。
