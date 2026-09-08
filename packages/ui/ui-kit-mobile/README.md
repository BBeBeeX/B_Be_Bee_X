# @BBeBee/ui-kit-mobile

Layer 5（ui）— React Native 版对等组件集（parity component set）的移动半边。

## 概述

与 `ui-kit-desktop` 互为孪生：同名组件、同套 props、同一份 tokens。**不是插件**，被 `plugin-*-ui-mobile` 视图包与 `apps/mobile` 消费。

**核心设计——`react-native` 被注入而非导入**：RN 一旦被导入就拉入原生模块，本包只能在设备上做类型检查/单测——"只在一端跑的检查约等于没有检查"。所以 kit 定义 `NativePrimitives` 接口，shell（`apps/mobile`）启动时调一次 `configureNative()` 注入真实模块；测试注入假原语。运行时依赖只有 `react`；`react-native` 在 devDependencies（仅供类型）。安全区（safe-area）**不在这里**——按仓库规则属宿主 shell 的平台 chrome。

## 源文件

### `src/index.tsx` — 11 个对等组件 + 原语注入

组件与 props 与桌面半边一一对应（契约见 `ui-core/props.ts` 与 `ui-parity/contract.ts`）；`testID`/`accessibilityLabel` 直接映射为 RN 拼写。各组件的移动端要点：

| 组件 | 移动端实现要点 |
|---|---|
| `Button` | `Pressable` + `accessibilityRole="button"` + `accessibilityState={disabled, busy}`；loading 渲染 `ActivityIndicator`（颜色同 label）而非文案；disabled 时 `onPress` 置 undefined（不触发）。 |
| `IconButton` | `Pressable`；size=8 时 `width` 仍是 44（tap target 测试 pin 住）。 |
| `TextField` | `TextInput`；`autoCorrect: false` + `autoCapitalize: 'none'` 默认关（规则/URL 对大小写拼写敏感，自动改写让源失败且无解释）；`secureTextEntry`；multiline 最小高度按 `fontSize×1.5×rows` 增长、单行 ≥44 可点；error 渲染为内容。 |
| `Text` | RN `Text`，`numberOfLines` 原生截断；**`allowFontScaling: true`**——OS 文字大小设置被尊重，200% 缩放因此是布局问题而非裁切问题；`lineHeight = size × 1.45`。 |
| `Artwork` | `Image resizeMode="cover"`；`dominantColor` 先行作背景；无 uri 无 `Image`。 |
| `TrackRow` | `Pressable`；`onMore` 绑**长按**（`onLongPress`——桌面是右键）；active 时标题 tone 切 `'accent'`。 |
| `Slider` | **整个 kit 里唯一有状态的组件**（唯一有专属测试文件的组件）。用 RN 自带 **responder 系统**实现拖拽，刻意不用 `react-native-gesture-handler`（原生模块，与 `configureNative` 的存在意义相悖）：轨道宽度来自 `onLayout`（`measure()` 是异步的）；`onResponderGrant/Move` → dragging + `onChange`、`onResponderRelease` → commit；`at()` 把 `locationX/width` 钳到 [0,1] 再乘 max；**`onResponderTerminationRequest: () => false` + terminate 时拇指归位 `props.value`**——来电/父级滚动抢走拖拽时不能搁浅在手指最后的位置；无障碍 `accessibilityRole="adjustable"` + `accessibilityValue`，increment/decrement **按量程 5% 步进**并 onChange+onCommit（"宣告可调却 seek 到原地"是坏控件）；disabled 拒绝 responder 与 accessibility action。 |
| `Sheet` | RN `Modal`（transparent + slide）；**`onRequestClose={onClose}`——Android 返回键必须能关掉它，否则 sheet 就是陷阱**；backdrop `Pressable` 关闭、内容区空 onPress 拦截；贴底、上圆角。 |
| `List<T>` | 包装 **FlashList**（注入）：回收行视图而非逐行 mount，低端 Android 也可滚动；`onEndReachedThreshold: 0.5`；`empty` → `ListEmptyComponent`；**刻意不转发 `estimatedItemSize`**——FlashList v2 自测行高并删除了该 prop，传了等于假装给提示（prop 留在共享契约里因为桌面虚拟化器真的需要：一个 prop 被一端忽略，比两份契约便宜）。`data`/`keyExtractor` 原样传递（稳定 keys，否则每次滚动重挂载）。 |
| `EmptyState` / `Toast` | 与桌面几乎逐字相同；Toast 用 `accessibilityLiveRegion="polite"` + `accessibilityRole="alert"` 播报。 |

**kit 级导出**：

- `NativePrimitives` — 刻意最小集合：`View, Text, Pressable, Image, Modal, FlashList, ActivityIndicator, TextInput`。每加一个都是"shell 要提供 + 测试要造假"的决定。
- `configureNative(primitives)` — shell boot 时调一次。
- `nativePrimitives()` — 当前原语；未配置时返回 `PLACEHOLDER`——渲染同名宿主元素而非抛错：**忘配置的 shell 得到一眼可见的错误画面，而不是渲染期里没人能读懂的崩溃**。
- `setScheme(next)` — 与桌面同语义。

### `src/manifest.ts` — parity 声明

`KIT_TARGET = 'mobile'` + `COMPONENT_PROPS` + `COMPONENT_EXPORTS`，与桌面 manifest **逐字同构**。它必须是数据的原因比桌面更硬：本包**根本无法在设备外导入**，若 parity gate 需要真实模块就永远只能对一端运行——约等于没有 gate。清单化后 `ui-parity` 在 CI 里无需 React、DOM 或 RN 即可检查。

## 测试

- **`index.test.tsx`**（无 DOM）：假原语（`'RNView'` 等字符串宿主）经 `configureNative` 注入，把组件当函数调用一层、递归展平结果断言 props。覆盖：注入与 PLACEHOLDER、Button 的 busy/disabled、IconButton 44px、TrackRow 长按、Sheet 的 `onRequestClose`、List 走 FlashList 且不转发 `estimatedItemSize`、TextField 受控 + autoCorrect 关、Toast liveRegion 等。
- **`slider.test.tsx`**（jsdom + RTL 行为断言）：渲染器用 React DOM——可行正因为原语是注入的：假原语是渲染 `div` 并挂上 RN props 的普通组件，测试像平台一样手动触发 `onResponderMove`。断言的行为：不除以零时长（`max: 0` 常态）；release 落点即 commit（M1 移动端退出准则 2——"否则 scrubber 只是一张 scrubber 的图片"）；拖动中 `onChange` 逐帧上报而 `onCommit` **恰好一次**；拇指跟手而非弹回旧值；钳制在量程内；OS 抢走拖拽时归位；读屏步进 ±5%；disabled 全忽略。测试覆盖不了的是"responder 系统是否把触摸授予这个组件"——那是平台职责、归设备 smoke matrix。

## 相关文档

- `docs/08-ui-architecture.md` §6/§8
- `packages/ui/ui-kit-desktop/README.md`：孪生半边与桌面特有行为
- `apps/mobile/`：`configureNative` 的调用方
