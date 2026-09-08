# @BBeBee/plugin-inspector-ui-desktop

Layer 5（ui）— `plugin-inspector` 的桌面视图包：插件图（fiber 树 + 带标签 effect）的渲染端。

## 概述

M0 最后一条退出标准的 UI 半边：headless 的 `ctx.inspector` 产出可序列化快照，本包把它渲染出来。**纯结构**——数据完全来自 `ctx.inspector`。

## 源文件

### `src/index.tsx`

**注册的视图与路由**（generator effect `'inspector-ui'`）：

- `ctx.ui.registerView('inspector.panel', bound(ctx, InspectorPanel))`；
- `ctx.ui.contribute({ kind: 'route', id: 'inspector.panel', path: '/inspector', title: 'Inspector', icon: 'bug', placement: ['sidebar'], order: 900 })`——侧边栏末位的开发者路由。

**组件**：

- **`InspectorPanel({ ctx })`** — 顶层面板（等宽字体、13px）。`useState` 初始化为 `ctx.inspector.snapshot()`；**每 1 秒轮询一次**——fiber 树没有变更事件（插件加载卸载不会告诉任何人），轮询便宜且这是开发工具。头部："Plugin graph" 标题 + 状态计数摘要（`n pending · n active · …`，与 `render()` 的摘要同格式）。
- **`Fiber({ node })`** — 递归渲染一个 fiber：名字（加粗）+ 状态徽章（`STATE_COLOR` 映射：ACTIVE 绿 / PENDING·LOADING 橙 / FAILED 红 / UNLOADING·DISPOSED·UNKNOWN 灰）+ `provides …`（紫）/ `waiting …`（橙）行——**"waiting" 一行就是"插件为何 PENDING"的答案**（docs/12 gotcha 表里 `ctx.inspector.render()` 的图形版）。子 fiber 用带左边框的嵌套 `<ul>`；effect（`Effects` 组件）以 `· label` 列在该 fiber 名下，递归展开嵌套 effect。
- **`INSPECTOR_VIEW = 'inspector.panel'`** — 视图 id 常量。

**`bound(ctx, Screen)`** — 本包注释是全仓库对这个模式最有戏剧性的记录：**"This is what made the inspector page a black window"**——shell 用自己的 context（`app.ready(['ui'])`）渲染视图，`InspectorPanel` 读 `ctx.inspector` 在**渲染期**抛 `cannot get property "inspector" without inject`；React 上方没有 error boundary，于是整棵树被卸载、页面只剩 body 的背景色。本包曾是最后一个没做闭合的视图包。`h(Screen, …)` 而非函数调用（hook 链独立）。

## 声明与导出

```ts
export const name = 'plugin-inspector-ui-desktop'
export const inject = ['ui', 'inspector']
export const INSPECTOR_VIEW = 'inspector.panel'
export function InspectorPanel
export async function apply(ctx)
export default { name, inject, apply }
```

仅桌面——移动端没有开发者面板（manifest 的 `entry.ui` 只声明 desktop）。

## 测试

`src/index.test.tsx`：面板渲染与树结构的标记断言。

## 相关文档

- `packages/feature/plugin-inspector/README.md`：headless 侧（快照结构、护栏）
- `docs/03-plugin-system.md` §2：fiber 树
- `docs/12`（AGENTS.md §12 gotcha 表）：`ctx.inspector.render()` 的文本版
