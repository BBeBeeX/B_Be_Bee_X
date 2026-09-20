# @BBeBee/plugin-desktop-lyrics

Layer 4（feature）— `ctx.desktopLyrics`：桌面歌词无 UI 状态机与控制中心。

## 概述

`plugin-desktop-lyrics` 管理桌面歌词的显示状态、排版设置与锁定模式。它作为无头（Headless）服务运行，将状态广播给界面层（例如 Electron 独立原生歌词窗口适配器或开发期浮动覆层）。

同时贡献全局命令 `desktop-lyrics.toggle`，供主播放界面工具栏、托盘菜单或键盘快捷键调用。

## 服务声明

- `class DesktopLyricsService extends Service`，`super(ctx, 'desktopLyrics')` → `ctx.desktopLyrics`。
- **必需注入**：`[]`（无底层硬依赖，即使无网络或音源离线也能管理桌面歌词界面状态）。
- **可选注入**：`['ui']`（贡献 `desktop-lyrics.toggle` 命令）。
- **能力声明**：贡献服务 `desktopLyrics`。

## 公开 API

### 状态快照

`ctx.desktopLyrics.state`:
```ts
interface DesktopLyricsState {
  visible: boolean          // 是否显示桌面歌词
  showNextLine: boolean     // 是否展示次行预读歌词
  fontSize: number          // 字体大小 (14 - 40px)
  opacity: number           // 背景与字体透明度 (0.2 - 1.0)
  position: { x: number, y: number } // 窗口位置
  locked: boolean           // 是否锁定（锁定模式下支持鼠标事件穿透）
}
```

### 方法

| 方法 | 说明 |
|---|---|
| `toggleVisible()` | 切换桌面歌词的显示与隐藏 |
| `setVisible(visible: boolean)` | 设置桌面歌词可见性 |
| `setShowNextLine(show: boolean)` | 设置是否显示双行歌词 |
| `setFontSize(size: number)` | 设置歌词字号（自动 clamp 限制范围 14-40） |
| `setOpacity(opacity: number)` | 设置透明度（自动 clamp 限制范围 0.2-1.0） |
| `setPosition(pos: DesktopLyricsPosition)` | 设置/记忆窗口位置坐标 |
| `setLocked(locked: boolean)` | 设置锁定状态（结合 Electron 开启鼠标穿透） |

### 命令贡献

- `desktop-lyrics.toggle`：切换桌面歌词显示/隐藏。

### 事件

| 事件 | 负载 | 说明 |
|---|---|---|
| `desktop-lyrics/changed` | `DesktopLyricsState` | 桌面歌词状态属性发生任何变更时广播 |
