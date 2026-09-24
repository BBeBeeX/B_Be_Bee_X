# @BBeBee/plugin-mini-player

Layer 4（feature）— `ctx.miniPlayer`：桌面独立悬浮小窗与灵动岛无头状态机与控制中心。

## 概述

`plugin-mini-player` 管理桌面独立悬浮小窗（Mini Player）与顶部灵动岛（Dynamic Island）的显示状态、窗口模式与交互通信。它作为无头（Headless）服务运行在主渲染进程中，通过单 Cordis 内核架构（ADR-3）与 Electron 主进程和次级独立窗口保持严格的数据与动作同步。

同时贡献全局命令（如 `mini-player.toggle`、`mini-player.restore-main`），供主播放界面、顶栏按钮、系统托盘或快捷键调用。

## 架构与服务声明

- `class MiniPlayerService extends Service implements IMiniPlayerService`，注册至 `ctx.miniPlayer`。
- **必需注入**：`static inject = ['player']`，`export const inject = ['player']`。
  - 负责监听 `player/state-changed`、`player/track-changed` 与 `player/position`，将完整播放状态推流至次级窗口。
  - 接收次级窗口回传的用户交互动作（播放、暂停、上一曲、下一曲、进度拖动、音量调节），安全调用 `ctx.player` 对应方法。
- **可选注入**：`['ui']`（贡献 `mini-player.*` 全局命令）。
- **能力声明**：贡献服务 `miniPlayer`。

## 三态转换模型

小窗支持三种视觉与布局形态：
1. **`normal`（悬浮小窗）**：380×96px 独立胶囊悬浮窗，居中显示封面、歌名、歌手、进度条与播放控制。拖拽背景任意移动；拖拽接近屏幕顶部边缘时自动吸附切换为灵动岛形态。
2. **`attached`（灵动岛胶囊）**：280×50px 极简胶囊，吸附于屏幕顶部正中央。显示当前曲目与动态跳动音量波形条（`IslandWaveBars`）。点击或向下拉拽展开；双击折叠。
3. **`expanded`（展开灵动岛）**：420×184px 展开大卡片。包含大封面、跑马灯文字、音量柱、进度条与完整控制集群。双击折叠回胶囊；向下拉拽超过阈值（>60px）脱离吸附恢复为普通悬浮小窗。

## 封面协议安全重写（Chromium Boundary）

Chromium 渲染进程严格禁止通过 `<img src="file://...">` 跨域加载本地资源。
本插件内置 `resolveArtworkUri()` 转换器：
- 自动检测本地 `file://` 协议，转换为 Electron 特权自定义协议 `bbebee-file://`；
- 支持优先从 `transport.nowPlaying.artworkUri` 降级回退至 `transport.nowPlaying.artwork.sourceUrl`；
- 配合 UI 层的 `IslandArtwork` 进行跨域加载与错误回退（矢量音符图标）。

## 公开 API

### 状态快照

`ctx.miniPlayer.state`:
```ts
export interface MiniPlayerServiceState {
  visible: boolean                  // 是否显示小窗
  mode: 'normal' | 'attached' | 'expanded' // 当前显示形态
  windowState: 'normal' | 'dragging' | 'near-top' | 'attached' | 'expanded' | 'hidden'
}
```

推流数据包 `MiniPlayerData`:
```ts
export interface MiniPlayerData {
  trackUrn?: string
  title?: string
  artist?: string
  album?: string
  artworkUri?: string
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  canPlayOrPause: boolean
  canPrevious: boolean
  canNext: boolean
  volume: number
  muted: boolean
}
```

### 方法

| 方法 | 说明 |
|---|---|
| `open(options?: { mode?: MiniPlayerDisplayMode })` | 打开小窗，可指定初始形态 |
| `close()` | 关闭小窗并记录当前坐标 |
| `toggle()` | 切换小窗显示与隐藏 |
| `setMode(mode: MiniPlayerDisplayMode)` | 手动切换小窗形态（`normal` / `attached` / `expanded`） |
| `restoreMain()` | 恢复并聚焦主播放器窗口，同时隐藏小窗 |

### 命令贡献

- `mini-player.open`：打开小窗。
- `mini-player.close`：关闭小窗。
- `mini-player.toggle`：切换小窗显示/隐藏。
- `mini-player.restore-main`：还原主播放器窗口。

### 事件

| 事件 | 负载 | 说明 |
|---|---|---|
| `mini-player/changed` | `MiniPlayerServiceState` | 小窗可见性或形态变更时广播 |
