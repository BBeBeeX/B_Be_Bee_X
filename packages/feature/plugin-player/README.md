# @BBeBee/plugin-player

Layer 4（feature）— `ctx.player`：transport（走带控制）、queue（队列）、resolution（播放解析）、history（播放历史）。

## 概述

播放器决定"**播什么、什么时候播**"；`ctx.dsp` 决定听起来怎样，`ctx.audio` 拥有音频图——本插件对后两者的唯一触碰点是 `chainInput`（源节点永远连它而不是 destination，中间的空位就是 DSP 链条，源与效果器因此各自有独立生命周期）。

它是 `player/before-resolve` waterfall 的发起方：**Player 不知道字节从哪来**——`plugin-download` 挂上来替换成本地文件、failover 换 linked URN 重试，Player 一行不改（"有无 plugin-download 播放行为一致"的对照测试的控制臂就在这）。

## 服务声明

- `class Player extends Service implements PlayerService`，`super(ctx, 'player')` → `ctx.player`（接口在 `protocol/src/services/audio.ts`）。
- 必需注入：`['audio', 'sources', 'db']`。
- 可选注入（嵌套 `ctx.inject`，缺失时降级不崩溃）：`['mediaSession']`（锁屏/系统媒体控制）、`['ui']`（贡献 route/command）、`['background']`（wake lock 与挂起前检查点）。
- 隐式读取（鸭子类型）：`ctx.device.network()`（计费网络 → `saveData`）、`ctx.codec.supportedFormats()`。

**能力声明**：`audio`、`mediaSession`、`background`、`db:read:core`、`db:write:core`（队列/状态/历史表都在 `core` 命名空间；两个动词不嵌套所以都要）。

## 源文件

### `src/index.ts` — 主服务 `Player`

**公开 API（`ctx.player` 表面）**：

| 方法 | 作用 |
|---|---|
| `state` / `queue` | 走带状态快照 / 队列项（存储序） |
| `play()` / `pause()` / `togglePlay()` / `stop()` | 基本走带。`loading` 期间的暂停靠 `playIntent=false` 在加载完成时兑现；`stalled` 视同播放。 |
| `seek(ms)` | 暂停时用 play-then-pause 技巧让媒体元素定位 |
| `next()` / `previous()` | previous 在位置 > `previousThresholdMs`（默认 3s）时先 seek(0)"重播当前曲" |
| `setVolume/setMuted/setRepeat/setShuffle` | 委托 `ctx.audio` + 状态 + 持久化；shuffle 开启时生成新种子 |
| `playNow(urns, opts?)` | **整队替换**：经 `player/before-enqueue` waterfall 过滤 → 换队列 → 从 `startIndex` 开始播 |
| `playFromContext(urn, contextUrns?, opts?)` | **列表语境的点播**：URN 已在队列（按播放序，含 shuffle）→ 原队列不动、跳到该项；不在 → 用 `contextUrns`（专辑/本地库等被点击行所属的列表）整队替换并从点击处播；语境缺失或不含该曲 → 单曲播放 |
| `enqueueNext / enqueueLast / removeItems / moveItem / clearQueue` | 队列操作。删到正在播的那首则 `stop()`，不悄悄跳曲；`moveItem` 只写一行（fractional index 的回报） |
| `upcoming()` / `refresh()` | 播放序的"接下来"；1 Hz 时钟的一跳（发 `player/position`、驱动 prefetch/crossfade/节流持久化） |

**播放解析流程（URN → 可播放流）**：结束上一曲 → 置 `loading`、发 `player/track-changed` → **gapless 快路径**（prefetch 命中直接 attach）→ 否则 `resolveStream`（构造 `StreamPrefs` → `player/before-resolve` waterfall → `ctx.sources.forUrn(...).resolveStream`）→ `ctx.audio.load(handle.target, { strategy, ... })` → attach 到 `chainInput`。策略选择：远程 → `stream`；本地超过 `bufferMaxBytes`（默认 ~150MB）→ `stream`（buffered 持有的是解码后 PCM，约文件体积 10 倍）；否则 `buffer`。

**错误处理**：按 `SourceError.code` 分派——`auth` → emit `source/auth-expired`（serial）后停止；`rate-limit` → 按 `retryAfterMs` 重试一次；`network` → 指数退避重试 3 次；`not-found` → `markUnavailable` 灰化后跳曲。`maxSkipStreak`（默认 10）防 repeat-all 下的无限跳曲风暴。

**平台策略（interruption 表，docs/05 §5）**：interruption `began` 暂停并记住"是我们暂停的"；`ended + shouldResume` 仅当如此时恢复；**route `device-removed`（拔耳机/断蓝牙）立即暂停、绝不自行恢复**——不可配置。

**关键不变量**：`playIntent` 解决"加载完成时的 autoplay 标志已过时"的竞态（按 play 立刻按 pause 不会自顾自响起来）；teardown 顺序：清 ticker → 取消 prefetch → 清 fading → 结算进行中的 play → detach → 释放 wake lock → 强制持久化；mediaSession teardown 必须 `clear()`，否则锁屏留下"幽灵曲目"。

### `src/queue.ts` — 队列模型（纯逻辑，无 audio/DB/时钟）

`QueueModel` + `permute`（种子化 Fisher–Yates）。两个核心决策：

