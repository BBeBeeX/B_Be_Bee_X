# @BBeBee/ui-menus

Layer 5（ui）— 两个 shell 共用的**右键/长按菜单模型**：对曲目、歌单、合集分别有哪些操作，以及每个操作调用什么。

## 概述

这是 docs/08 §1 "写一次的 `if`" 的另一半：

- kits（`ui-kit-desktop` / `ui-kit-mobile`）提供 `ContextMenu` 组件——只认识 `MenuItemSpec` 数组与 `SubmenuSpec`，不知道歌单、队列、下载是什么；
- 本包知道**每个操作**与**没有像素**；两个 shell 得到同样的条目、同样的顺序、同样的文案。

它是 Layer 5 而不是 Layer 4：它组合四个 feature（`ctx.library` / `ctx.player` / `ctx.downloads` / `ctx.ui`）并引用 `album.view`，Layer 4 插件对自己的兄弟不能这样做。所有服务经 `serviceOf` 读取——没有 downloads 的构建里 "下载" 条目**消失**，而不是点了抛错。

## 导出

```ts
// 纯模型（可单测，无渲染器）
trackMenuItems(ctx, { track, playlistItemId? }, { fromPlaylistUrn?, playlists? }): MenuItemSpec[]
playlistMenuItems(ctx, { urn, name }, tracks, playlists?): MenuItemSpec[]
collectionMenuItems(ctx, trackUrns, playlists?): MenuItemSpec[]
addToPlaylistSubmenu(library, trackUrns, playlists): SubmenuSpec | undefined

// React 控制器：open() + 可直接展开的 menuProps
useTrackMenu(ctx, { fromPlaylistUrn? }) → { open(target, anchor?), menuProps }
usePlaylistMenu(ctx)                    → { open(playlist, tracks, anchor?), menuProps }
useCollectionMenu(ctx)                  → { open(title, trackUrns, anchor?), menuProps }
```

## 菜单内容

**曲目**：加入歌单（子菜单：搜索框 → 新建歌单 → 全部歌单）→ 从此歌单中删除（仅在歌单详情里出现）→ 从“最喜欢的歌曲”中删除（仅 `track.loved` 时）→ 加入播放列表（`player.enqueueLast`）→ 下载 → 转至专辑（有 `albumUrn` 时）。

**歌单**：添加到音乐库（`library.setSaved`）→ 加入播放列表（整张入队）→ 下载（整张）→ 添加到歌单（子菜单，整张复制）。

**合集**：加入播放列表 / 下载 / 添加到歌单，作用于其**曲目成员**；没有“添加到音乐库”——合集只有 id、没有 URN。

## 设计要点

- **列表类操作先解析曲目再开菜单**：歌单行只有 `trackCount`，没有 track URN；行菜单在打开前 `getPlaylist()` / `listCollectionItems()`，拿不到就不显示对应条目——对空列表生效的菜单项比没有更糟。
- **智能歌单在“加入歌单”子菜单里 disabled**：它的曲目来自规则，没有可写的行（服务会拒绝；会抛错的菜单项比明显不可用更糟）。
- **锚点可选**：右键/长按带坐标，`⋯` 按钮没有——没有锚点时菜单落在屏幕中上，移动端忽略坐标（底部 sheet）。
- 打开菜单时才拉取歌单列表，慢的 `listPlaylists` 不阻塞菜单本身；子菜单晚一拍填充。

## 测试（`src/index.test.tsx`）

12 个用例：曲目条目的顺序、缺服务时条目消失、`remove-from-playlist` 只在歌单内出现、取消喜欢同时写 `track_stats` 与 `library_items`、入队/下载/转专辑的调用、子菜单的创建/选择/智能歌单禁用、歌单与合集条目、`useTrackMenu` 的 open/close 状态。
