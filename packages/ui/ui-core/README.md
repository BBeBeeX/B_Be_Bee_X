# @BBeBee/ui-core

Layer 5（ui）— 服务与 React 之间的接缝。

## 概述

只依赖 `react` 与 `@BBeBee/protocol`（再无其他），因此两个 kit 建在同一批 hooks 上，feature 的**状态**逻辑只写一次、像素写两次（docs/08 §4）。

本层存在的意义是执行一条规则：**React 不持有领域状态。** 服务拥有它，组件订阅它。这里任何开始长得像 reducer 的东西都属于服务。

## 源文件

### `src/index.ts` — 服务读取与订阅 hooks

| 导出 | 作用 |
|---|---|
| `serviceOf<T>(ctx, key): T \| undefined` | 从 context 读服务，未加载时返回 `undefined`——`undefined` 是正常状态而非错误（插件可被禁用、服务可能不在本平台），渲染占位符才是 docs/08 §3 要求的行为。⚠️ **`ctx[key]` 不是正确的问法**：在插件级 context（视图唯一会拿到的种类）上，cordis 的代理对任何未注入属性都会**抛错**，连 `ctx.player?.x` 都来不及短路——"tests 答 undefined、设备上抛错"的著名 bug 根源。`reflect.get(key, false)`（"非必需"读取）在 root 与 scoped context 上都有答案。 |
| `useService<T>(ctx, key)` | `serviceOf` 的 hook 形式；缺席时经 `useDebugValue` 在 devtools 里显示 `key (absent)`。 |
| `useServiceState<T>(ctx, events, select, options?)` | 订阅服务状态（`useSyncExternalStore` 封装）。要点：store 经 `useMemo` 存活于重渲染之间（否则每次渲染重订阅、防循环的缓存被丢弃）；**`select` 刻意不进依赖**——它几乎在每个调用点都是内联的，进依赖会每次渲染重建 store；`deps` 是调用方声明"选择本身变了"的方式。`select` 每次通知和每次渲染都会跑，必须便宜；**不要求引用稳定**——store 会缓存并比较（见 `store.ts`）。 |
| `AsyncState<T>` / `isReady` | `{ status: 'idle'\|'loading'\|'ready'\|'error', data?, error? }`。刻意**不是**数据获取库：它存在的意义是让视图不必为 loading/failure 自造 `useEffect`——docs/08 §4 禁止在领域工作里使用它。 |

### `src/props.ts` — 两个 kit 共同的 props 契约（types only）

写一次、写在契约层，让 desktop 的 `Button` 与 mobile 的 `Button` 不可能漂移成不同形状——那种漂移会让每个插件作者付两次钱、付到永远。**纯类型**：不 import React、不 import 平台，两个 kit 与 parity gate 都能读。

- **`CommonProps`** — 每个组件都有，调用方永远不必问哪些有：`testID?`（两端一个名字，各 kit 映射到自己的属性）与 `accessibilityLabel?`（docs/08 §8 强制每个可交互元素有可访问名，逐组件决策必然被遗忘——所以写在这里一处）。
- 组件 props 类型逐一列出：`ButtonProps`（`onPress` 而非 `onClick`——一个名字跨两个 kit，tap 不是 click；`loading` 同时表示进度**并禁用**，两个 prop 会漂移一个不会）、`IconButtonProps`（`accessibilityLabel` **必填**——图标没有文字可回退）、`TrackRowProps`（`active` = **正在播放**，不等于选中；`onMore` 桌面绑右键、移动绑长按）、`SliderProps`（**`onChange` 与 `onCommit` 分离**——拖动的每一帧都 seek 是 scrubber 不可用的原因）、`SheetProps`、`ListProps<T>`（`keyExtractor` 必填——10 万曲库需要稳定 keys；`estimatedItemSize` 桌面虚拟化器需要、FlashList 自测并忽略，"一个 prop 被一端忽略比两份契约便宜"）、`EmptyStateProps`、`ToastProps`、`TextProps`（`variant` 只收刻度名，**裸像素永不传入**）、`TextFieldProps`（**两端都受控**——一端非受控一端受控正是 parity gate 要防的分歧；`multiline` 存在的理由是用户会粘贴几百行 JSON 的源文档；`autoCorrect` 默认关——规则被静默纠错会无解释地失败）、`ArtworkProps`。
- 联合类型：`Tone`、`TextVariant`、`ButtonVariant`。

### `src/store.ts` — 服务状态作为外部 store

`useSyncExternalStore` 需要 `subscribe` 与 `getSnapshot`，两者的规则都容易错、错了很难看见。在 React 之外建它们才使规则可测：hook 需要渲染器，store 什么都不需要。

| 导出 | 作用 |
|---|---|
| `createServiceStore(ctx, events, select, options?)` | 一个服务的 store，由一组事件使失效。核心：**快照被缓存、只在选择真正变化时替换**——返回新对象/新数组的 selector 在这里安全，直通 `useSyncExternalStore` 则会死循环（"应用很慢"而非报错）。`subscribe` 里事件回调**先 `read()` 再 `onChange()`**：React 在通知后立即调 `getSnapshot`，那里读到陈旧值就是落后一拍的渲染。 |
| `shallowArrayEqual(a, b)` | 按元素身份比较数组。列表 selector 的常见情形：队列每次 `queue/changed` 都是新数组但元素相同，因包装变了重渲染 5000 行列表就是滚动卡顿。 |
| `shallowEqual(a, b)` | 一层深的对象比较，给构建小 record 的 selector。 |

## 测试

`src/store.test.ts`：store 的缓存/失效行为、两种比较器的语义——不需要渲染器。

## 相关文档

- `docs/08-ui-architecture.md` §3/§4：视图模型与 hooks 规则
- `packages/feature/plugin-player/README.md`、`packages/feature/plugin-sources/README.md`：消费这些 hooks 的 feature hooks
