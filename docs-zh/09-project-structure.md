# 09 —— 项目结构

> **本篇回答什么。** Monorepo 的布局、以机械方式强制执行的依赖规则、每个目标如何构建、锁定的版本矩阵，以及防止平台抽象腐化的测试策略。

---

## 1. 仓库布局

```
B_Be_Bee/
├─ apps/
│  ├─ mobile/                       Expo app — the mobile shell
│  │  ├─ app/                       expo-router routes
│  │  ├─ generated/plugins.ts       codegen: static plugin imports (03 §6.1)
│  │  ├─ app.config.ts
│  │  ├─ metro.config.js
│  │  └─ babel.config.js
│  └─ desktop/
│     ├─ main/                      Electron main — IPC hosts only, no domain logic
│     ├─ preload/                   contextBridge surface
│     ├─ renderer/                  React DOM shell + the Cordis kernel
│     └─ electron.vite.config.ts
│
├─ packages/
│  ├─ protocol/                     @BBeBee/protocol — types + contracts, ZERO runtime
│  │  ├─ src/services/              fs, http, db, secrets, audio, player, sources, ui …
│  │  ├─ src/entities/              Track, Album, StreamHandle, TransportState …
│  │  ├─ src/events.ts              the typed event map (07 §5)
│  │  └─ src/conformance/           shared contract test suites (04 §18)
│  │
│  ├─ kernel/                       @BBeBee/kernel — bootstrap, config, loader, capability gate
│  │  └─ src/migrations/            core schema migrations
│  │
│  ├─ core-paths-node/     ✅       ┐ 平台实现。
│  ├─ core-paths-expo/     ✅       │ 只有这些包允许
│  ├─ core-fs-node/        ✅       │ 导入平台 SDK。
│  ├─ core-fs-expo/        ✅       │
│  ├─ core-db-node/        ✅       │ ✅ = 已实现 (M0)
│  ├─ core-db-expo/        ✅       │
│  ├─ core-store-fs/       ✅       │ 共享：单一实现，经 ctx.fs (04 §4)
│  ├─ core-http-node/               │
│  ├─ core-http-rn/                 │
│  ├─ core-secrets-electron/        │
│  ├─ core-secrets-expo/            │
│  ├─ core-audio-webaudio/          │ (shared: react-native-audio-api on both)
│  └─ core-…                        ┘
│
│  ├─ plugin-player/                ┐
│  ├─ plugin-dsp/                   │ headless feature plugins.
│  ├─ plugin-effect-eq10/           │ Import @BBeBee/protocol
│  ├─ plugin-source-local/          │ and nothing else.
│  ├─ plugin-source-subsonic/       │
│  ├─ plugin-local-scanner/         │
│  ├─ plugin-download/              │
│  ├─ plugin-library/               │
│  ├─ plugin-lyrics/                │
│  ├─ plugin-cache/                 │
│  ├─ plugin-log-console/  ✅       │ 日志传输：Cordis exporters，
│  ├─ plugin-log-file/     ✅       │ 跨平台共享 (04 §16)
│  ├─ plugin-log-buffer/   ✅       │
│  └─ plugin-…                      ┘
│
│  ├─ plugin-ui/            ✅       the ctx.ui contribution registry
│  ├─ plugin-sources/       ✅       the ctx.sources provider registry (06 §2)
│  ├─ plugin-inspector/     ✅       fiber tree + labelled effects (M0 exit criterion)
│  ├─ plugin-hello/         ✅       the M0 demonstration plugin
│  ├─ core-desktop-bridge/  ✅       renderer↔main IPC clients + the main-side host
│
│  ├─ ui-tokens/                    design tokens as plain data (08 §6)
│  ├─ ui-core/                      framework-agnostic React hooks
│  ├─ ui-kit-mobile/                React Native components
│  ├─ ui-kit-desktop/               React DOM components
│  ├─ plugin-hello-ui-desktop/ ✅   ┐ per-target view packages
│  ├─ plugin-hello-ui-mobile/  ✅   ┘
│  │
│  ├─ tooling-gen-plugins/  ✅      the static registry codegen (pnpm gen:plugins)
│  └─ tooling-create-plugin/ ✅     the scaffolder (pnpm new:plugin)
│
├─ docs/                            these documents
├─ eslint.config.js                 flat config; the architectural rules live here
├─ vitest.config.ts
├─ pnpm-workspace.yaml
└─ package.json
```

