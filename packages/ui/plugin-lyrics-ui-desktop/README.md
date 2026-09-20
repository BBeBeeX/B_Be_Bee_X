# @BBeBee/plugin-lyrics-ui-desktop

Layer 5（UI）— 桌面端全屏/播放详情页独立歌词面板。

## 概述

`plugin-lyrics-ui-desktop` 为桌面端提供内嵌在正在播放界面的歌词面板。它注册视图 `lyrics.panel` 并贡献给 `now-playing.panel` 插槽，当用户打开播放详情页时，以左右双栏形式展现在右侧。

## 视图与插槽注册

- 注册视图：`ctx.ui.registerView('lyrics.panel', LyricsPanel)`
- 贡献插槽：`ctx.ui.contribute({ kind: 'slot', id: 'lyrics.panel', slot: 'now-playing.panel' })`
- 必需注入：`['ui', 'lyrics', 'player']`

## 交互与视觉特性

1. **视口居中与平滑滚动**：
   - 随 `lyrics/active-changed` 或播放时间推进，高亮行始终保持在歌词容器的垂直居中区域。
   - 采用 CSS `scrollIntoView({ behavior: 'smooth', block: 'center' })`，避免生硬跳动。
2. **层级视觉质感**：
   - 当前播放行：加大字号、发光高亮（Glow Filter）、强调色渐变。
   - 已播放行与未播放行：降低透明度，弱化视觉噪音。
3. **点击歌词跳转播放（Interactive Seek）**：
   - 用户点击任意一行有时间戳的歌词，立即调用 `ctx.player.seek(line.timeMs)` 定位播放，进度条与歌词同步跃迁。
4. **状态反馈与容错**：
   - `loading-lyrics`：柔和转圈加载提示。
   - `no-lyrics`：清晰友好的纯文本空状态提示。
   - `error`：异常提示与重试逻辑，绝不影响主走带正常播放。
