# BBeBee —— 架构文档

BBeBee 是一款跨平台音乐播放器，面向桌面端（Electron）与移动端（Expo / React Native），它被构建为一个**插件平台**，而不是一个"外挂了扩展 API 的应用"。其内核是 [Cordis](https://github.com/cordiverse/cordis) —— 一个依赖注入与插件生命周期框架 —— 而*内核之上的一切都是插件*，包括文件 I/O、网络与持久化。平台差异通过"换装哪一份核心服务实现"来吸收，而不是在功能代码内部写条件分支。

**音源不是插件。** 源（source）是一份由用户以文本形式导入的 JSON 文档 —— 即把 [legado](https://github.com/gedoor/legado) 的书源模式套用到音频上 —— 由唯一一个内置运行时解释，并被沙箱化在它自己的 JS realm 之中。添加一个后端是一次粘贴，而不是一次发版（[ADR-5](./01-overview.md#adr-5--音源是导入的字符串由一个运行时解释)、[06](./06-music-sources.md)）。

> **状态说明。** 这些文档描述的是一个设计，而非已交付的系统。仓库中还没有任何应用代码。文中每一个版本号与 API 事实都在写作时对照已发布的包逐一核实过（版本锁定矩阵见 [09 —— 项目结构](./09-project-structure.md)）。

---

## 快速上手

```bash
pnpm install     # pnpm 11+, Node 22.12+
pnpm check       # typecheck + lint + test — green on a clean checkout
pnpm dev:desktop # Electron, with HMR across main, preload and renderer
```

`pnpm check` 是那道闸门；它通过，CI 就通过。完整的命令清单、插件脚手架、每道门各自能抓住什么，以及排障表，见 [09 §7 —— 开发工作流](./09-project-structure.md#7-开发工作流)。

> 移动端需要**自定义 dev 构建**，不能用 Expo Go —— 若干依赖含原生代码。
> 见 [09 §7](./09-project-structure.md#运行应用)。

---

## 阅读顺序

先读 `01` 和 `02` —— 它们确立了其余所有文档共用的词汇。

| # | 文档 | 回答什么问题 |
|---|---|---|
| 01 | [总览与决策](./01-overview.md) | 我们在构建什么、刻意*不*构建什么，以及塑造其余一切的四个决策 |
| 02 | [架构](./02-architecture.md) | 分层模型、各平台的运行时模型，以及应用如何启动 |
| 03 | [插件系统](./03-plugin-system.md) | 插件*是什么*、如何声明依赖、如何被加载、如何被约束 |
| 04 | [核心服务](./04-core-services.md) | 平台抽象：`fs`、`http`、`db`、`secrets`……以及各自的两份实现 |
| 05 | [音频与播放](./05-audio-playback.md) | 音频引擎、播放控制状态机与 DSP 效果链 |
| 06 | [音源](./06-music-sources.md) | 源字符串：它的 JSON、规则语言、运行时、信任、导入，以及一个坏掉的源如何被修复 |
| 07 | [数据模型](./07-data-model.md) | 身份标识（URN）、每一张表、每一个运行时类型、事件表与迁移 |
| 08 | [UI 架构](./08-ui-architecture.md) | 一个插件如何向两个截然不同的外壳贡献 UI |
| 09 | [项目结构](./09-project-structure.md) | Monorepo 布局、构建流水线、版本矩阵、测试策略 |
| 10 | [路线图与风险](./10-roadmap.md) | 带完成标准的里程碑，以及可能出问题的地方 |
| 11 | [M1 执行计划](./11-roadmap-M1.md) | 当前里程碑的细节：工作包、构建顺序，以及每条 M1 完成标准如何被验证 |

---

## 一段话版本

一个 Cordis `Context` 被创建在应用的唯一 JavaScript 运行时之中 —— 移动端是 Hermes，桌面端是 Electron 渲染进程。一小撮**核心插件**认领服务键（`ctx.fs`、`ctx.http`、`ctx.db`、`ctx.js`……），它们是仓库中*唯一*允许导入平台 SDK 的代码；每个键在每个目标平台上各有一份实现。在它们之上，**功能插件**提供播放、DSP、下载、媒体库与 UI，并且只通过这些服务键触达平台。所有契约 —— 服务接口、实体类型与类型化事件表 —— 都收敛在一个不含运行时的包 `@BBeBee/protocol` 中，它正是让实现可以互换的那道接缝。功能之间通过 Cordis 的**瀑布（waterfall）钩子**组合，例如下载插件可以透明地把流 URL 替换成本地文件，而播放器根本不知道下载的存在。**音源位于这一切之外**：它们是被导入的文档，以行的形式存放，由 `plugin-source-runtime` 解释，并通过本地文件插件所实现的同一个提供方接口呈现给应用的其余部分 —— 因此 `ctx.sources` 之上的任何东西都分辨不出一首曲目来自哪里。

---

## 这些文档使用的约定

- **服务键（service key）** —— 在上下文上认领的一个名字，例如 `ctx.player`。全文始终带 `ctx.` 前缀书写，以免与包名混淆。
- **包名** —— 始终使用全限定名，例如 `@BBeBee/plugin-download`。
- **源（source）** —— 用户所配置的一个音乐后端，由其 `sourceUrl` 标识，并通过一个派生的 **source id** 寻址。*源字符串（source string）*是它可导入的文本形式。
- **URN** —— 曲库实体的稳定标识符，例如 `BBeBee:music-example-org-35be9fe2:track:8f1a2c`。定义见 [07](./07-data-model.md)。
- TypeScript 代码块是**契约**，不是示意。它们应当能够通过编译。
- 以 `snake_case` 命名的表是 SQLite 表。以 `PascalCase` 命名的类型是 TypeScript 类型。
- ⚠️ 标记两个平台确实存在差异、抽象在此泄漏之处。这些点被有意指出，而不是藏起来。