### 命名

| 前缀 | 含义 |
|---|---|
| `core-<service>-<platform>` | 某项核心服务的平台实现 |
| `plugin-<feature>` | 无 UI 的功能插件 |
| `plugin-<feature>-ui-<target>` | 面向单一目标的视图 |
| `plugin-source-<protocol>` | 一个音乐提供方 |
| `plugin-effect-<id>` | 一个 DSP 效果 |
| `ui-*` | 共享 UI 基础设施，不是插件 |

---

## 2. 包分层

```mermaid
flowchart TD
    apps["apps/*"] --> uikit["ui-kit-mobile · ui-kit-desktop"]
    apps --> kernel["@BBeBee/kernel"]
    apps --> pluginui["plugin-*-ui-*"]
    pluginui --> uikit
    pluginui --> uicore["ui-core"]
    uikit --> uicore
    uikit --> tokens["ui-tokens"]
    uicore --> protocol["@BBeBee/protocol"]
    pluginui -.->|types only| headless["plugin-* (headless)"]
    headless --> protocol
    core["core-*"] --> protocol
    kernel --> protocol
    apps --> core
```

凡是不指向 `@BBeBee/protocol` 的箭头都只是便利。*指向* `protocol` 的箭头才是架构本身。

---

## 3. 依赖规则

这些规则由 ESLint 的 `overrides` 按路径限定来机械执行，而不是靠评审把关。每条规则在配置中都有注释，说明它守护的是哪一节文档。

```js
// eslint.config.js — the rules that matter
const PLATFORM_SDKS = [
  'expo', 'expo-*', 'expo/*', 'react-native', 'react-native/*', 'react-native-*',
  'electron', 'electron/*', 'node:*', 'fs', 'fs/promises', 'path', 'os', 'crypto',
  'child_process', 'better-sqlite3', 'music-metadata', 'ws',
]

export default tseslint.config(
  {
    // 02 §1 — the invariant. Nothing outside core-* touches a platform SDK.
    files: ['packages/plugin-*/**/*.ts', 'packages/ui-*/**/*.ts', 'packages/protocol/**/*.ts'],
    ignores: ['packages/plugin-*-ui-*/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: PLATFORM_SDKS }] },
  },
  {
    // 08 §1 — UI packages may render, but may not reach the platform.
    files: ['packages/plugin-*-ui-mobile/**/*.ts', 'packages/ui-kit-mobile/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: PLATFORM_SDKS.filter((p) => !p.startsWith('react-native')) },
      ],
    },
  },
  {
    // @BBeBee/protocol must stay runtime-free so it is safe to import anywhere.
    // `^[^.]` matches bare specifiers only, leaving relative imports alone.
    files: ['packages/protocol/src/**/*.ts'],
    ignores: ['packages/protocol/src/conformance/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^[^.]', allowTypeImports: true }] },
      ],
    },
  },
  {
    // 02 §2 — main is an IPC host. Domain logic there breaks platform symmetry.
    files: ['apps/desktop/main/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@BBeBee/plugin-*'] }] },
  },
  {
    // Tests are not shipped, so the SDK ban does not apply: a conformance
    // harness legitimately needs `node:fs` to build a scratch directory.
    files: ['**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
)
```