1. **位置是 fractional index key**（base-36 字符串，来自 protocol 的 `between`/`sequence`，Greenspan 中点算法）：`move()` 算出新 key 后**只 UPDATE 一行**；键按字典序 `ORDER BY`，排序交给 SQLite。5000 首的队列拖一首不用重写尾部。
2. **Shuffle = 种子 + 确定性排列**：`mulberry32` PRNG。每次开启生成新种子（再 shuffle 不是同一个序）、种子持久化（重启后是同一个序）——所以 `previous()` 有意义、UI 能如实展示 upcoming。

`next()`/`previous()` 尊重 `repeat`：`'one'` 原地重复（不 re-resolve，复用已加载 buffer）；回绕只在 `'all'`。

### `src/store.ts` — `PlayerStore`：SQL 持久层（纯 SQL，无事件）

| 方法 | 表 | 说明 |
|---|---|---|
| `loadQueue / replaceQueue / insertQueue / removeQueue` | `queue_items` | replace 是事务内 DELETE+重插；`playback_state.current_item_id` 是 `ON DELETE SET NULL`，所以**先换队列后存状态**。损坏的 `source_context_json` 只损失一行"来自"信息，不拖垮插件 init。 |
| `moveQueueItem` | `queue_items` | **一行** UPDATE |
| `loadState / saveState` | `playback_state` | 单行表 UPSERT（currentItemId、positionMs、repeat、shuffle、seed、volume、muted） |
| `recordPlay(record)` | `play_history` + `track_stats` | **一个事务**：append 事实行（`scrobble_state='pending'`）+ UPSERT 派生统计 |
| `markUnavailable(urn)` | `tracks` | `available = 0`：灰显而非隐藏 |
| `nowPlaying(urn)` | tracks ⋈ albums ⋈ artworks | 锁屏元数据；封面只给本地 Uri |

### `src/hooks.ts` — 两个 UI 壳共用的 React hooks

逻辑写一次（ADR-2：headless 里写逻辑，JSX 写两次），基于 `ui-core` 的 `useServiceState`：

| 导出 | 说明 |
|---|---|
| `useTransport(ctx)` | 订阅 `player/state-changed` + `player/track-changed` |
| `useQueue(ctx)` | 订阅 `queue/changed`；逐元素比较，内容不变不触发 5000 行列表重渲染 |
| `usePosition(ctx)` | **rAF 插值 hook**：以 1 Hz 的 `player/position` 为锚点、`requestAnimationFrame` 补帧。每秒变约 60 次，只给进度条/时间标签用 |
| `useTransportAvailability(ctx)` | `{ canPlay, canPause, canSeek, canNext, canPrevious }`——控件可用性判定只写一次 |
| `useDuration(ctx)` | `durationMs > 0` 才返回，区分"未知"与直播流 |
| `isPlayingLike(status)` | 用户视角：`playing \|\| stalled \|\| loading`。⚠️ 与服务侧私有版本（无 `loading`）**故意不同**：那边是音频语义，这边是用户视角 |
| `formatDuration(ms?)` | `mm:ss` / `h:mm:ss`；无效输入 `--:--` |

### `src/views.ts` — 描述符 id 常量

```ts
PLAYER_VIEWS    = { nowPlaying: 'player.now-playing', queue: 'player.queue' }
PLAYER_ROUTES   = { nowPlaying, queue }            // 同值
PLAYER_COMMANDS = { togglePlay: 'player.togglePlay', next: 'player.next', previous: 'player.previous' }
```

init 时注册 route `/now-playing`（tab-bar，order 10）、route `/queue`（tab-bar + sidebar，order 20）与三个 command（`togglePlay` 默认键位 `Space`；命令不依赖视图——桌面进命令面板，移动端进 more-menu）。**没有 slot**；view 组件由 `plugin-player-ui-{desktop,mobile}` 绑定到这些 id。

## 事件

| 方向 | 事件 |
|---|---|
| emit | `player/state-changed`、`player/track-changed`、`player/position`（1 Hz，UI 用 rAF 插值，不许轮询）、`player/error`、`queue/changed` |
| 派发（他人监听） | `player/track-completed`（`ctx.parallel`，scrobbler 消费）、`source/auth-expired`（`ctx.serial`） |
| 发起 waterfall | `player/before-resolve`、`player/before-enqueue`（监听者原地改参数后调 `next()`——Cordis 的 `next` 不收参数） |

## 配置（`PlayerConfig`）

`previousThresholdMs=3000`、`transition='gapless'`（`'gapless'|'crossfade'|'neither'` 三态互斥——同时做会产生双重淡出）、`crossfadeMs=0`、`tickMs=1000`、`saveThrottleMs=5000`、`retryBackoffMs=500`、`bufferMaxBytes≈150MB`、`maxSkipStreak=10`、`stallTimeoutMs=30000`、`deviceId='this-device'`（为多设备同步预留）。

**Prefetch/gapless/crossfade**：prefetch 窗口 `max(15s, crossfadeMs+5s)`，在 `refresh()` 里解析**下一首**并必须以 buffer 策略预载（无缝交接等不起网络读）；crossfade 时出曲 source 放进 `fading` 由定时器稍后回收（立刻 dispose 会让 ramp 永远不发声）；**身份随音频移动**——交接时更新 `currentItemId`、发 `track-changed`，否则走带/锁屏/历史都以为还在播上一首。

## 相关文档

- `docs/05-audio-playback.md`：transport 状态机、interruption 表、DSP
- `docs/07-data-model.md`：`queue_items`/`playback_state`/`play_history`/`track_stats`
- `packages/core/core-audio-webaudio/`：音频图实现
