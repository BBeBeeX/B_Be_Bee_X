# @BBeBee/plugin-desktop-lyrics-ui-desktop

Layer 5（UI）— 桌面歌词控制器、原生次级窗口 IPC 桥接与界面适配器。

## 概述

`plugin-desktop-lyrics-ui-desktop` 负责桌面歌词在 Electron 桌面端环境下的渲染与交互对接。

为实现 **“桌面歌词可拖拽至主窗口外部、主窗口最小化时依然停留在屏幕上、锁定后鼠标可穿透”** 的极致桌面体验，本插件采用双模适配架构，既守护了 BBeBee 单 Cordis 内核的不变量（ADR-3），又拥有原生二次窗口的完整系统级能力。

## 注册与依赖

- 注册视图：`ctx.ui.registerView('desktop-lyrics.floating', DesktopLyrics)`
- 必需注入：`['ui', 'desktopLyrics', 'lyrics', 'player']`

## 双模适配架构

### 1. Electron 原生独立窗口模式（Native Mode）

当检测到 `window.BBeBee.desktopLyrics` IPC 桥接接口存在时：
- **无重复 DOM 渲染**：主窗口渲染函数返回 `null`，不占用主窗口 DOM。
- **数据推流**：当播放曲目、时间轴、歌词行、字号或锁定状态变更时，通过 `window.BBeBee.desktopLyrics.updateData(...)` 将渲染所需的数据包实时同步给由主进程管理的二次窗口（Secondary `BrowserWindow`）。
- **动作反向派发**：监听独立歌词窗口的浮动工具栏操作（上一曲、下一曲、播放/暂停、字号增减、锁定切换、关闭），调用 `ctx.player` 与 `ctx.desktopLyrics` 的对应服务方法。

### 2. 网页/测试环境降级模式（DOM Fallback Mode）

在纯浏览器测试（如 Vitest 测试套件）或无 Electron 原生桥接的环境中：
- 自动降级为渲染主窗口内的浮动 DOM 容器。
- 支持基于 DOM 事件的鼠标拖拽、悬浮按钮操作与字号调整，保证 100% 单元测试自动化通过。

## 播放器底栏入口

在主播放器底栏（`NowPlayingBar`）右侧音量调节控制项左侧放置了桌面歌词快捷切换按钮：
- 实时反映当前桌面歌词的开启/隐藏状态；
- 点击调用 `ctx.desktopLyrics.toggleVisible()` 或全局命令 `desktop-lyrics.toggle`。
