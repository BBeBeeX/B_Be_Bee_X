# @BBeBee/ui-parity

Layer 5（ui）— 让 ADR-2 买得起的那道检查。

## 概述

两个 kit、零共享组件代码、一个产品。没有门禁 kit 就会漂移：一端改名一个 prop、一个组件只存在于一端、一个调色板只在一种 scheme 下可读。这些在发生的那一周修复很便宜，一年后很昂贵——那时每个插件作者都已经绕着它写过代码了。

所以组件集是**数据**，在 CI 检查，而不是一个约定。写两端视图包的插件作者应该是在誊写，不是在重新设计（docs/08 §6）。在这里新增一个组件是刻意行为：它承诺有人会把它写两遍。

## 源文件

### `src/contract.ts` — 组件契约（数据）

- **`ComponentSpec` / `PropSpec`** — `{ name, purpose, props: [{ name, required?, note? }] }`。`note` 写明 prop 为什么存在，读它的时机是"有人决定新组件是否真的需要第七个 prop"。
- **`UNIVERSAL`** — 每个组件都收的 `testID` 与 `accessibilityLabel`：可访问名写一次在这里、由各 kit 映射到 `aria-label` 或 `accessibilityLabel`，逐组件决策必然有人做错。
- **`COMPONENT_CONTRACT: ComponentSpec[]`** — 11 个组件的完整契约（`Button`、`IconButton`、`TrackRow`、`Slider`、`Sheet`、`List`、`EmptyState`、`Toast`、`TextField`、`Text`、`Artwork`），每条带 purpose 与逐 prop 说明（如 `Slider.onChange`/`onCommit` 的分工、`TextField.multiline` 对应"几百行 JSON 对一行规则"、`IconButton.accessibilityLabel` 是唯一必填的 label）。
- `COMPONENT_NAMES` — 名字列表，`checkParity` 判"契约外导出"用。

### `src/index.ts` — 检查器

| 导出 | 作用 |
|---|---|
| `KitExports` / `KitPropMap` | 检查所见的一个 kit：就是它的导出对象——检查跑在模块对象上，**无需渲染器、DOM 或设备**，这正是它能随每次变更跑在 CI 里、而不是一版一次的原因。props 清单是**声明而非反射**：React 组件的参数名在运行时被擦除，靠构建步骤恢复它们比清单本身更值得怀疑。 |
| `checkParity(input): ParityProblem[]` | 产出问题列表（不是布尔值，CI 日志要能直接点名组件与 prop）：<br>· `missing` — 某端缺契约组件<br>· `extra` — 导出了契约外的**大写开头**组件（插件作者会发现并使用它；helper 不受限）<br>· `not-a-component` — 桶文件错误的形状<br>· `missing-prop` — manifest 未声明契约要求的 prop<br>· `contrast` — 调色板 WCAG AA 失败（来自 `ui-tokens.paletteContrastIssues()`） |
| `formatProblems(problems)` | CI 可读的消息；空列表输出 "kits are in parity"。 |
| `specFor(name)` / `requiredProps(name)` | 给各 kit 自己的测试用的契约条目查询。 |

## 测试（门禁的闭环）

- **`index.test.ts`** — 检查器自身的行为（各类 problem 的产出）。
- **`kits.test.ts`** — 用**两个真实 kit 的 manifest**（`@BBeBee/ui-kit-desktop/manifest`、`@BBeBee/ui-kit-mobile/manifest`）断言：目标标识正确、`checkParity` 无问题、两端导出名集合等于契约、**逐组件 props 排序后完全一致**——专防"一端悄悄长出多一个 prop"这种代价最大、暴露最少的漂移。

## 导出

```ts
export interface PropSpec / ComponentSpec / ParityProblem / ParityInput
export type KitExports / KitPropMap
export const COMPONENT_CONTRACT, COMPONENT_NAMES
export function checkParity, formatProblems, specFor, requiredProps
```

## 相关文档

- `docs/08-ui-architecture.md` §6、`docs/11-roadmap-M1.md` §4.11
- `packages/ui/ui-kit-desktop/manifest.ts`、`packages/ui/ui-kit-mobile/manifest.ts`：被本包消费的两份声明
