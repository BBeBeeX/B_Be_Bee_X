# @BBeBee/plugin-local-scanner-ui-desktop

Layer 5（ui）— `plugin-local-scanner`（headless）的桌面视图包：扫描根设置屏。

## 概述

哪些文件夹、上次扫描发生了什么、以及一个启动遍历的方式。布局与接线而已——进度簿记在 `plugin-local-scanner/hooks`，与移动孪生共享（docs/08 §1）。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'scanner-ui-desktop'`）：

| id | 组件 |
|---|---|
| `scanner.settings` | `ScanRootsScreen` |

**`ScanRootsScreen({ ctx })`** — 扫描根管理屏。`useScanRoots` + `useScanState`（headless hooks）供数。结构：

- **header 行**："Music folders" 标题 + "Add folder" + "Scan now"（扫描中显示 "Scanning…" 并 `disabled`——**禁用而非隐藏**："扫描中途消失的控件让屏幕看起来丢了按钮"）+ 扫描中出现的 "Cancel"（ghost）。
  - **`addFolder()` 走 `ctx.fs.pickDirectory()`**：选择器才是 Android 上携带持久授权的东西，手输路径拿不到——所以**刻意没有文本框**。
- **进度行**（逐批而非逐次）：`scan.progress` → "Scanned N of M / Scanned N files"；否则 `scan.lastSummary` → "Last scan: …"（`summarise`），**有 errors 时 tone 用 `'warn'`**。大库要扫几分钟，只在结束时 learn 结果的屏幕全程看着像冻死。
- **根列表**：`List<ScanRoot>`（`estimatedItemSize: tokens.size.row`），空态 📁 "No folders yet"。行内：URI（截一行）+ **失败原因 `root.lastError` 用 error tone 显示在行上**——"文件夹失败的原因留在用户眼前，而不是只在一个他们永远不会打开的日志里"；`Enable/Disable` 按钮（`accessibilityLabel` 按 URI 生成）；🗑 `IconButton` 删除。
  - **删除默认保留曲目**（`removeRoot(id)` 不带 `forgetTracks`）——"误点一下就丢一个曲库，比留一行陈旧数据糟糕得多"。屏尾固定一行说明："Removing a folder keeps the tracks it found. Nothing is deleted from disk."
- 禁用的根行 `opacity: 0.5`。

**`bound(ctx, Screen)`** — 闭包本插件 `apply` 时的 context（shell 的 context 只有 `ui`，读 `ctx.scanner` 会抛错）；`h(Screen, …)` 而非函数调用。

## 声明与导出

```ts
export const name = 'plugin-local-scanner-ui-desktop'
export const inject = ['ui', 'scanner', 'fs']
export function ScanRootsScreen
export async function apply(ctx)
export default { name, inject, apply }
```

`fs` 进 inject 是因为 `pickDirectory`——添加文件夹是本屏唯一直接消费平台能力服务的地方。

## 测试

`src/screen.test.tsx`：设置屏的渲染与交互（根列表、进度/摘要行、扫描按钮状态）。

## 相关文档

- `packages/feature/plugin-local-scanner/README.md`：headless 侧（`ScannerService`、hooks、`summarise` 的 incomplete 语义）
- `packages/ui/plugin-local-scanner-ui-mobile/README.md`：孪生半边
