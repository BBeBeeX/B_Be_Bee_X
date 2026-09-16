# @BBeBee/plugin-sleep-timer

Layer 4 (feature) — `ctx.sleepTimer`：管理睡眠定时关闭播放逻辑。

## 概述

支持按设定倒计时时长（如 5min / 10min / 15min / 30min / 45min / 1h / 自定义分钟）、指定时间点、或在当前曲目结束时自动停止播放。

刻意 headless：它只管理定时状态并调用 `ctx.player.pause()`，无平台特定依赖。

## 源文件

### `src/index.ts`
- `SleepTimer extends Service`（占用 `ctx.sleepTimer` 服务键）：
  - `startDuration(ms)`: 设定倒计时毫秒数，到期暂停播放。
  - `startAtEpoch(epochMs)`: 设定指定时间戳，到期暂停播放。
  - `startEndOfTrack()`: 监听曲目完成事件（`player/track-completed` 或播放结束 `player/state-changed`），在曲目自然结束时暂停。
  - `cancel()`: 取消当前正在运行的定时器。
  - `state`: 获取当前定时器状态 `{ active, mode, targetEpochMs, durationMs }`。

### `src/hooks.ts`
- `useSleepTimer(ctx)`: 响应式 React hook，订阅 `sleep-timer/changed` 与 `sleep-timer/fired`。
