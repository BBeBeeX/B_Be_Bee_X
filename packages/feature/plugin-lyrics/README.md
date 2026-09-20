# @BBeBee/plugin-lyrics

Layer 4（feature）— `ctx.lyrics`：歌词获取、多级缓存、进度同步与统一状态。

## 概述

`plugin-lyrics` 负责音频播放过程中的歌词生命周期管理。它连接播放走带、音源系统与本地持久层，为界面端（如播放页全屏歌词面板、桌面悬浮歌词）提供一致的同步状态与事件订阅。

当曲目切换时，插件自动发起歌词获取流程，并在播放推进时（通过 `player/position` 事件及内部算法）计算当前正在演唱的歌词行索引，向整个应用广播。

## 服务声明

- `class LyricsPlugin extends Service implements LyricsService`，`super(ctx, 'lyrics')` → `ctx.lyrics`（接口定义在 `@BBeBee/protocol`）。
- **必需注入**：`['player', 'db', 'sources']`。
- **可选注入**：`['ui']`（若存在则声明贡献 `now-playing.panel` 插槽描述符）。
- **能力声明**：`db:read:core`、`db:write:core`（读写 SQLite 核心目录库的 `lyrics` 表）。

## 核心机制

### 1. 多级缓存与获取策略

调用 `getLyricsForTrack(trackUrn)` 时遵循三级缓存回退策略：

```
[ 请求歌词 ]
    │
    ▼
1. 内存 LRU 缓存 (memoryCache) ──── 命中 ───► 返回
    │ 未命中
    ▼
2. 本地 SQLite (lyrics 表) ───────── 命中 ───► 填充内存 ───► 返回
    │ 未命中
    ▼
3. 音源提供方 (ctx.sources.forUrn) ── 命中 ───► 持久化至 DB & 内存 ───► 返回
    │ 失败 / 无提供方
    ▼
[ 状态置为 no-lyrics 或 error ]
```

1. **内存缓存**：快速应对列表来回切歌，默认容量限制，避免重复反序列化。
2. **SQLite 存储**：在 `lyrics` 表中持久化字段 `(track_urn, format, content, synced, offset_ms, language)`，离线可用且避免浪费用户流量。
3. **音源解析**：通过 `ctx.sources.forUrn(trackUrn)` 找到对应的音源提供者。若该提供者支持 `getLyrics(trackId)`，则发起请求解析（例如 Bilibili 字幕转 LRC 或 Subsonic 歌词接口），获取后自动回写数据库。

### 2. 播放进度与同步对齐

- 监听 `player/track-changed`：自增内部 generation 标号（防切歌竞态），重置状态并异步加载新曲目歌词。
- 监听 `player/position`：基于二分查找算法（来自 `@BBeBee/toolkit` 的 `findActiveLyricIndex`）计算匹配的时间戳行，当命中行变化时触发 `lyrics/active-changed`。
- 监听 `player/state-changed`：响应 loading 与 idle 等走带状态，友好显示 loading 提示或清理画布。

## 公开 API

### 状态快照

`ctx.lyrics.state`:
```ts
interface LyricsState {
  status: 'idle' | 'loading-song' | 'loading-lyrics' | 'ready' | 'no-lyrics' | 'error'
  trackUrn?: string
  lyrics?: Lyrics
  activeIndex?: number
  offsetMs: number
  error?: string
}
```

### 方法

| 方法 | 说明 |
|---|---|
| `getLyricsForTrack(trackUrn)` | 查询指定 URN 的歌词（内存 → SQLite → 音源） |

### 事件

| 事件 | 负载 | 说明 |
|---|---|---|
| `lyrics/changed` | `LyricsState` | 歌词整体状态变更（曲目变化、加载完成、错误等） |
| `lyrics/active-changed` | `number` | 当前正在演唱的高亮行索引变更 |
