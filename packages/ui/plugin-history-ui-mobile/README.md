# @BBeBee/plugin-history-ui-mobile

Layer 5（ui）— `plugin-history`（headless）的移动端视图包：播放历史与统计页面。

## 概述

把 `history.view` 注册并绑定到移动端 React Native shell。数据来自 `@BBeBee/plugin-player/hooks`（`usePlayHistory`、`usePlayHistoryStats`），组件采用 `@BBeBee/ui-kit-mobile`（`List`、`TrackRow`、`ContextMenu`）。

## 注册的视图

| id | 组件 | 说明 |
|---|---|---|
| `history.view` | `HistoryScreen` | 移动端播放历史与统计页面 |

## 核心功能

1. **顶部统计面板**：展示总播放次数、累计播放时长及今日听歌数。
2. **曲目去重**：按 `trackUrn` 严格去重，仅保留每首曲目最新一次播放记录。
3. **播放次数徽标**：在每首曲目右侧展示 `播放 N 次` 胶囊徽标。
4. **单曲播放与长按菜单**：轻触即播，长按呼出曲目快捷菜单。
