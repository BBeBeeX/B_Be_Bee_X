# 09 —— 项目结构

> **本篇回答什么。** Monorepo 的布局、以机械方式强制执行的依赖规则、每个目标如何构建、锁定的版本矩阵，以及防止平台抽象腐化的测试策略。

---

## 1. 仓库布局

**文件系统就是分层模型。** 每个包都位于 `packages/<layer>/<package>`，而层目录绝非装饰：它正是 [`eslint.config.js`](#3-依赖规则) 划定规则的依据。一个包由*它住在哪*来治理，因此在层与层之间移动一个包，就是一次 `git mv`，并在同一个提交里改变它的规则。

```
packages/protocol/    Layer 0 —— 契约，零运行时
packages/kernel/      Layer 1 —— 基础设施 + 系统抽象
packages/core/        Layer 2 —— 核心能力服务
packages/logs/        Layer 3 —— 日志传输层
packages/feature/     Layer 4 —— 业务功能模块
packages/ui/          Layer 5 —— 视图与共享 UI 基础设施
packages/tooling/     模型之外 —— 这里的任何东西都不随包发布
```

每个包都在同一深度，因此 `packages/*/*` 一个 glob 就覆盖了整个工作区，每个包的 `tsconfig.json` 也以同一个 `../../../` 抵达基础配置。`apps/` 同属 Layer 5，但它们留在读者预期找到它们的地方。

> ⚠️ **`packages/*/*` 并不完全等于整个工作区，而且这个例外咬过人。** 两个单包层是 `packages/protocol/src` 与 `packages/kernel/src`，比其他所有东西浅一层 —— 于是为深形状写的 glob 会悄无声息地漏掉它们。`vitest.config.ts` 曾经只带着深形状，随之丢掉的是 Layer 0 与 Layer 1 的每一个测试：`layers.test.ts`、`conventions.test.ts`、`shells.test.ts` 与 `cordis-assumptions.test.ts` 都没有被收集，而一套关掉了架构自身守卫的测试跑起来，与开着守卫的运行报告成功的方式一模一样。任何以 glob 扫包的工具都需要同时携带两种形状。

以层的*职责*而非编号来命名目录，带来两个后果。各层不再按自己的顺序排序 —— 字母序是 `core`、`feature`、`kernel`、`protocol`、`ui`，上表就是需要记住的那张映射。而两个单包层读起来是叠词，`packages/protocol` 与 `packages/kernel`，这是每个包都坐在同一深度所付出的代价；另一种做法恰恰要对最可能迎来第二个包的那两层做特判。

`✅` = 已建成并通过 `pnpm check`。没有它的都是已设计但尚未写出的东西。

```
B_Be_Bee/
│
├── apps/                                   🔹 LAYER 5 —— 应用外壳
│   ├── mobile/                     ✅        Expo app
│   │   ├── src/boot.ts                        组合根：注册 core-*-expo (02 §1)
│   │   ├── src/plugins.ts                     允许清单，以数据形式存在 —— 什么都不导入
│   │   ├── src/App.tsx                        挂载在 ctx.inject(['ui'], …) 之内
│   │   ├── generated/plugins.ts               代码生成：静态插件导入 (03 §6.1)
│   │   ├── app.json · index.js                Expo 入口 + 配置
│   │   ├── metro.config.js                    package exports + watchFolders (§4)
│   │   ├── babel.config.js
│   │   └── android/ · ios/                    dev-client 原生工程
│   └── desktop/                    ✅        Electron app
│       ├── main/                              仅 IPC 宿主，不含领域逻辑 (02 §2)
│       ├── preload/                           contextBridge 暴露面
│       ├── renderer/                          React DOM 外壳 + 内核 (ADR-3)
│       │   ├── boot.ts · plugins.ts             组合根 + 允许清单
│       │   └── main.tsx · Shell.tsx             挂载 + 窗口装饰
│       └── electron.vite.config.ts
│
├── packages/
│   │
│   ├── protocol/                    🔹 LAYER 0 —— 契约层
│   │       │                                 @BBeBee/protocol。零运行时依赖、无副作用、
│   │       └── src/                          不触碰平台 —— 这正是它可以从任何层安全导入
│   │           │                             的原因，也是每一层都被 mock 的那条接缝
│   │           ├── services/                 fs · http · db · secrets · audio · player ·
│   │           │                             sources · ui · … (04)
│   │           ├── entities/                 Track, Album, StreamHandle, TransportState … (07)
│   │           ├── events.ts                 类型化事件表 (07 §5)
│   │           ├── errors.ts · frac-index.ts 那点配得上其存在的小型纯运行时
│   │           └── conformance/              共享契约套件：一份测试文件，对着一个键的
│   │                                         两份实现都运行 (04 §18)
│   │
│   ├── kernel/                      🔹 LAYER 1 —— 基础设施 + 系统抽象
│   │       │                                 @BBeBee/kernel。只依赖 protocol 与 cordis，
│   │       └── src/                          工作区里别的什么都不依赖 —— 一个知道
│   │           │                             哪些插件存在的内核就不是内核
│   │           ├── index.ts                  两个表面，可得性并不对等：锁定的 Cordis
│   │           │                             再导出对所有层开放，其下的引导表面只有
│   │           │                             Layer 2 与组合根可用 (02 §1)
│   │           │                             ── 按关注点划分，测试与主体同置：
│   │           ├── bootstrap/                createApp、启动顺序、落定、外壳接线
│   │           ├── config/                   解析、启用/禁用、默认值
│   │           ├── loader/                   注册表 → ctx.plugin()，fiber 状态上报
│   │           ├── capability-gate/          作用域划分与 SQL 守卫 (03 §7)。sql.ts 与
│   │           │                             apps/desktop/main 共享，因此一份允许清单
│   │           │                             同时覆盖被闸的路径与 IPC 宿主
│   │           ├── migrations/               核心 schema 迁移 (07 §6)
│   │           │                             ── 以及不属于任何单一关注点的：
│   │           ├── fiber-state.ts            上游无法导出的 FiberState 镜像
│   │           ├── testing.ts                @BBeBee/kernel/testing —— snapshotContext (§6)
│   │           └── *.test.ts                 conventions · layers · cordis-assumptions：
│   │                                         它们扫描的是工作区，不是内核
│   │
│   ├── core/                        🔹 LAYER 2 —— 核心能力服务
│   │   │                                      唯一获准导入平台 SDK 的包，也是唯一获准
│   │   │                                      驱动内核的包。每个键每个目标一份实现；
│   │   │                                      不含领域知识 —— 它们没有一个知道曲目是什么。
│   │   ├── core-paths-node/        ✅        ctx.paths
│   │   ├── core-paths-expo/        ✅
│   │   ├── core-fs-node/           ✅        ctx.fs —— 虚拟文件系统 (04 §1)
│   │   ├── core-fs-expo/           ✅
│   │   ├── core-db-node/           ✅        ctx.db —— node:sqlite / expo-sqlite (04 §3)
│   │   ├── core-db-expo/           ✅
│   │   ├── core-store-fs/          ✅        ctx.store —— 单一实现，经 ctx.fs (04 §4)
│   │   ├── core-http-node/         ✅        ctx.http —— 传输层是一条接缝：桌面端用
│   │   ├── core-http-rn/           ✅          Electron 的 net 填上，移动端用 expo/fetch
│   │   ├── core-secrets-node/      ✅        ctx.secrets。⚠️ 名字带 -node 却不分平台：它
│   │   │                                       经由 ctx.fs 持久化，因此在 Electron
│   │   │                                       被沙箱化的渲染进程里也能加载
│   │   ├── core-secrets-expo/      ✅
│   │   ├── core-device-electron/   ✅        ctx.device —— 网络、电量、媒体键
│   │   ├── core-device-expo/       ✅
│   │   ├── core-background-electron/ ✅      ctx.background —— wake lock、挂起
│   │   ├── core-background-expo/   ✅
│   │   ├── core-media-session-electron/ ✅   ctx.mediaSession —— OS 的"正在播放"表面
│   │   ├── core-media-session-rn/  ✅
│   │   ├── core-codec-node/        ✅        ctx.codec —— 标签：经 ctx.fs 用
│   │   ├── core-codec-rn/          ✅          music-metadata 读取；-rn 再加上设备的解码器
│   │   ├── core-audio-webaudio/    ✅        ctx.audio —— 两个平台都用 react-native-audio-api (05 §1)
│   │   ├── core-js-quickjs-node/   ✅        ctx.js —— 音源沙箱 (04 §19)
│   │   ├── core-js-quickjs-expo/             ⚠️ 唯一的 M2 缺口：Hermes 没有 WASM
│   │   ├── core-desktop-bridge/    ✅        renderer↔main IPC 客户端 + main 侧宿主。
│   │   │                                       进程边界两侧都是 Layer 2
│   │   └── core-…                            ctx.ws · ctx.notify · ctx.crypto · ctx.shell
│   │
│   ├── logs/                        🔹 LAYER 3 —— 日志传输层
│   │   │                                      Cordis exporters，跨平台共享，决定一行日志
│   │   │                                      最终落在哪。唯一获准写控制台的层；它之上的
│   │   │                                      一切都经 ctx.logger 记日志 (04 §16)。从各外壳
│   │   │                                      的引导数组加载，因此在第一个功能插件启动
│   │   │                                      之前它们就已经在运行。
│   │   ├── plugin-log-buffer/       ✅        ctx.logBuffer —— 日志查看器读取的那个环
│   │   ├── plugin-log-console/      ✅        仅开发用：带作用域前缀的 console.*
│   │   ├── plugin-log-file/         ✅        仅随包发布的构建：经 ctx.fs 的轮转 NDJSON
│   │   └── plugin-log-crash/                 用户可附在报告里的崩溃包
│   │
│   ├── feature/                     🔹 LAYER 4 —— 业务功能模块
│   │   │                                      每包一项业务能力，无 UI：状态、持久化、
│   │   │                                      网络、事件。只导入 @BBeBee/protocol 与内核
│   │   │                                      的插件表面 —— 绝不导入平台 SDK，绝不导入
│   │   │                                      core-* 包（Layer 2 依赖写作 `inject: ['fs']`），
│   │   │                                      也绝不导入传输层（日志是 `ctx.logger`）。
│   │   ├── source-rules/           ✅        规则语言作为纯逻辑：无 Cordis、无平台、
│   │   │                                       无 I/O (06 §3)。parse.ts 是解析器，
│   │   │                                       evaluate.ts 是引擎及其类型强转，
│   │   │                                       jsonpath.ts · template.ts 是两种方言，
│   │   │                                       regex-guard.ts 是 ReDoS 上界
│   │   ├── plugin-source-runtime/  ✅        把 source-rules 绑定到 ctx.http · ctx.js (06 §4)
│   │   ├── plugin-sources/         ✅        ctx.sources 注册表 + 目录 (06 §4.1)
│   │   ├── plugin-source-local/    ✅        唯一不是字符串的提供方 (06 §12)
│   │   ├── plugin-local-scanner/   ✅        ctx.scanner —— ≥5,000 文件的语料遍历
│   │   ├── plugin-player/          ✅        ctx.player —— 传输、队列、历史 (05 §2)
│   │   ├── plugin-ui/              ✅        ctx.ui 贡献注册表 —— 只有描述符，
│   │   │                                       因此它不持有任何 React (08 §2)
│   │   ├── plugin-inspector/       ✅        fiber 树 + 带标注的 effect (M0 完成标准)
│   │   ├── plugin-dsp/                       ctx.dsp —— 效果链 (05 §3)
│   │   ├── plugin-effect-eq10/               一个 DSP 效果，作为一个插件
│   │   ├── plugin-download/                  media_bindings + before-resolve 替换
│   │   ├── plugin-library/                   播放列表、收藏、智能列表
│   │   ├── plugin-lyrics/                    歌词提供方
│   │   ├── plugin-cache/                     http/request 缓存层
│   │   └── plugin-…
│   │
│   ├── ui/                          🔹 LAYER 5 —— 视图与 UI 基础设施
│   │   │                                      布局、手势、事件接线，以及把一次用户意图
│   │   │                                      编排为一串功能调用的部分。任何你会因此写
│   │   │                                      两遍的东西都属于无 UI 的兄弟包，视图包只为
│   │   │                                      TYPES 而导入它。
│   │   ├── ui-tokens/              ✅        以纯数据形式存在的设计令牌 + WCAG AA 闸门 (08 §8)
│   │   ├── ui-core/                ✅        框架无关的钩子 + 共享 prop 类型
│   │   ├── ui-parity/              ✅        组件契约，以及检查两套组件库
│   │   │                                       是否满足它的测试 (08 §6)
│   │   ├── ui-kit-mobile/          ✅        React Native 组件
│   │   ├── ui-kit-desktop/         ✅        React DOM 组件
│   │   ├── plugin-player-ui-desktop/ ✅      ┐ 正在播放、播放控制、队列
│   │   ├── plugin-player-ui-mobile/  ✅      ┘
│   │   ├── plugin-sources-ui-desktop/ ✅     ┐ 曲库、专辑详情、音源列表、导入
│   │   ├── plugin-sources-ui-mobile/  ✅     ┘ 审查、编辑器、规则追踪器 (08 §4)
│   │   ├── plugin-local-scanner-ui-desktop/ ✅ ┐ 设置：扫描根目录
│   │   ├── plugin-local-scanner-ui-mobile/  ✅ ┘
│   │   └── plugin-inspector-ui-desktop/ ✅   渲染出来的 fiber 树
│   │
│   └── tooling/                            🔧 分层模型之外
│       │                                      开发辅助。这里没有任何东西进入应用
│       │                                      bundle，这正是层规则不约束它们的原因。
│       ├── tooling-gen-plugins/    ✅        静态注册表代码生成 (pnpm gen:plugins)
│       ├── tooling-create-plugin/  ✅        脚手架 (pnpm new:plugin)
│       └── tooling-fixtures/       ✅        ≥5,000 文件的语料库生成器、一台带插桩的
│                                             ctx.fs，以及契约套件运行所在的
│                                             按字节服务的 http fixture
│
├── fixtures/sources/                         示例音源文档；黄金语料库 (§6)
├── test/stubs/                               Node 无法加载的三个原生模块，由
│                                             vitest.config.ts 别名：react-native-audio-api
│                                             对任何真正原生的东西抛错，expo-sqlite 与
│                                             expo-file-system 则真的能用 (§6)
├── docs/                                     这套文档
├── eslint.config.js                          flat config；层规则都定义在这里 (§3)
├── tsconfig.base.json                        每个包的 tsconfig 都扩展它
├── vitest.config.ts · vitest.global.ts       别名 + 每次运行在下面分配的暂存根目录
├── pnpm-workspace.yaml · .npmrc
└── package.json                              根脚本：check、gen:plugins、new:plugin
```

### 为什么层是一个目录

另一种做法 —— 扁平的 `packages/`，由*前缀*承载层信息 —— 是本仓库在分层模型被强制执行之前的形态，它也能用。它做不到的是让层变得**结构化**。目录成为分组方式之后，有三件事变了：

- **lint 规则认位置，不认拼写。** `packages/core/**` 就是获准触碰平台 SDK 的那组包，成员资格是关于文件系统的事实，而不是一种可能被一个名叫 `plugin-fs-helper` 的包悄悄蒙混过去命名约定。
- **层的变更就是一次移动。** 把一个功能插件提升为核心服务，是 `git mv packages/feature/x packages/core/x`，它的规则随之改变，在同一个提交里、在评审中清晰可见。
- **新包必须做出选择。** 脚手架写进 `feature/` 或 `ui/`（[§7](#7-开发工作流)），于是"这个包属于哪一层？"在创建时就被回答，而不是日后从它最终导入了什么来推断。

代价是到处多出一个路径段 —— 在 `pnpm-workspace.yaml` 里、在每个包的 `extends` 里、以及在扫描工作区的测试里，后者现在靠扫描 `packages/*/*` 来定位一个包，而不是把名字拼到 `packages/` 后面。这笔代价只付一次，而且在这个布局落地时就已付清。扫描器拿目录列表当事实来源，而不是一份写死的清单，因此层目录可以改名 —— 事实上就从 `layerN-*` 改成了裸名 —— 而不必触碰它们。

嵌套在包*内部*也物有所值，它区分开那些读者真正会混淆的东西：`protocol` 的 `src/services/` 与 `src/entities/`，以及 `kernel` 里的各关注点目录 —— `bootstrap/`、`config/`、`loader/`、`capability-gate/`、`migrations/`。内核是唯一一个干着五件互不相关工作的包，每个目录都把自己的测试放在旁边。

### 命名

**目录**决定层，进而决定一个包获准导入什么。**前缀**仍然说明它是什么类型的东西，二者按构造方式保持一致 —— 出现在 `feature/` 里的 `core-` 包，是读者一眼能看出的错误。

| 目录 | 层 | 持有的前缀 |
|---|---|---|
| `protocol/` | 0 | `protocol` —— 契约。仅一个包，无运行时 |
| `kernel/` | 1 | `kernel` —— 仅一个包 |
| `core/` | 2 | `core-<service>-<platform>` —— 某项核心服务的平台实现 |
| `feature/` | 3 | 无 UI 的 `plugin-<feature>`、DSP 效果用的 `plugin-effect-<id>`，以及 `source-rules` —— 它是源运行时之下的纯逻辑，不是插件 |
| `ui/` | 4 | 视图用的 `plugin-<feature>-ui-<target>`，两套组件库共享基础设施用的 `ui-*` |
| `tooling/` | — | `tooling-*`。在分层模型之外，因为这里的任何东西都不随包发布 |

如今刻意**不再有 `plugin-source-<protocol>` 前缀**。一个音乐后端是一份音源文档（[06](./06-music-sources.md)），不是一个包。名字里带 `source` 的只有两个包：解释文档的 `plugin-source-runtime`，以及没有 HTTP 可描述的 `plugin-source-local`（[06 §12](./06-music-sources.md#12-不是字符串的东西本地文件)）。本仓库随附的示例文档存放在 `fixtures/sources/`，而不在 `packages/` 里。

---

## 2. 包分层

与 [02 §1](./02-architecture.md#1-分层模型) 相同的六层，画成实际的 `package.json` 图。每个节点都标注了所属层，这里的每条边都是真实的 `dependencies` 条目 —— 服务键造成的运行时边被刻意略去，因为这是构建图。

```mermaid
flowchart TD
    apps["apps/* — L5 shells<br/>(boot.ts = composition root)"] --> uikit["ui-kit-mobile · ui-kit-desktop — L5"]
    apps --> kernel["@BBeBee/kernel — L1"]
    apps --> pluginui["plugin-*-ui-* — L5"]
    pluginui --> uikit
    pluginui --> uicore["ui-core — L5"]
    uikit --> uicore
    uikit --> tokens["ui-tokens — L5"]
    uicore --> protocol["@BBeBee/protocol — L0"]
    pluginui -.->|types only| headless["plugin-* (headless) — L4"]
    headless --> protocol
    logs["plugin-log-* — L3"] --> protocol
    core["core-* — L2"] --> protocol
    core --> kernel
    kernel --> protocol
    apps --> core
    apps --> logs
```

凡是不指向 `@BBeBee/protocol` 的箭头都只是便利。*指向* `protocol` 的箭头才是架构本身。

有几条边值得读上两遍，因为它们是分层模型加以*约束*而非*禁止*的对象：

- **`apps/* → @BBeBee/kernel` 与 `apps/* → core-*`** 只为组合根而存在 —— 每个外壳那一对 `boot.ts` / `plugins.ts`。`apps/*` 下的其余文件都是纯粹的 Layer 5，也被当作 Layer 5 来 lint（[§3](#3-依赖规则)）。
- **`apps/* → plugin-log-*`** 是出于同样理由的同一个例外。传输层是引导条目，不是注册表条目 —— 它们在核心服务之后、功能插件之前启动，这正是 Layer 3 的*含义* —— 而只有组合根获准以导入的方式点名一个插件。仓库里没有其他任何东西导入传输层；一切都经 `ctx.logger` 记日志（[04 §16](./04-core-services.md)）。
- **`core-* → @BBeBee/kernel`** 是唯一一处由包（而非外壳）导入引导表面的地方：`core-db-*` 运行核心迁移，并为能力门划分 context 作用域。这正是 Layer 2 在履行其适配层职责。

没有任何 `plugin-* → core-*` 的边，这是刻意的；也没有任何 `plugin-* → plugin-log-*` 的边。一旦出现这样的边，分层模型就被破坏了，`pnpm lint` 会指出来 —— 背后还有 `layers.test.ts`，因为一条匹配不到任何东西的 lint 模式什么也禁止不了，读起来却与一条正常工作的模式一模一样。

---

## 3. 依赖规则

[02 §1](./02-architecture.md#1-分层模型) 的分层模型价值几何，完全取决于它的执行力度，因此它由 ESLint 按路径限定 `overrides` 来机械执行，而不是靠评审把关。由于 [§1](#1-仓库布局) 把每个包都放进了它的层目录，这些路径*就是*层：`packages/core/**` 不是一厢情愿匹配对包的命名约定，它恰恰就是 Layer 2 里那组包。下面每条规则都声明了自己守护的是哪一层边界。这是对 `eslint.config.js` 的节选读法 —— 文件本身才是权威。

```js
// eslint.config.js — the rules that matter
const PLATFORM_SDKS = [
  'expo', 'expo-*', 'expo/*', 'react-native', 'react-native/*', 'react-native-*',
  'electron', 'electron/*', 'node:*', 'fs', 'fs/promises', 'path', 'os', 'crypto',
  'child_process', 'better-sqlite3', 'music-metadata', 'ws',
]

// 02 §1 — the kernel's plugin surface: the pinned Cordis re-exports, which
// only *type* a plugin. An allow-list rather than a ban-list on the bootstrap
// surface, so a new kernel export is closed to Layers 3, 4 and 5 by default.
const KERNEL_PLUGIN_SURFACE = [
  'Context', 'Service', 'Inject', 'FiberState', 'fiberStateName', 'isActive', 'isSettled',
  'Plugin', 'Fiber', 'Effect', 'EffectMeta', 'InjectSpec', 'FiberStateName', 'FiberStateValue',
]

const KERNEL_GUARD = {
  name: '@BBeBee/kernel',
  allowImportNames: KERNEL_PLUGIN_SURFACE,
  message: 'Layers 3, 4 and 5 may be typed by the kernel but may not drive it. See docs/02 §1.',
}

// Both forms: a gitignore-style `*` does not cross a `/`, so the bare name
// alone would let `@BBeBee/core-desktop-bridge/main` through.
const CORE_PACKAGES = ['@BBeBee/core-*', '@BBeBee/core-*/**']

// 04 §16 — Layer 3. Everything above it logs through `ctx.logger`, so nothing
// above it names a transport: an import pins one implementation into code
// whose point is not to know, and keeps it loaded for as long as the importer
// lives.
const LOG_PACKAGES = ['@BBeBee/plugin-log-*', '@BBeBee/plugin-log-*/**']

// The composition root: the only files that may call createApp and name a
// Layer 2 package by import. `apps/*/generated/plugins.ts` is codegen and is
// in the global `ignores`.
const COMPOSITION_ROOT = [
  'apps/mobile/src/boot.ts', 'apps/mobile/src/plugins.ts',
  'apps/desktop/renderer/boot.ts', 'apps/desktop/renderer/plugins.ts',
]

export default tseslint.config(
  {
    // 02 §1 — Layers 4 and 5, addressed by directory. Every invariant at once,
    // because ESLint *replaces* a rule's options rather than merging them:
    // every block covering a file has to restate the whole ban, or the
    // narrower block silently disables the wider one.
    files: ['packages/feature/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}',
            'packages/protocol/**/*.ts'],
    ignores: ['packages/ui/plugin-*-ui-*/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [KERNEL_GUARD],
        patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES, ...LOG_PACKAGES],
      }],
      // 04 §16 — the other half of the same rule. A line written straight to
      // the console skips the redactor and reaches neither the ring buffer nor
      // the log file, which are what a bug report carries.
      'no-console': 'error',
    },
  },
  {
    // 02 §1 — Layer 3 itself. Bound by THE invariant like everything above
    // core, and exempt from `no-console`, which is the layer's job: it is the
    // whole of plugin-log-console, and plugin-log-file's last resort when the
    // write it exists to perform is the thing that failed.
    //
    // The negated pair is load-bearing. An extglob (`plugin-!(log-)*`) parses,
    // matches nothing, and bans nothing while looking correct.
    files: ['packages/logs/**/*.ts'],
    ignores: ['packages/logs/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [KERNEL_GUARD],
        patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES,
                   '@BBeBee/plugin-*', '@BBeBee/plugin-*/**',
                   '!@BBeBee/plugin-log-*', '!@BBeBee/plugin-log-*/**',
                   '@BBeBee/ui-*', '@BBeBee/ui-*/**'],
      }],
    },
  },
  {
    // 02 §1 and 06 §3 — the rule engine is pure logic: no platform, no I/O,
    // and no Cordis. It takes a document and a string and returns a value;
    // every fetch belongs to plugin-source-runtime. Keeping it pure is what
    // makes the rule corpus in §6 runnable without a network, and it is the
    // Layer 4 entry in 02 §1's testability table.
    files: ['packages/feature/source-rules/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES, ...LOG_PACKAGES,
                   'cordis', '@BBeBee/kernel'],
      }],
    },
  },
  {
    // 08 §1 — Layer 5 view packages may render, but may not reach the
    // platform. `react-native` is allowed; its capability modules are not.
    files: ['packages/ui/plugin-*-ui-mobile/**/*.{ts,tsx}',
            'packages/ui/ui-kit-mobile/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [KERNEL_GUARD],
        patterns: [...PLATFORM_SDKS.filter((p) => !p.startsWith('react-native')),
                   ...CORE_PACKAGES, ...LOG_PACKAGES],
      }],
      'no-console': 'error',
    },
  },
  {
    // The desktop half. `react-dom` is not a platform SDK, so this one bans
    // the whole list — without it, the block above exempts every
    // `plugin-*-ui-*` package and only puts `-ui-mobile` back under a rule.
    files: ['packages/ui/plugin-*-ui-desktop/**/*.{ts,tsx}',
            'packages/ui/ui-kit-desktop/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [KERNEL_GUARD],
        patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES, ...LOG_PACKAGES],
      }],
      'no-console': 'error',
    },
  },
  {
    // 02 §1 — Layer 1 depends on Layer 0 and nothing else. A kernel that knows
    // which plugins exist is not a kernel: it resolves them from a registry
    // the shell hands it, which is what lets one kernel boot two graphs.
    // `src/testing.ts` is exempt for the reason `*.test.ts` is.
    files: ['packages/kernel/src/**/*.ts'],
    ignores: ['packages/kernel/src/**/*.test.ts',
              'packages/kernel/src/testing.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [...PLATFORM_SDKS, ...CORE_PACKAGES,
                   '@BBeBee/plugin-*', '@BBeBee/plugin-*/**', '@BBeBee/ui-*', '@BBeBee/ui-*/**'],
      }],
    },
  },
  {
    // 02 §1 — Layer 0 must stay runtime-free so it is safe to import anywhere,
    // which is what makes it the seam every other layer is mocked at.
    // `^[^.]` matches bare specifiers only, leaving relative imports alone.
    files: ['packages/protocol/src/**/*.ts'],
    ignores: ['packages/protocol/src/conformance/**/*.ts',
              'packages/protocol/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ regex: '^[^.]', allowTypeImports: true }],
      }],
    },
  },
  {
    // 02 §1 — the shells are Layer 5 and reach Layers 2 and 3 through service
    // keys. Platform SDKs are deliberately NOT banned: a shell owns genuinely
    // platform-bound chrome (08 §7). What it may not do is skip a layer.
    //
    // `no-console` is not set here either, and that is deliberate: a shell has
    // to be able to report a failure that happened before any transport was
    // loaded — a core service throwing means there is no ring buffer to read
    // back and no file being written.
    files: ['apps/mobile/src/**/*.{ts,tsx}', 'apps/desktop/renderer/**/*.{ts,tsx}'],
    ignores: [...COMPOSITION_ROOT, '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [KERNEL_GUARD], patterns: [...CORE_PACKAGES, ...LOG_PACKAGES],
      }],
    },
  },
  {
    // 02 §2 — main is an IPC host. Domain logic there breaks platform symmetry,
    // and it would put Layer 4 concerns below Layer 2.
    files: ['apps/desktop/main/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@BBeBee/plugin-*'] }] },
  },
  {
    // Tests are not shipped, so the SDK ban does not apply: a conformance
    // harness legitimately needs `node:fs` to build a scratch directory, and
    // a plugin's test legitimately loads a real core service to run against.
    files: ['**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off', 'no-console': 'off' },
  },
)
```

把它读作一张矩阵，那就是不留任何隐含之处的分层模型：

| | Layer 0 `protocol/` | Layer 1 `kernel/` | Layer 2 `core/` | Layer 3 `logs/` | Layer 4 `feature/` | Layer 5 `ui/`、`apps/*` | 平台 SDK | `console.*` |
|---|---|---|---|---|---|---|---|---|
| **Layer 0** 可导入 | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Layer 1** 可导入 | ✅ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Layer 2** 可导入 | ✅ | ✅ **全部** | 自己的包 | ❌ | ❌ | ❌ | ✅ **仅此一层** | ❌ |
| **Layer 3** 可导入 | ✅ | ⚠️ 仅插件表面 | ❌ *（改用服务键）* | 一个兄弟传输层 | ❌ | ❌ | ❌ | ✅ **仅此一层** |
| **Layer 4** 可导入 | ✅ | ⚠️ 仅插件表面 | ❌ *（改用服务键）* | ❌ *（`ctx.logger`）* | 仅类型，且仅限兄弟包 | ❌ | ❌ | ❌ |
| **Layer 5** 可导入 | ✅ | ⚠️ 仅插件表面 | ❌ *（改用服务键）* | ❌ *（`ctx.logger`）* | ⚠️ 仅类型 | ✅ | ⚠️ `ui/*` 里可导入视图库；`apps/*` 里可导入平台窗口装饰 | ❌ |
| **组合根** 可导入 | ✅ | ✅ | ✅ | ✅（作为引导条目） | ✅（作为注册表数据） | ✅ | ✅ | ✅ |

有三项检查刻意放在**测试**里而不是 ESLint 里，因为一条自身选择器无法被验证的 lint 规则比没有更糟 —— 每一项都自带一个证明其检测器确实会触发的自测：

| 检查 | 位置 | 守护 |
|---|---|---|
| 未等待的 `ctx.plugin()`，以及被声明为普通 `function` 的插件入口 | `kernel/src/conventions.test.ts` | [03 §2](./03-plugin-system.md) |
| 每个功能插件都调用 `ctx.logger`，且 Layer 3 之外没有任何东西导入传输层 | `kernel/src/conventions.test.ts`、`kernel/src/layers.test.ts` | [04 §16](./04-core-services.md) |
| `KERNEL_PLUGIN_SURFACE` 仍等于 `kernel/src/index.ts` 顶部的再导出块，且 `createApp` 只在组合根被调用 | `kernel/src/layers.test.ts` | [02 §1](./02-architecture.md#不变量) |
| 能力门，以及没有任何插件持有自己用不到的能力 | 各 `*-scope` 契约套件与 `conventions.test.ts` | [03 §7](./03-plugin-system.md#7-能力模型) |

`layers.test.ts` 存在的理由是：允许清单是内核插件表面的*第二份副本*，而同一份清单的两份副本会漂移。有了它，向 `@BBeBee/kernel` 添加一个导出就强制给出一个深思熟虑的回答："这属于哪个表面？" —— 放进再导出块，每层都能调用；放在下面，就只有 Layer 2 能。

仍待补上：检查任何 `plugin-*-ui-*` 包都不从其对应的无 UI 插件导入*值*，只允许导入类型 —— 上表中 `⚠️ 仅类型` 那一格目前只是约定，而非强制。用 `eslint-plugin-import` 的 `no-restricted-paths` 加上仅类型例外即可覆盖。脚手架已经产出正确的形状 —— 无 UI 包是其视图包的 `devDependency` —— 但还没有任何机制强制它。

---

## 4. 构建流水线

| 目标 | 打包器 | 入口 | 说明 |
|---|---|---|---|
| 移动端 | **Metro** | `apps/mobile/index.js` | 需要 `unstable_enablePackageExports` 以解析 Cordis 的 ESM `exports` 映射，并需要 `version: '2023-11'` 档位的 `@babel/plugin-proposal-decorators` |
| 桌面渲染进程 | **Vite** | `apps/desktop/renderer/index.html` | 开发时使用原生 ESM；严格 CSP，唯一的让步是 `'wasm-unsafe-eval'`，没有它 QuickJS 无法编译、启动直接失败 —— 它**不是** `'unsafe-eval'`，因此没有任何外来的*JavaScript* 被加载 (02 §2)。由 `renderer/csp.test.ts` 钉死 |
| 桌面主进程 + preload | **electron-vite** | `apps/desktop/main/index.ts` | CJS 输出；原生依赖外部化 |
| 各包 | **tsup**（`protocol` 用 `tsc`） | 各包的 `src/index.ts` | 仅 ESM；`protocol` 只产出类型 |
| QuickJS WASM | 内嵌进 bundle | `core-js-quickjs-node` | 经 `quickjs-emscripten-core` 使用**单文件**变体（`@jitl/quickjs-singlefile-browser-release-sync`），于是引擎就是某个 JS chunk 里的字节，绝不被获取 —— 一个要自己下载引擎的沙箱算不上沙箱 (04 §19)。`getQuickJS()` 的存在就是为了否定这个东西：它选的是启动时才去获取的独立 `.wasm` 变体 —— 开发时由 Vite 提供 `index.html`，打包后则被 `file://` 渲染进程直接拒绝 —— 还会把全部四个变体（约 4 MB）拖进构建 |

```jsonc
// metro.config.js — the parts that are not boilerplate
{
  "resolver": {
    "unstable_enablePackageExports": true,
    "unstable_conditionNames": ["react-native", "import", "require", "default"]
  },
  "watchFolders": ["<repo>/packages"]
}
```

代码生成（`packages/tooling/tooling-gen-plugins`，以 `pnpm gen:plugins` 运行）写出 `apps/{mobile,desktop}/generated/plugins.ts`。其产物**提交进仓库**，因此全新检出无需任何前置步骤即可构建，CI 也只需校验该文件是否为最新，而不必重新生成 —— 每当新增或移除插件包时都要跑一次。

编排不使用 Turborepo —— 没有 `turbo.json`；根脚本以 `pnpm -r` 运行 `build`、`typecheck`、`lint` 与 `test`。

---

## 5. 版本矩阵

已于 **2026-09-12** 对照 `package.json` / `pnpm-lock.yaml` 核实 —— lockfile 才是权威；这张矩阵只是一张地图。其中若干依赖每周都会变动。

| 包 | 版本 | 说明 |
|---|---|---|
| `cordis` | **4.0.0-rc.9** | ⚠️ 候选发布版本 —— 见 §5.1 |
| `cosmokit` | ^1.8.1 | Cordis 依赖 |
| `@standard-schema/spec` | — | 计划用于插件 `Config` 校验；**尚未成为依赖** |
| `expo` | 57.0.18 | SDK 57 |
| `react-native` | **0.86.3** | 由 Expo SDK 57 锁定；勿漂移到 0.87 |
| `react` | **19.2.3** | 由 Expo SDK 57 锁定。桌面渲染进程必须与之匹配 |
| `expo-router` | ~57.0.17 | |
| `expo-audio` | ~57.0.4 | `expo-av` 已停止维护，不得使用 |
| `expo-file-system` | ~57.0.6 | `File`/`Directory` API；旧版位于 `expo-file-system/legacy` |
| `expo-sqlite` | ~57.0.2 | |
| `expo-secure-store` | ~57.0.2 | |
| `expo-background-task` | ~57.0.16 | 取代 `expo-background-fetch`。与 `expo-task-manager` ~57.0.16 搭配 |
| `expo-network` | ~57.0.1 | `ctx.device.network()` |
| `expo-battery` | ~57.0.2 | `ctx.device.battery()` |
| `expo-application` | ~57.0.2 | `ctx.device` 所报告的应用版本 |
| `expo-keep-awake` | ~57.0.1 | `ctx.background.acquireWakeLock` |
| `expo-crypto` | ~57.0.2 | |
| `expo-dev-client` | ~57.0.16 | 必需 —— Expo Go 无法承载这些原生模块 |
| `react-native-audio-api` | **0.13.3** | ⚠️ 尚未到 1.0 —— 见 §5.2。Peer 依赖：`react-native-worklets >= 0.6.0` |
| `react-native-gesture-handler` | ~2.32.0 | ⚠️ 我们自己并未使用。`react-native-audio-api` 的桶文件拖进了它的 `AudioControls` 小部件，而该小部件**在未声明二者**的情况下导入了本包与 Reanimated —— 因此不安装它们，Metro 就无法解析包根。见 §5.2 |
| `react-native-reanimated` | ~4.5.1 | ⚠️ 同样的原因。一旦这两个包可被解析，`babel-preset-expo` 会自行添加 worklets 插件，因此 `babel.config.js` 无需改动 |
| `react-native-worklets` | ~0.10.1 | Reanimated 4 的运行时，也是 `react-native-audio-api` 的可选 peer |
| `electron` | **44.0.0** | 要求 Node ≥ 22.12，因此 `node:sqlite` 可用 |
| `electron-vite` | 5.0.0 | |
| `vite` | ^7.3.6 | 由 `electron-vite` 5 锁定 —— 矩阵过去写的是 8.2.2；请以 `pnpm-lock.yaml` 为权威 |
| `typescript` | **5.9.3** | ⚠️ 若矩阵中有工具还跟不上 TS 7，就改锁最新的 5.x —— 我们现在正是这么做的 |
| `vitest` | ^4.1.11 | |
| `zod` | — | 计划用于插件 `Config` 校验（符合 Standard Schema）；**尚未成为依赖** |
| `pnpm` | 11.x | 工作区管理器 —— 精确版本请读 `packageManager` / lockfile |
| `turbo` | — | **未采用。** 根脚本以 `pnpm -r` 编排；没有 `turbo.json` |
| `@shopify/flash-list` | 2.3.2 | 移动端列表虚拟化 |
| `@tanstack/react-virtual` | 3.14.10 | 桌面端列表虚拟化 |
| `music-metadata` | 11.15.0 | 两个目标平台的标签读取**都用它** —— 它是构建在 `ctx.fs` 之上的纯 JS，因此 `core-codec-rn` 直接继承它，而不是另加一个必须与它保持一致的原生读取器 |
| `quickjs-emscripten-core` + `@jitl/quickjs-singlefile-browser-release-sync` | **0.32.0** | ⚠️ 桌面端的 `ctx.js`。两者都精确锁定且保持相等 —— 不同版本的变体与核心共享一份未加版本的 FFI ABI。单文件变体是引擎随包捆绑而非被获取的原因 (04 §19)；`browser` 构建是不挑环境的那个，因此 Vitest、`main` 与被沙箱化的渲染进程运行的是同一个 realm |
| `react-native-quickjs` | **0.4.x** | ⚠️ 移动端的 `ctx.js` —— 原生模块，因此会强制重建 dev client。见 §5.3 |

### 5.1 Cordis RC 问题

`cordis@4.0.0-rc.9` 自己的 README 写道：*"Cordis is under active development. The API is not yet stable and may change without notice."*（Cordis 仍在活跃开发中，API 尚未稳定，且可能不经通知即变更。）整个架构都建立在它之上。缓解措施，按序如下：

1. **精确锁定。** `"cordis": "4.0.0-rc.9"` —— 不带插入号（^），不带波浪号（~）。该包排除在 Renovate/Dependabot 之外；升级必须有意为之、手动执行，并单独开一个 PR。
2. **收敛使用面。** 项目只使用 `Context`、`Service`、`plugin`、`inject`、`effect`、事件方法、`isolate` 和 `intercept` —— 十来个入口。Cordis 提供的其余能力一概不用，因此某处变更的波及范围有界且可审计。
3. **掌握再导出。** `@BBeBee/kernel` 再导出插件所需的内容（`export { Service, Inject } from 'cordis'`），并且**插件从 kernel 导入，而不是直接从 `cordis` 导入**。一旦签名变化，由一个适配模块吸收，而不是波及 40 个包。这就是内核的*插件表面*，也是 Layer 1 中 Layer 3 与 Layer 4 唯一获准导入的部分 —— 旁边的引导表面只有 Layer 2 与组合根可用（[02 §1](./02-architecture.md#不变量)，在 [§3](#3-依赖规则) 中强制执行）。
4. **锁定测试。** `@BBeBee/protocol` 的契约测试套件包含一小组测试，断言设计所依赖的 Cordis 语义 —— 依赖丢失会卸载插件、effect 按逆序执行、隔离按服务键逐一生效。破坏假设的升级会让 CI 直接失败并给出明确信息，而不是六周后才在运行时暴露。

### 5.2 音频引擎风险

`react-native-audio-api` 处于 `0.13.x`，是另一个未锁定的赌注。ADR-4 的结构已缓解此风险：`ctx.audio` 是一个服务，其契约是*标准的* Web Audio API 而非该库自身的形状，且 `core-audio-rntp` 是有据可查的备选方案（[05 §1](./05-audio-playback.md#逃生通道)）。锁定纪律与 Cordis 相同。

⚠️ **它的桶文件拖进来一个 UI 小部件。** `react-native-audio-api/src/api.ts` 导入了 `Audio/controls/AudioControls`，后者又导入 `react-native-gesture-handler` 与 `react-native-reanimated` —— 而该包对二者都未声明。因此，在两者都安装之前，导入该包的根入口就无法完成打包，而且即便没有任何东西渲染这个小部件，它的四枚图标 PNG 也会混进 bundle。出路有三条，按当时考虑的顺序：

1. **两个都装** —— 我们的实际做法。它们是普通的 Expo SDK 包，无需改动 Babel，而且 M2 的拖拽排序本来就需要 gesture-handler。代价：两个原生模块，外加约 2 KB 用不上的图标。
2. **在 Metro 的 `resolveRequest` 里垫片（shim）掉它们。** 更省事，而且*眼下*安全，因为没有任何东西渲染 `AudioControls` —— 但第一个添加滑动手势的人，会从一个说谎的解析器那里收到一头雾水的失败。
3. **绕过桶文件做深导入**（`react-native-audio-api/lib/module/core/AudioContext` 等）。避开两个原生模块；该包没有发布 `exports` 映射，所以行得通。但对版本脆弱，而且会蔓延到我们的三个包。

如果这两个原生模块哪天成了问题，方案 3 就是逃生通道，而且它是可控的。

---

### 5.3 求值器风险

`ctx.js` 是第三个 pre-1.0 赌注，而且它是随 [ADR-5](./01-overview.md#adr-5--音源是导入的字符串由一个运行时解释) 一道到来的，并非从容选定。两套 QuickJS 绑定、两套构建系统，其中一套还是原生模块，而它所在的平台恰恰是改动原生模块代价高昂的平台。

缓解手段与另外两个同构，这也正是 `ctx.js` 被做成一个*服务*、而不是 `plugin-source-runtime` 内部一个导入的原因：契约是"在带这些限制、这份宿主暴露面的 realm 里求值这个字符串"，QuickJS 能满足它，`isolated-vm` 形态的嵌入能满足它，`Worker` 也能 —— 只是在限制方面故事更差。契约测试套件测的正是这份契约，包括 `while (true)` 会被中断、宿主对象无法跨边界保留，因此更换实现只是换一个包，而不是一次重新设计。

⚠️ 真正会造成重创的，是出现一个**任何**解释器都无法嵌入的目标平台。今天两个目标平台都不是这种情形；如果哪天变成了这样，那就是重新考虑整套规则语言的触发条件。

---

## 6. 测试策略

四层测试，各自能捕获其他层无法捕获的问题。

| 层 | 工具 | 覆盖内容 |
|---|---|---|
| **单元** | Vitest | 纯逻辑：URN 解析、分数索引（fractional indexing）、智能播放列表编译、针对 mock `AudioService` 的播放控制状态机 |
| **契约** | Vitest（Node）+ Detox（真机） | 以 `@BBeBee/protocol/conformance` 中的共享套件测试每一个 `core-*` 实现（04 §18）。**最重要的一层** |
| **集成** | Vitest（内存中的 Context） | 真实的 Cordis Context、真实的功能插件、伪造的核心服务。覆盖插件加载顺序、瀑布（waterfall）钩子组合与卸载完整性 |
| **音源语料库** | Vitest，响应内联录制在测试里 | `fixtures/sources/` 中的每一份示例文档都被端到端回放 —— 搜索、浏览、专辑、流 —— 因此任何破坏真实文档的规则引擎改动都会让 CI 失败。`pnpm source:record`（用于把这些响应移入 fixture 文件）是计划中的，尚未建成 |
| **真机冒烟** | 人工，随每次发布 | 锁屏、蓝牙、拔出耳机、来电、无缝播放边界、后台存活（05 §7） |

有两项测试值得几乎先于一切编写，因为它们把架构的核心主张固化成了代码：

```ts
// Claim: unload is total. (03 §2)
it('leaves nothing behind when disabled', async () => {
  const before = snapshotContext(ctx)         // listeners, timers, services, effects
  const fiber = await ctx.plugin(SomePlugin, config)
  await fiber.dispose()
  expect(snapshotContext(ctx)).toEqual(before)
})

// Claim: the player does not know downloads exist. (02 §5, 05 §2)
it('plays the same track with and without plugin-download', async () => {
  const withoutDl = await resolveVia(ctxWithout, urn)
  const withDl    = await resolveVia(ctxWith, urn)
  expect(withoutDl.kind).toBe('remote')
  expect(withDl.kind).toBe('local')
  expect(playerBehaviour(withoutDl)).toEqual(playerBehaviour(withDl))
})
```

第一项以参数化方式对工作区中的**每一个**插件运行。任何有泄漏的插件都会让 CI 直接失败。

一旦音源存在，第三个测试就该与它们并列，因为它是整个字符串模型所立足的主张：

```ts
// Claim: a source is data, and the runtime is the only interpreter. (06 §1.1)
it('plays from a document nobody compiled', async () => {
  await ctx.sources.import(await readFixture('subsonic.json'))
  const hit = await ctx.sources.searchAll({ text: 'radiohead' })
  const handle = await ctx.sources.forUrn(firstUrn(hit))!.resolveStream(id, prefs)
  expect(handle.target).toMatch(/^https:\/\/music\.example\.org\/rest\/stream/)
})
```

语料库套件是最容易在无人照料时腐坏的一个：录制的 fixture 会渐渐偏离活的后端，而"语料库全绿、真实音源却坏了"正是要盯住的那种失败模式。作为制衡，`check` 命令（[06 §10](./06-music-sources.md#10-诊断一个坏掉的源)）要针对活的服务器、由人工、随每次发布运行 —— 与真机冒烟矩阵同一形态，并且出于同样的理由，诚实地保持人工。

---

## 7. 开发工作流

### 首次运行

```bash
pnpm install                 # pnpm 11+, Node 22.12+
pnpm check                   # typecheck + lint + test — should be green on a clean checkout
```

`pnpm check` 是整道闸门。它通过，CI 就通过。推送之前先跑它；本节其余内容在出问题之前都并非必读。

### 日常命令

| 命令 | 作用 |
|---|---|
| `pnpm check` | `typecheck` + `lint` + `test`。提 PR 前的那一条命令 |
| `pnpm test` | Vitest 对所有包跑一遍 |
| `pnpm test:watch` | Vitest 监视模式 —— 干活时让它一直开着 |
| `pnpm typecheck` | 每个包**及两个 app** 都跑 `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint，含 [§3](#3-依赖规则) 的架构规则 |
| `pnpm build` | 为每个包产出 `dist/` |
| `pnpm clean` | 移除 `dist/`、`out/` 与构建信息 |

按路径跑单个包的测试 —— `pnpm test packages/core/core-fs-node` —— 或单个文件。

### 运行应用

| 命令 | 作用 | 需要什么 |
|---|---|---|
| `pnpm dev:desktop` | `electron-vite dev` —— main、preload 与 renderer 三处 HMR | Electron 二进制（由 `pnpm install` 抓取；首次安装需要网络） |
| `pnpm build:desktop` | 产出生产包到 `apps/desktop/out/` | — |
| `pnpm dev:mobile` | `expo start --dev-client` | 设备或模拟器上的**自定义 dev 构建** —— 见下 |

> ⚠️ **移动端需要自定义 dev 构建，不能用 Expo Go。** `react-native-audio-api`、`expo-sqlite` 与 `expo-file-system` 都含原生代码，Expo Go 无法承载本应用。每变更一次原生依赖就构建一次 dev client（`pnpm --filter @BBeBee/mobile exec expo run:android`），之后 `pnpm dev:mobile` 会附着到它。

> ⚠️ **打包尚未配置。** `build:desktop` 产出的是 bundle，不是安装器；`electron-builder`（dmg / nsis / AppImage）与移动端的 `eas build` 要到首个发布版本才到位，不属于 M0。

### 新增插件

```bash
pnpm new:plugin --name scrobble --kind feature --ui desktop --capabilities db:own
pnpm install                 # link the new workspace package
pnpm gen:plugins             # add it to both shells' static registries
pnpm check                   # already green — the template ships passing tests
```

| 标志 | 取值 | 效果 |
|---|---|---|
| `--name` | 小写、连字符分隔 | `scrobble` → `@BBeBee/plugin-scrobble` |
| `--kind` | `feature`（默认）、`effect` | 决定包前缀。没有 `source` 这个种类：一个音乐后端是文档，不是包 |
| `--ui` | `none`（默认）、`desktop`、`mobile`、`both` | 生成 [08 §1](./08-ui-architecture.md#1-三包约定) 所述的按目标视图包 |

无 UI 包落在 `packages/feature/`，其视图落在 `packages/ui/`（[§1](#1-仓库布局)）。这个落位是脚手架最举足轻重的产物：lint 规则认层目录，所以写错目录的包会被错误的规则悄无声息地治理。`tooling-create-plugin` 自己的测试断言了这个拆分。
| `--capabilities` | 逗号分隔 | 写入 `BBeBee.plugin.json`（[03 §7](./03-plugin-system.md#7-能力模型)） |

脚手架并非可有可无的点缀。三包约定、清单格式、能力列表、泄漏测试都要接对，手工搭一个插件意味着总会在其中一环出错 —— 而且往往是*无声*失败的那一环。模板自带正确的 `await ctx.plugin(...)` 形态与泄漏测试，这两样若靠踩坑领悟，各要付出一整个调试会话的代价。

### 添加一个音源

这根本不算一项开发任务 —— 这正是要点所在。在应用内：**设置 → 音源 → 导入**，粘贴字符串，查看它声明自己会做什么，确认（[06 §9](./06-music-sources.md#9-导入更新与分享)）。无需安装、无需重新构建、无需重启。

有两个命令是**计划中的**（M2 收尾；目前都还不在根 `package.json` 里），用于维护本仓库随附在 `fixtures/sources/` 中的*文档*。在它们落地之前，语料库套件的响应内联录制在 `packages/feature/plugin-source-runtime/src/` 下的测试里：

| 命令（计划中） | 将来的作用 |
|---|---|
| `pnpm source:check <file>` | 针对 live 后端运行 [06 §10](./06-music-sources.md#10-诊断一个坏掉的源) 的健康检查并打印追踪。需要网络；对需要认证的音源，还需要环境里备好凭据 |
| `pnpm source:record <file>` | 回放同样的步骤，并写出语料库套件（[§6](#6-测试策略)）离线回放所用的 HTTP fixture |

**新增或移除插件之后，运行 `pnpm gen:plugins`。** Metro 无法解析运行期路径，因此两个外壳读取的都是一份生成的静态导入注册表（[§4](#4-构建流水线)）。产物随仓库提交；CI 校验其是否为最新，而不是重新生成。

### 各道门各自能抓住什么

值得了解，因为这里的失败通常意味着架构层面的错误，而不是拼写错误：

| 门 | 能抓住的问题 |
|---|---|
| `no-restricted-imports` | 插件伸手去够平台 SDK，而不是 `ctx.*` 服务（[02 §1](./02-architecture.md#不变量)） |
| 契约测试套件 | 同一服务的两份实现渐行渐远 —— 这正是套件存在的理由 |
| `*-scope` 套件 | 能力门在某一平台成立、在另一平台失效 |
| 泄漏测试（`diffSnapshots`） | 卸载不干净的插件（[§6](#6-测试策略)） |
| `conventions.test.ts` | 未等待的 `ctx.plugin()`，会无声地使就绪状态无法传播 |

### 出问题时

| 症状 | 原因 |
|---|---|
| Metro：*无法解析 `cordis`* | `metro.config.js` 缺少 `unstable_enablePackageExports` —— Cordis 是纯 ESM，带 `exports` 映射（[04 §17](./04-core-services.md#17-运行时兼容性清单)） |
| `@Inject` 运行时失败、编译却通过 | 用了旧式装饰器。Babel 需要 `{ version: '2023-11' }`；`tsconfig` 不得设置 `experimentalDecorators` |
| 插件永远停在 `pending` | 某个被注入的服务始终没有 ACTIVE。`ctx.inspector.render()` 会打印纤维树并注明每个 fiber 在等什么 |
| `app.start()` 已 resolve 但某个服务尚未就绪 | 某处有未等待的 `ctx.plugin()`。`pnpm test packages/kernel` 会点名文件 |
| `CapabilityError: … may not …` | manifest 缺少某项能力，或路径/表确实越界。要放宽的是 manifest，永远不要放宽门 |
| 来自音源的 `CapabilityError: host … not allowed` | 文档的规则触达了它未声明的主机。把它加进 `allowedHosts` 并重新导入，让用户看得见 (06 §8) |
| 音源不返回任何结果，也没有报错 | 某条规则在字段本可为空的地方什么都没匹配到。规则追踪器会点名那一步 (06 §10)；`check` 会赶在用户之前找到它 |
| 音源中出现 `JsTimeoutError` | 某个 `@js:` 块在死循环，或在等待一个永不 resolve 的请求。限制按每次求值计，不能按音源配置 (04 §19) |
| 渲染进程：*preload bridge 缺失* | 渲染进程加载时没有拿到 `preload/index.cjs` —— 重新构建，preload 必须是 CJS |
| Electron 在无头机器上无法启动 | 预期行为。它需要 `libgtk-3`、`libnss3` 与显示器；产物本身仍可构建 |

### 提 PR 前的本地检查清单

- [ ] `pnpm check` 全部通过。
- [ ] `pnpm gen:plugins` 不产生任何差异。
- [ ] 新插件通过 [§6](#6-测试策略) 的泄漏测试。
- [ ] 新的核心服务实现通过其契约测试套件 —— **以及它的 `*-scope` 套件，在该服务的每一份实现上**，而不只是你改动的那一份。
- [ ] 没有必须放宽 [§3](#3-依赖规则) 规则才能允许的新导入。
- [ ] 若有依赖变动，版本矩阵已同步更新。
- [ ] 若规则引擎有改动，音源语料库（[§6](#6-测试策略)）全绿 —— 并且如果某个 fixture 不得不重新录制，在 PR 里说明原因，因为被悄悄重录的 fixture 会掩盖一次真实的行为变化。

---

## 8. 下一步

[10 —— 路线图与风险](./10-roadmap.md) 规定了构建的先后次序。
