# @BBeBee/plugin-inspector

Layer 4（feature）— `ctx.inspector`：把插件图变成可读数据的检查器。

## 概述

M0 的最后一条退出标准是"插件检查器能展示带标签 effect 的 fiber 树"。这不是锦上添花——本架构的核心主张是**卸载一个插件必须是彻底的**，而判断它是否还握着什么的唯一办法就是看它的 effect 树。检查器因此是承载一切其余不变量的那个不变量的调试工具。

刻意 headless：它产出可序列化的快照（`InspectorSnapshot`），由每个壳（desktop/mobile）各自渲染。见 docs/03 §2。

## 源文件

### `src/index.ts`

包内唯一源文件，包含快照数据结构、`Inspector` 服务与插件入口。

**数据结构**：

- `EffectNode` — 一个带标签的 effect 及其嵌套子 effect。
- `FiberNode` — fiber 树节点：`name` / `uid`（销毁后为 `null`）/ `state` / `inject` / `waitingFor` / `provides` / `effects` / `children`。
- `InspectorSnapshot` — `{ root, counts, stalled }`：
  - `counts`：各 fiber 状态的数量（表头统计行用）；
  - `stalled`：已加载但非 `ACTIVE` 的 fiber 及其原因（`waitingFor`）。

**`Inspector extends Service`**（占用 `ctx.inspector` 服务键）：

| 成员 | 作用 |
|---|---|
| `snapshot(): InspectorSnapshot` | 遍历 fiber 树。Cordis 只通过 registry 暴露 fiber、亲缘关系藏在 `fiber.parent.fiber` 里，所以树按 parent 分组重建。**深度护栏 32**：`parent` 成环会让检查器挂死，挂死的调试工具比没有更糟；截断不是静默的——`warnOnce` 明说"this is a cycle in parentage"。 |
| `render(): string` | 纯文本树（`├─`/`└─` + effect `·` 行），供日志、bug 报告和终端使用；尾部附状态统计摘要。 |
| `providedBy(fiber)` | 反查 `ctx.reflect.store`，列出该 fiber 提供的服务键。 |

**承重细节**：

- `isAvailable()` 用 try/catch 读 `fiber.ctx[name]`：**必需注入缺失时 Cordis 抛 `cannot get required service … in inactive context`** 而非返回 `undefined`——恰恰是检查器要展示的那种坏状态。诊断工具绝不能在它诊断的坏状态上自己抛错。
- `warnOnce()`：检查器天然被反复读取（它是 fiber 树的活视图），任何日志必须在源头去重，否则 UI 每次渲染都会把"一次性事实"变成日志洪水。
- 未知 fiber 状态渲染为 `UNKNOWN` 并告警一次：`cordis` 锁定在 rc 版本正是为了防它自己挪动状态值；没有这条，漂移只会表现为一个没人读的徽章。

## 配置与能力

- 无配置、无 inject、`capabilities: []`。
- 贡献服务键：`inspector`。

## 导出

```ts
export class Inspector extends Service   // ctx.inspector
export interface EffectNode / FiberNode / InspectorSnapshot
export const name = 'plugin-inspector'
export async function apply(ctx: Context)  // 刻意 await ctx.plugin(Inspector)
export default { name, apply }
```

> ⚠️ `apply` 必须是 `async function`（Cordis 用 `!!func.prototype` 判定"是否类"，普通 `function` 会被 new 掉、返回的 disposer 丢失），且内部刻意 `await ctx.plugin(...)`——不 await 的子插件不传播就绪状态。`conventions.test.ts` 强制这两种形态。

## 相关文档

- `docs/03-plugin-system.md` §2：生命周期与 fiber 树
- `docs/09-project-structure.md`：分层与依赖规则
