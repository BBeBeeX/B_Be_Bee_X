# @BBeBee/ui-tokens

Layer 5（ui）— 设计系统即纯数据（the design system as plain data）。

## 概述

**是值，不是组件**，任何地方都不引入框架——这是两个不共享组件代码的视图层最终看起来像一个产品的唯一办法（docs/08 §6）。`ui-kit-mobile` 把它们当作 `StyleSheet` 值消费；`ui-kit-desktop` 把它们输出为 CSS 自定义属性。

调色板**按 scheme 定义**，而不是一套颜色加一个 dark 覆盖：暗色主题不是把亮色的明度翻转——对比关系不同，把 dark 表达成补丁正是调色板在两种模式之一里变得不可读而无人察觉的方式。

## 源文件

### `src/color.ts` — 调色板的色彩数学

对比度在这里算而不是靠眼睛："在我显示器上看着行"就是调色板在阳光下或对相当一部分用户不可读的方式。docs/08 §8 把 WCAG AA 定为 CI 门禁，门禁需要函数。纯数据进、纯数字出。

| 导出 | 作用 |
|---|---|
| `parseHex(hex)` | 解析 `#rgb`/`#rrggbb`/`#rrggbbaa`（alpha 被解析但对对比度忽略）；非法输入抛错 |
| `luminance(color)` | WCAG 2.1 相对亮度。sRGB→linear 那步是容易跳过、跳过就错的部分：对通道取朴素平均会把"白底灰字"误报为通过 |
| `contrastRatio(a, b)` | WCAG 对比度，1（相同）到 21（黑对白） |
| `AA_TEXT = 4.5` / `AA_LARGE = 3` | WCAG AA 阈值：正文 4.5，大字与 UI 边界 3 |
| `meetsAA(a, b, large?)` | 先把比值四舍五入到两位再比较——4.4996 在设计师用的每个工具里都显示为 4.5，不这样会产生争论而不是修复 |

### `src/index.ts` — tokens、调色板与检查

**`Palette`**（五个组）：`bg`（base/raised/overlay）、`text`（primary/secondary/disabled）、`accent`（base/hover/muted/on）、`state`（error/warn/ok）、`border`（subtle 分隔表面、装饰性；strong 勾勒控件或画焦点环，被 WCAG 1.4.11 的 3:1 约束并纳入检查）。

**`palettes: Record<Scheme, Palette>`** — `dark` 先行（音乐播放器的默认使用模式），`light` 次之。每个前景色都清 WCAG AA；`paletteContrastIssues()` 是证明，parity 测试是每次变更时跑它的机制。

**`tokens`** — 一切非颜色，全部是**刻度而非自由值**（"不在刻度上的间距是做了两次的决定，而第二次不会对上"）：

| 刻度 | 值 |
|---|---|
| `space[0..8]` | 0, 4, 8, 12, 16, 24, 32, 48, 64 |
| `radius` | sm 4 / md 8 / lg 16 / pill 999 |
| `font.family` | `ui`（Inter/系统栈）、`mono`（JetBrains Mono 栈） |
| `font.size` | xs 11 / sm 13 / md 15 / lg 20 / xl 28 / display 40（移动端相对化，尊重 OS 文字大小设置，docs/08 §8） |
| `font.weight` / `lineHeight` | 400/500/700；tight 1.2 / normal 1.45 / loose 1.7 |
| `duration` | fast 120 / normal 200 / slow 320 |
| `size` | touchTarget 44（两个 OS 都认可的最小可靠点击目标）/ icon 20 / iconLarge 28 / row 56 / artworkThumb 48 |
| `z` | base 0 / sticky 10 / overlay 100 / toast 1000 |

**`paletteContrastIssues(): ContrastIssue[]`** — 设计实际使用的每一对前景/背景及其最低要求，**枚举而非推导**：只有设计知道 `text.secondary` 用在 `bg.raised` 上、从不用在 `accent.base` 上，组合式检查会在没人放在一起的配对上误报。返回失败列表而非布尔值，CI 消息能点名配对与实际比值——"contrast failed" 只会让人去手动 diff。`border.strong` 按 UI 边界适用 3:1 而非 4.5。

**`cssVariables(scheme)`** — 把调色板与 tokens 展开成 `--bb-*` CSS 自定义属性，供 desktop kit/shell 换肤。

## 导出

```ts
export type Scheme = 'light' | 'dark'
export interface Palette / ContrastIssue / Rgb
export const palettes, tokens            // Tokens = typeof tokens
export function paletteContrastIssues, cssVariables
export function parseHex, luminance, contrastRatio, meetsAA
export const AA_TEXT, AA_LARGE
```

## 测试

`src/index.test.ts`：对两个 scheme 跑 `paletteContrastIssues()` 断言为空（AA 门禁本体）、色彩数学的边界行为。

## 相关文档

- `docs/08-ui-architecture.md` §6/§8：tokens、WCAG AA 门禁
- `packages/ui/ui-parity/README.md`：消费本包做对比度检查的门禁