有两条规则刻意放在**测试**里而不是 ESLint 里 —— 一条连自身选择器都无法验证的 lint 规则，比没有更糟：`conventions.test.ts` 扫描未等待的 `ctx.plugin()`（自带一个证明检测器确实会触发的自测），各 `*-scope` 契约套件则检查能力门。见 [§6](#6-测试策略)。

仍待补上：检查任何 `plugin-*-ui-*` 包都不从其对应的无 UI 插件导入*值*，只允许导入类型。用 `eslint-plugin-import` 的 `no-restricted-paths` 加上仅类型例外即可覆盖。脚手架已经产出正确的形状 —— 无 UI 包是其视图包的 `devDependency` —— 但还没有任何机制强制它。

---

## 4. 构建流水线

| 目标 | 打包器 | 入口 | 说明 |
|---|---|---|---|
| 移动端 | **Metro** | `apps/mobile/index.js` | 需要 `unstable_enablePackageExports` 以解析 Cordis 的 ESM `exports` 映射，并需要 `version: '2023-11'` 档位的 `@babel/plugin-proposal-decorators` |
| 桌面渲染进程 | **Vite** | `apps/desktop/renderer/index.html` | 开发时使用原生 ESM；严格 CSP 扩展了 `BBeBee-plugin:`（03 §6.2） |
| 桌面主进程 + preload | **electron-vite** | `apps/desktop/main/index.ts` | CJS 输出；原生依赖外部化 |
| 各包 | **tsup**（`protocol` 用 `tsc`） | 各包的 `src/index.ts` | 仅 ESM；`protocol` 只产出类型 |
| 第三方插件 | tsup，ESM，将 `@BBeBee/protocol` 外部化 | `dist/index.js` | 不得打包 protocol —— 它由宿主提供 |

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

代码生成（`packages/tooling-gen-plugins`，以 `pnpm gen:plugins` 运行）写出 `apps/{mobile,desktop}/generated/plugins.ts`。其产物**提交进仓库**，因此全新检出无需任何前置步骤即可构建，CI 也只需校验该文件是否为最新，而不必重新生成 —— 每当新增或移除插件包时都要跑一次。

由 Turborepo 编排：`build` 依赖 `^build`，`typecheck` 与 `lint` 并行执行，含有契约测试套件的包其 `test` 依赖 `build`。

---

## 5. 版本矩阵

已于 **2026-08-30** 对照 npm registry 逐项核实。首次提交前请再次核实；其中若干依赖每周都会变动。

| 包 | 版本 | 说明 |
|---|---|---|
| `cordis` | **4.0.0-rc.9** | ⚠️ 候选发布版本 —— 见 §5.1 |
| `cosmokit` | ^1.8.1 | Cordis 依赖 |
| `@standard-schema/spec` | ^1.1.0 | 插件 `Config` 校验 |
| `expo` | 57.0.18 | SDK 57 |
| `react-native` | **0.86.3** | 由 Expo SDK 57 锁定；勿漂移到 0.87 |
| `react` | **19.2.3** | 由 Expo SDK 57 锁定。桌面渲染进程必须与之匹配 |
| `expo-router` | ~57.0.17 | |
| `expo-audio` | ~57.0.4 | `expo-av` 已停止维护，不得使用 |
| `expo-file-system` | ~57.0.6 | `File`/`Directory` API；旧版位于 `expo-file-system/legacy` |
| `expo-sqlite` | ~57.0.2 | |
| `expo-secure-store` | ~57.0.2 | |
| `expo-background-task` | ~57.0.14 | 取代 `expo-background-fetch` |
| `expo-crypto` | ~57.0.2 | |
| `expo-dev-client` | ~57.0.16 | 必需 —— Expo Go 无法承载这些原生模块 |
| `react-native-audio-api` | **0.13.3** | ⚠️ 尚未到 1.0 —— 见 §5.2。Peer 依赖：`react-native-worklets >= 0.6.0` |
| `electron` | **44.0.0** | 要求 Node ≥ 22.12，因此 `node:sqlite` 可用 |
| `electron-vite` | 5.0.0 | |
| `vite` | 8.2.2 | |
| `typescript` | 7.0.2 | ⚠️ 若矩阵中有工具还跟不上 TS 7，就改锁最新的 5.x |
| `vitest` | 4.1.11 | |
| `zod` | 4.5.4 | 符合 Standard Schema；Valibot 或 ArkType 同样可行 |
| `pnpm` | 11.24.0 | 工作区管理器 |
| `turbo` | 2.10.12 | |
| `@shopify/flash-list` | 2.3.2 | 移动端列表虚拟化 |
| `@tanstack/react-virtual` | 3.14.10 | 桌面端列表虚拟化 |
| `music-metadata` | 11.15.0 | 桌面端标签读取，仅用于 `main` |

### 5.1 Cordis RC 问题

`cordis@4.0.0-rc.9` 自己的 README 写道：*"Cordis is under active development. The API is not yet stable and may change without notice."*（Cordis 仍在活跃开发中，API 尚未稳定，且可能不经通知即变更。）整个架构都建立在它之上。缓解措施，按序如下：

1. **精确锁定。** `"cordis": "4.0.0-rc.9"` —— 不带插入号（^），不带波浪号（~）。该包排除在 Renovate/Dependabot 之外；升级必须有意为之、手动执行，并单独开一个 PR。
2. **收敛使用面。** 项目只使用 `Context`、`Service`、`plugin`、`inject`、`effect`、事件方法、`isolate` 和 `intercept` —— 十来个入口。Cordis 提供的其余能力一概不用，因此某处变更的波及范围有界且可审计。
3. **掌握再导出。** `@BBeBee/kernel` 再导出插件所需的内容（`export { Service, Inject } from 'cordis'`），并且**插件从 kernel 导入，而不是直接从 `cordis` 导入**。一旦签名变化，由一个适配模块吸收，而不是波及 40 个包。
4. **锁定测试。** `@BBeBee/protocol` 的契约测试套件包含一小组测试，断言设计所依赖的 Cordis 语义 —— 依赖丢失会卸载插件、effect 按逆序执行、隔离按服务键逐一生效。破坏假设的升级会让 CI 直接失败并给出明确信息，而不是六周后才在运行时暴露。

### 5.2 音频引擎风险

`react-native-audio-api` 处于 `0.13.x`，是另一个未锁定的赌注。ADR-4 的结构已缓解此风险：`ctx.audio` 是一个服务，其契约是*标准的* Web Audio API 而非该库自身的形状，且 `core-audio-rntp` 是有据可查的备选方案（[05 §1](./05-audio-playback.md#escape-hatch)）。锁定纪律与 Cordis 相同。

---

## 6. 测试策略

四层测试，各自能捕获其他层无法捕获的问题。

| 层 | 工具 | 覆盖内容 |
|---|---|---|
| **单元** | Vitest | 纯逻辑：URN 解析、分数索引（fractional indexing）、智能播放列表编译、针对 mock `AudioService` 的播放控制状态机 |
| **契约** | Vitest（Node）+ Detox（真机） | 以 `@BBeBee/protocol/conformance` 中的共享套件测试每一个 `core-*` 实现（04 §18）。**最重要的一层** |
| **集成** | Vitest（内存中的 Context） | 真实的 Cordis Context、真实的功能插件、伪造的核心服务。覆盖插件加载顺序、瀑布（waterfall）钩子组合与卸载完整性 |
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

---

## 7. 开发工作流

### 首次运行

```bash
pnpm install                 # pnpm 11+, Node 22.12+
pnpm check                   # typecheck + lint + test —— 全新检出上应当全绿
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

按路径跑单个包的测试 —— `pnpm test packages/core-fs-node` —— 或单个文件。

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
pnpm install                 # 把新工作区包链接进来
pnpm gen:plugins             # 把它加进两个外壳的静态注册表
pnpm check                   # 本来就是绿的 —— 模板自带可通过的测试
```

| 标志 | 取值 | 效果 |
|---|---|---|
| `--name` | 小写、连字符分隔 | `scrobble` → `@BBeBee/plugin-scrobble` |
| `--kind` | `feature`（默认）、`source`、`effect` | 决定包前缀；`source` 会标记为 `instantiable`（[06 §2](./06-music-sources.md#2-provider-plugins-vs-provider-instances)） |
| `--ui` | `none`（默认）、`desktop`、`mobile`、`both` | 生成 [08 §1](./08-ui-architecture.md#1-the-three-package-convention) 所述的按目标视图包 |
| `--capabilities` | 逗号分隔 | 写入 `BBeBee.plugin.json`（[03 §7](./03-plugin-system.md#7-能力模型)） |

脚手架并非可有可无的点缀。三包约定、清单格式、能力列表、泄漏测试都要接对，手工搭一个插件意味着总会在其中一环出错 —— 而且往往是*无声*失败的那一环。模板自带正确的 `await ctx.plugin(...)` 形态与泄漏测试，这两样若靠踩坑领悟，各要付出一整个调试会话的代价。

**新增或移除插件之后，运行 `pnpm gen:plugins`。** Metro 无法解析运行期路径，因此两个外壳读取的都是一份生成的静态导入注册表（[§4](#4-构建流水线)）。产物随仓库提交；CI 校验其是否为最新，而不是重新生成。

### 各道门各自能抓住什么

值得了解，因为这里的失败通常意味着架构层面的错误，而不是拼写错误：

| 门 | 能抓住的问题 |
|---|---|
| `no-restricted-imports` | 插件伸手去够平台 SDK，而不是 `ctx.*` 服务（[02 §1](./02-architecture.md#the-invariant)） |
| 契约测试套件 | 同一服务的两份实现渐行渐远 —— 这正是套件存在的理由 |
| `*-scope` 套件 | 能力门在某一平台成立、在另一平台失效 |
| 泄漏测试（`diffSnapshots`） | 卸载不干净的插件（[§6](#6-测试策略)） |
| `conventions.test.ts` | 未等待的 `ctx.plugin()`，会无声地使就绪状态无法传播 |

### 出问题时

| 症状 | 原因 |
|---|---|
| Metro：*无法解析 `cordis`* | `metro.config.js` 缺少 `unstable_enablePackageExports` —— Cordis 是纯 ESM，带 `exports` 映射（[04 §17](./04-core-services.md#17-runtime-compatibility-checklist)） |
| `@Inject` 运行时失败、编译却通过 | 用了旧式装饰器。Babel 需要 `{ version: '2023-11' }`；`tsconfig` 不得设置 `experimentalDecorators` |
| 插件永远停在 `pending` | �个被注入的服务始终没有 ACTIVE。`ctx.inspector.render()` 会打印纤维树并注明每个 fiber 在等什么 |
| `app.start()` 已 resolve 但某个服务尚未就绪 | 某处有未等待的 `ctx.plugin()`。`pnpm test packages/kernel` 会点名文件 |
| `CapabilityError: … may not …` | manifest 缺少某项能力，或路径/表确实越界。要放宽的是 manifest，永远不要放宽门 |
| 渲染进程：*preload bridge 缺失* | 渲染进程加载时没有拿到 `preload/index.cjs` —— 重新构建，preload 必须是 CJS |
| Electron 在无头机器上无法启动 | 预期行为。它需要 `libgtk-3`、`libnss3` 与显示器；产物本身仍可构建 |

### 提 PR 前的本地检查清单

- [ ] `pnpm check` 全部通过。
- [ ] `pnpm gen:plugins` 不产生任何差异。
- [ ] 新插件通过 [§6](#6-测试策略) 的泄漏测试。
- [ ] 新的核心服务实现通过其契约测试套件 —— **以及它的 `*-scope` 套件，在该服务的每一份实现上**，而不只是你改动的那一份。
- [ ] 没有必须放宽 [§3](#3-依赖规则) 规则才能允许的新导入。
- [ ] 若有依赖变动，版本矩阵已同步更新。

---

## 8. 下一步

[10 —— 路线图与风险](./10-roadmap.md) 规定了构建的先后次序。
