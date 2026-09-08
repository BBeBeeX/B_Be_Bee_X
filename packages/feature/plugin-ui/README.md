# @BBeBee/plugin-ui

Layer 4（feature）— `ctx.ui`：贡献注册表（the contribution registry）。

## 概述

插件注册的是**与渲染器无关的描述符（descriptor）**——`route`、`slot`、`command`、`settings`、`menu`——每个壳（desktop 的 React DOM / mobile 的 React Native）把这些名字解析到自己的组件集上。这正是"一个 headless 插件同时服务两个壳"的全部机制（ADR-2）。

注册表本身刻意"笨"：只**存储、排序、发还**。一个贡献*长什么样*的所有决策都属于壳。见 docs/08 §2。

## 源文件

### `src/index.ts`

包内唯一源文件，包含 `Ui` 服务、事件声明与插件入口。

**`Ui extends Service implements UiService`**（占用 `ctx.ui` 服务键）：

| 成员 | 作用 |
|---|---|
| `contribute(c): Disposable` | 登记一条贡献。返回 disposer——插件卸载时带着自己的贡献一起走，壳"自然看不到"，无需失效协议。每次增删 emit `ui/changed`。 |
| `registerView(id, component): Disposable` | 把 view id 绑到组件。重复注册同一 id 只告警并忽略后者（两个包抢一个 id 意味着壳渲染"后加载者"，是抛硬币般的 bug）。 |
| `routes` / `commands` / `menus` / `settings` | 按 `kind` 过滤后的只读列表。排序规则：`order` 字段优先，插入序次之，**永不按对象身份**（`byOrder`）。 |
| `slotsFor(slot): SlotContribution[]` | 某个槽位 id 下的贡献。 |
| `runCommand(id, args?)` | 按 id 查找并执行命令；不存在则抛错。 |
| `viewFor(id): unknown \| undefined` | 取绑定到 id 的组件。**`undefined` 是正常状态而非错误**：插件可以只出桌面视图不出移动视图——壳渲染占位而非崩溃（ADR-2 的持续代价，docs/08 §3）。 |
| `missingViews(): string[]` | 已贡献 route/slot/settings 但本目标没有对应视图的 id 列表，驱动诊断。 |

**关键类型决策**：`registerView` 的 `component` 参数是 `unknown`——`@BBeBee/protocol` 不依赖任何 React 变体，类型收窄发生在各壳自己的边界上、且只 cast 一次。

## 事件

- `ui/changed`（`Events` 增强）：任何贡献或视图注册变化时发出，壳监听它重新读取注册表。

## 配置与能力

- 无配置、无 inject、`capabilities: []`。
- 贡献服务键：`ui`。

## 导出

```ts
export class Ui extends Service   // ctx.ui
export const name = 'plugin-ui'
export async function apply(ctx: Context)  // 刻意 await ctx.plugin(Ui)
export default { name, apply }
```

> ⚠️ `apply` 必须是 `async function` 且内部刻意 `await ctx.plugin(...)`（理由同所有服务型插件，见 `conventions.test.ts` 与本包注释）。

## 相关文档

- `docs/08-ui-architecture.md` §2/§3：描述符模型、"one plugin, two shells"
- `packages/protocol/src/services/ui.ts`：`Contribution` 各形态的完整定义
