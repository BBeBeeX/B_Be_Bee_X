# @BBeBee/plugin-library-ui-desktop

Layer 5（ui）— `plugin-library`（headless）的桌面视图包：统一曲库首页、本地音乐、歌单详情、合集详情、收藏。

## 概述

布局、手势与事件接线；所有派生值来自 `@BBeBee/plugin-library/hooks` 与 `@BBeBee/ui-menus`。`inject = ['ui', 'library', 'player', 'sources']`，`downloads` 等经 `serviceOf` 可选读取（没有就不画对应控件）。

## 注册的视图

| id | 组件 | 说明 |
|---|---|---|
| `library.home` | `LibraryScreen` | 统一曲库首页：单流混合展示（最喜欢音乐、本地音乐、歌单、已收藏专辑、合集目录） |
| `library.local` | `LocalMusicScreen` | 本地音乐详情：本地扫描曲目列表、一键全部播放、跳转扫描设置 |
| `library.playlist` | `PlaylistDetailScreen` | 歌单曲目；smart 歌单只读，不画删除键 |
| `library.collection` | `CollectionScreen` | 合集成员：track 行可播（TrackRow + 右键菜单），album/playlist 行点入各自页面 |
| `library.favorites` | `FavoritesScreen` | 收藏曲目 |

## 核心交互设计

### LibraryScreen（统一曲库首页）

1. **已收藏专辑过滤**：仅通过 `useSaved(ctx, 'album')` 获取用户真正收藏到曲库的专辑，而非直接展示远端 catalogue 的全部专辑。
2. **统一单流呈现**：歌单、已收藏专辑、合集目录，以及特殊的「最喜欢的音乐」和「本地音乐」置于同一列表流（`UnifiedItem`）中展示，不再割裂分块。
3. **第一首歌曲封面**：若歌单或合集未设置独立封面，自动异步提取首首歌曲（或首个专辑）的封面展示。
4. **行悬停与封面直达播放**：
   - 鼠标悬停行时高亮背景，并在行尾浮现 `⋯` 操作菜单；
   - 封面悬停时出现深色蒙层与白色播放箭头 `▶`，点击封面直接播放其全部内容，点击行其他部分进入对应页面；
   - 彻底移除了行尾冗余的 `Open` 文本按钮。
5. **顶部筛选胶囊**：提供 `歌单` / `专辑` / `目录` / `已下载` 按钮，点击单选过滤，再次点击选中的按钮取消筛选。
6. **搜索与排序工具栏**：
   - 点击放大镜展开搜索框，即时过滤当前条目；
   - 排序下拉菜单支持 `最近播放`、`最近添加的内容`、`按字母排序`。
7. **置顶/取消置顶**：右键或菜单支持 `置顶歌单` / `取消置顶歌单`，置顶项始终排在列表最前列。

### LocalMusicScreen（本地音乐页面）

读取 `ctx.sources.listTracks({ sourceIds: ['local'] })` 展示扫描到的本地音乐文件列表，提供「播放全部」（`player.playNow`）与「扫描目录」（跳转 `scanner.settings`）按钮，单行支持双击/点击播放与曲目右键菜单。

## 测试

`screens.test.tsx`（jsdom + `withListLayout`，12 个用例全部通过）：
- 库首页创建/删除/行点击打开
- 统一单流渲染（最喜欢的音乐、本地音乐、歌单、已收藏专辑、合集）与对应路由跳转
- 顶部筛选胶囊切换与还原
- 搜索输入过滤
- 封面遮罩播放箭头直达播放
- 右键上下文菜单置顶/取消置顶
- 歌单曲目播放与移除 item id
- 收藏单曲取消收藏
- 合集多类型成员渲染与打开
- 本地音乐页面渲染与全部播放

