# @BBeBee/plugin-mini-player-ui-desktop

Layer 5（UI）— 桌面独立悬浮小窗与灵动岛界面呈现、次级原生窗口适配器与手势交互系统。

## 概述

`plugin-mini-player-ui-desktop` 负责悬浮小窗与顶部灵动岛在桌面环境下的视觉渲染、动画过渡与手势交互。

本插件运行于独立的次级透明窗口（`?window=mini-player` 或 `#mini-player`）中，严格遵循单 Cordis 内核不变量（ADR-3），作为被动渲染视图（Passive View）接收来自主渲染进程 `ctx.miniPlayer` 的推流数据，并将用户操作回传执行。

## 注册与依赖

- 视图注册：
  - `ctx.ui.registerView('mini-player.window', bound(ctx, MiniPlayerWindow))`：次级窗口全屏根容器
  - `ctx.ui.registerView('mini-player.button', bound(ctx, MiniPlayerButton))`：顶栏右侧切换入口
- 必需注入：`['ui', 'miniPlayer']`

## 组件划分与单一职责

```
src/
├── components/
│   ├── MiniPlayerWindow.tsx      ← 顶层路由与形态分发容器（挂载于次级窗口）
│   ├── MiniPlayerFloating.tsx    ← 悬浮小窗模式视图（380×96px）
│   ├── MiniPlayerIsland.tsx      ← 顶部灵动岛视图（胶囊 280×50px / 展开 420×184px）
│   ├── MiniPlayerControls.tsx    ← 播放控制按钮组合（播放/暂停/上一曲/下一曲/进度条）
│   ├── MiniPlayerButton.tsx      ← 主界面顶栏小窗切换按钮
│   ├── IslandArtwork.tsx         ← 封面组件（协议转换、CORS 策略、错误回退）
│   └── IslandWaveBars.tsx        ← 灵动岛跳动音频波形律动条
├── screens.test.tsx              ← 自动化单元测试（覆盖渲染、模式切换、按钮交互）
└── index.tsx                     ← Cordis 插件生命周期入口与导出
```

## 三态界面与自然手势体系

为了提供极致纯粹、无视觉干扰的原生桌面体验，本插件去除了繁琐的折叠/吸附/脱离图标按钮，统一采用直觉化手势体系：

### 1. 悬浮小窗形态（`normal`）
- **尺寸与布局**：380×96px 经典胶囊圆角卡片。
- **拖拽与吸附**：背景区域支持窗口拖拽（`-webkit-app-region: drag`）。当拖拽至任意显示器屏幕顶部边缘（≤40px）时，自动触发吸附动画并切换为灵动岛形态。
- **操作项**：右上角提供“恢复主窗口”（`⤢`）与“关闭小窗”（`✕`）操作按钮。

### 2. 灵动岛胶囊形态（`attached`）
- **尺寸与布局**：280×50px 超椭圆胶囊，居中紧贴屏幕顶部。
- **信息展示**：呈现当前曲目名称、歌手名，以及右侧实时律动的动态音量柱（`IslandWaveBars`）。
- **展开与折叠**：
  - **单击**胶囊区域：展开为大卡片形态；
  - **双击**胶囊区域：快速折叠。

### 3. 展开灵动岛形态（`expanded`）
- **尺寸与布局**：420×184px 展开卡片，紧贴屏幕顶部。
- **完整功能**：大尺寸专辑封面、跑马灯曲目文字、音量条、进度时间轴滑块及完整播放控制按钮。
- **脱离吸附**：向下拉拽卡片超过阈值（>60px），窗口脱离顶部吸附并平滑恢复为悬浮小窗形态（记住原浮动坐标）。
- **折叠回胶囊**：双击卡片空白背景，折叠收起回极简胶囊形态。

## 封面与图片渲染安全

- **本地资源特权协议**：Chromium 渲染进程默认封禁 `file://` 协议跨域请求。`IslandArtwork` 与底层桥接协同，自动将本地音乐文件封面转换为 Electron 特权协议 `bbebee-file://`；
- **跨域安全属性**：配置 `crossOrigin="anonymous"` 与 `referrerPolicy="no-referrer"`，防止跨域图片污染；
- **平滑降级**：图片资源加载失败或未指定封面时，无缝回退为精致的默认单色矢量音乐图标，保障界面无任何破损破图。

## 视觉与阴影标准

- **拒绝大范围晕影光圈**：严格禁止在透明窗体上应用过大的模糊半径（>30px）或高亮白色扩散环（`0 0 0 1px white`），杜绝脏乱发白的发光 halo。
- **深色磨砂质感**：背景采用高对比深色玻璃 `rgba(18, 18, 18, 0.85)`，配合系统级 `backdrop-filter: blur(24px)` 与 `1px solid rgba(255, 255, 255, 0.08)` 微光内边框。
- **紧凑多级黑影**：
  - 悬浮小窗：`0 6px 16px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.25)`（悬停增强至 `0 10px 24px rgba(0, 0, 0, 0.55)`）；
  - 灵动岛胶囊：`0 4px 12px rgba(0, 0, 0, 0.45)`；
  - 展开灵动岛：`0 12px 28px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)`。
