# @BBeBee/plugin-local-scanner-ui-mobile

Layer 5（ui）— `plugin-local-scanner`（headless）的移动视图包：桌面版的孪生半边。

## 概述

同一个扫描根设置屏的 React Native 版：同样的 hooks（`useScanRoots`/`useScanState`/`summarise`）、同样的视图 id（`scanner.settings`）、同样的行为——只有元素不同。进度簿记在 headless hooks 里，两个壳共享。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'scanner-ui-mobile'`）：

| id | 组件 |
|---|---|
| `scanner.settings` | `ScanRootsScreen` |

**`ScanRootsScreen({ ctx })`** — 与桌面逐条对应，仅元素换成 `nativePrimitives()` 的 RN 原语（`View` 等，`as never` 断言）：

- header 横排（RN `flexDirection: 'row'`）："Music folders" + "Add folder"（`ctx.fs.pickDirectory()`——选择器才携带 Android 持久授权，刻意无文本框）+ "Scan now"（禁用而非隐藏）+ 扫描中 "Cancel"；
- 进度行 / `summarise(lastSummary)`（errors → warn tone）——逐批更新，大库不会全程看着像冻死；
- 根列表：`List<ScanRoot>` + 空态 📁 "No folders yet"；行内 URI、行上 `lastError`（error tone）、`Enable/Disable`（带 URI 的 `accessibilityLabel`）、🗑 删除（默认保留曲目）；
- 屏尾说明："Removing a folder keeps the tracks it found. Nothing is deleted from disk."

**`bound(ctx, Screen)`** — 闭包本插件 `apply` 时的 context；`h(Screen, …)` 而非函数调用（与全部视图包同模式，防 shell context 上抛 `cannot get property … without inject`）。

## 声明与导出

```ts
export const name = 'plugin-local-scanner-ui-mobile'
export const inject = ['ui', 'scanner', 'fs']
export function ScanRootsScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## 测试

`src/screen.test.tsx`：经 `configureNative` 注入假原语后的渲染断言（与 `ui-kit-mobile` 测试同一条缝）。

## 相关文档

- `packages/ui/plugin-local-scanner-ui-desktop/README.md`：孪生半边（行为的完整描述）
- `packages/feature/plugin-local-scanner/README.md`：headless 侧
- `apps/mobile/`：`configureNative` 与设置页挂载
