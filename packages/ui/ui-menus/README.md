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
trackMenuItems(ctx, { track, playlistItemId? }, { fromPlaylistUrn?, playlists?, collections? }): MenuItemSpec[]
playlistMenuItems(ctx, { urn, name }, tracks, playlists?, collections?, opts?: { pinned?, onTogglePin?, onEdit?, onDelete?, onMoved? }): MenuItemSpec[]
collectionMenuItems(ctx, trackUrns, playlists?, collections?, opts?: { pinned?, onTogglePin?, onRename?, onDelete?, onCreatePlaylist?, onCreateFolder?, onMoveToFolder?, onPlay? }): MenuItemSpec[]
addToPlaylistSubmenu(library, trackUrns, playlists): SubmenuSpec | undefined
addToCollectionSubmenu(library, urns, collections, opts?: AddToCollectionSubmenuOptions): SubmenuSpec | undefined
addToCollectionOnlyItems(ctx, urns, collections, opts?: AddToCollectionOptions): MenuItemSpec[]

// React 控制器：open() + 可直接展开的 menuProps
useTrackMenu(ctx, { fromPlaylistUrn? }) → { open(target, anchor?), menuProps }
usePlaylistMenu(ctx)                    → { open(playlist, tracks, anchor?, opts?), menuProps }
useCollectionMenu(ctx)                  → { open(title, trackUrns, anchor?, opts?), menuProps }
useAddToCollection(ctx)                 → { open(title, itemUrns, anchor?, opts?), menuProps }
```

## 菜单内容

**曲目**：加入歌单（子菜单：搜索框 → 新建歌单 → 全部歌单）→ 从此歌单中删除（仅在歌单详情里出现）→ 从“最喜欢的歌曲”中删除（仅 `track.loved` 时）→ 加入播放列表（`player.enqueueLast`）→ 下载 → 转至专辑（有 `albumUrn` 时）→ 睡眠定时器。（注：单曲不提供“加入文件夹”，文件夹只组织歌单、专辑与子文件夹）。

**歌单**：编辑详情（`edit-details`，传入 `onEdit` 时）→ 删除（`delete-playlist`，红色高危，通过宿主弹窗进行二次确认）→ 置顶歌单 / 取消置顶歌单（`toggle-pin`，传入 `onTogglePin` 时）→ 添加到音乐库（`library.setSaved`）→ 加入播放列表（整张入队）→ 下载（整张）→ 添加到其他歌单（子菜单，整张复制）→ 移动至文件夹（支持选择目标文件夹、新建文件夹，以及当处于文件夹内时提供“移至根目录”）。

**专辑（单实体菜单）**：删除（`delete-album`，红色高危，从音乐库移除并清理文件夹关联，通过宿主弹窗进行二次确认）→ 置顶歌单 / 取消置顶歌单（`toggle-pin`）→ 移动至文件夹（`add-to-collection`，支持跨文件夹移动与移至根目录）。

**合集 / 文件夹**：重命名（`rename-collection`）→ 删除（`delete-collection`）→ 置顶文件夹 / 取消置顶文件夹（`toggle-pin`）→ 创建歌单（`create-playlist`）→ 创建歌单文件夹（`create-folder`）→ 移动至文件夹 / 移至根目录 → 播放（递归汇总所有子歌单与专辑中的单曲入队）。

## 设计要点

- **删除二次确认机制**：歌单与专辑的右键删除选项带有危险红字警告（`tone: 'danger'`），其 `onDelete` 回调由外层界面（如 `LibraryScreen`）拦截并唤起 `ConfirmDeleteModal` 二次确认弹窗，用户确认后方才执行实际的 `deletePlaylist` 或 `setSaved(..., false)`。
- **列表类操作先解析曲目再开菜单**：歌单行只有 `trackCount`，没有 track URN；行菜单在打开前 `getPlaylist()` / `listCollectionItems()`，拿不到就不显示对应条目——对空列表生效的菜单项比没有更糟。
- **智能歌单在“加入歌单”子菜单里 disabled**：它的曲目来自规则，没有可写的行（服务会拒绝；会抛错的菜单项比明显不可用更糟）。
- **锚点可选**：右键/长按带坐标，`⋯` 按钮没有——没有锚点时菜单落在屏幕中上，移动端忽略坐标（底部 sheet）。
- **移动与根目录感知**：通过 `currentFolderId` 自动排除当前所在文件夹；处于子文件夹内的项提供“移至根目录”快捷项；移动操作自动触发原文件夹移除与目标文件夹添加。
- **收藏双写不变量**：喜欢/取消喜欢——曲目右键条目与 `useSaveToPlaylistMenu` 弹层里「已点赞的歌曲」的开关——同时写两个存储：先 `sources.setLoved`（画红心、驱动 `onlyLoved`），再 `library.setSaved`（收藏架读这边）。目录先行是为了 `library/changed` 事件触发监听方重读时已是最终状态；只写一边就会出现“取消收藏了但行还是红心”。
- 打开菜单时才拉取歌单列表，慢的 `listPlaylists` 不阻塞菜单本身；子菜单晚一拍填充。

## 测试（`src/index.test.tsx`）

32 个用例：曲目条目的顺序、缺服务时条目消失、`remove-from-playlist` 只在歌单内出现、取消喜欢同时写 `track_stats` 与 `library_items`（右键与弹层开关两条路径都 pin 了双写与先后顺序）、入队/下载/转专辑的调用、睡眠定时器预设与自定义时间解析/取消、子菜单的创建/选择/智能歌单禁用、专辑 `delete-album` 选项触发、歌单与合集条目、文件夹间移动与移至根目录、`useTrackMenu` 的 open/close 状态。
