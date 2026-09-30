# 插件加载机制与动态注册表

> **历史章节映射：** 原 `docs-zh/03-plugin-system.md §6`。

## 6. 加载

依据[修订后的 ADR-1](../architecture/overview.md#adr-1--插件在所有目标平台上都静态打包)，
两个目标平台**都只有一个加载器**：插件图在任何平台上都在构建期固定下来。用户在运行时添加的
是音源**字符串（source string）**，它是由 `plugin-source-runtime`（[06](../sources/spec.md)）
解释的数据，而不是交给 `ctx.plugin()` 的代码。

§6.2 把动态加载器记录为一项搁置的设计 —— 已经想清楚，但未接线 —— 因为搁置它的决定是可逆的，
而它所解决的 CSP 问题并不显然。

### 6.1 所有目标平台 —— `plugin-loader-static`

Metro 无法解析运行时计算出的模块路径，因此插件导入必须可被静态分析。一个代码生成步骤
（`pnpm gen:plugins`，在构建前与开发监视期间运行）扫描工作区中含有 `BBeBee.plugin.json`
的包，并生成：

```ts
// apps/mobile/generated/plugins.ts — GENERATED, do not edit
import type { PluginRegistry } from '@BBeBee/kernel'

export const bundled: PluginRegistry = {
  '@BBeBee/plugin-player': {
    load: () => import('@BBeBee/plugin-player'),
    manifest: { /* … */ },
    builtin: true,
  },
  '@BBeBee/plugin-source-local': {
    load: () => import('@BBeBee/plugin-source-local'),
    manifest: { /* … */ },
    builtin: true,
  },
}
```

配置决定其中哪些真正被实例化、用什么设置。加载器在启动时按需执行 `load()` 进行动态加载，未启用的插件不会被加载或求值。生成的文件会被提交入库，因此干净的检出无需先跑
codegen 即可构建。

#### 并发加载与首帧后延时启动
为最大化启动性能，同时保持 Cordis 依赖注入生命周期的完整性：
- **并发 `loadPlugins`**：启用的插件通过 `Promise.all` 并发实例化，而非逐个串行执行。Cordis 原生依靠 `inject` 声明与 `PENDING` 机制解析依赖，天然支持乱序就绪。原先 1.3s 的插件串行段被压缩至“最慢单个插件”的加载耗时。核心服务 `bootstrap` 数组则维持串行有序不动。
- **首帧后延后启动（Deferred Loading）**：对首屏绘制非必须的插件（如 `plugin-local-scanner`、`plugin-download`、`plugin-share`、`plugin-visualizer`、`plugin-sleep-timer`、`plugin-history`）从 `INITIAL_ENABLED` 中拆离。在 Shell 首帧渲染后，应用通过 `requestIdleCallback`（降级 `setTimeout`）在空闲期调用 `app.loadPlugin(id)` 逐一加载。当延后插件激活并在 `ctx.ui` 注册路由/视图时，触发 `ui/changed` 事件并平滑更新导航与界面，杜绝启动阻塞。


### 6.2 桌面端的附加设计 —— `plugin-loader-dynamic`

> **已搁置，未构建。** 下述内容没有在任何外壳中注册。保留它是因为 ADR-1 的修订是一次范围
> 决策，而非技术决策：如果第三方*插件*（与音源不同）有朝一日确有必要走安装流程，设计就是
> 这一份，而那些显而易见的做法为何行不通的理由，不值得重新踩一遍坑。其中所有内容都以
> [10 §M5](../roadmap/roadmap.md#m5--沙箱上的第三方扩展) 为闸门。

渲染进程被沙箱化，`contextIsolation` 开启且 CSP 严格，因此它不能 `import()` 一个 `file://`
路径，而我们也不打算放宽其中任何一条。于是，`main` 将会注册一个特权的自定义协议（scheme）：

```ts
// apps/desktop/main — registered before app ready
protocol.registerSchemesAsPrivileged([{
  scheme: 'BBeBee-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}])
```

并从用户插件目录为其提供服务，拒绝路径穿越（path traversal），内容类型为 `text/javascript`。
渲染进程的 CSP 随之写作 `script-src 'self' BBeBee-plugin:`，加载器就是一个普通的动态导入：

```ts
const mod = await import(/* @vite-ignore */ `BBeBee-plugin://${id}@${version}/index.js`)
await ctx.plugin(mod.default, config)
```

这将让 CSP 保持可执行、`nodeIntegration` 保持关闭、避免 `new Function`，并且 —— 因为
`import()` 返回真正的模块 —— 获得正确的 ESM 语义，包括 top-level await。注意它*不能*提供的
是什么：遏制。模块落入的是渲染进程的 realm，这正是若真有版本要交付、它会改经 `ctx.js` 运行
的原因（[§7](#它不是什么)）。

**安装流程。** 获取包 → 校验完整性哈希 → 对照应用版本检查 `engines.BBeBee` → 解压到
`plugins/<id>@<version>/` → 读取清单 → 提示授予能力 → 写入 `plugin_records` 与
`capability_grants` → `ctx.plugin()`。更新采用并行安装、原子替换。卸载则先释放（dispose）
fiber，再删除目录 —— 顺序绝不能反，否则 fiber 的释放器可能在拆除中途失败。

**隔离区（quarantine）。** 连续两次在加载时抛出异常的插件会被标记为 `enabled = false` 并
设置 `lastError`，后续启动将跳过它，直到用户重新启用。没有这一机制，一个坏掉的第三方插件
就会变成无法恢复的启动死循环 —— 这是运行时插件系统最常见的故障模式。同样的思路用在腐坏的
音源而不是崩溃的插件上，就是 [06 §7](../sources/authoring.md#7-错误) 的失效（stale）徽标
—— 但有一个刻意的差别：失效的音源*不会*被停用，因为它缓存的目录仍值得浏览。

> ⚠️ 模块缓存意味着同一 URL 上更新过的插件不会被重新拉取。带版本的 URL（`<id>@<version>`）
> 可绕开此问题；开发模式则追加缓存穿透（cache-busting）查询参数。

### 6.3 清单

```jsonc
{
  "id": "@BBeBee/plugin-source-runtime",
  "version": "1.0.0",
  "displayName": "Music sources",
  "description": "Interprets imported source strings.",
  "engines": { "BBeBee": "^1.0.0" },
  "entry": {
    "main": "./dist/index.js",
    "ui": { "mobile": "./dist/ui.mobile.js", "desktop": "./dist/ui.desktop.js" }
  },
  "capabilities": [
    "net:host/*",           // narrowed per source to that source's allowlist — see §7
    "js",                   // evaluates source rules in ctx.js
    "db:read:core",
    "db:write:core",
    "secrets:own",          // one namespace per source id
    "fs:read:media"         // read cached artwork
  ],
  "contributes": {
    "settings": "./dist/settings-schema.js",
    "slots": ["settings.sources", "source.browse", "source.debug"]
  }
}
```

`entry.ui` 是可选且分目标平台的：插件可以只提供桌面视图而不提供移动端视图。当某个贡献项的
视图在某个目标平台缺失时，外壳必须渲染占位符而非崩溃 —— 这是 ADR-2 的直接代价，UI 注册表
把它显式化了（[08 §3](../ui/architecture.md#3-从描述符解析到视图)）。

### 6.4 配置

一份配置文档（桌面端为 YAML，移动端为 JSON），在任何功能插件加载之前通过 `ctx.fs` 读取：

```yaml
plugins:
  '@BBeBee/plugin-player':
    enabled: true
    config: { crossfadeMs: 0, prefetchNext: true }
  '@BBeBee/plugin-source-runtime':
    enabled: true
    config: { defaultRate: '2/1000' }
```

编辑配置只会释放并重建受影响的 fiber。

> **音源不在这里配置。** 它们是 `sources` 表中的行
> （[07 §4.1](../data-model/urn.md#41-音源账号与会话)），在应用内导入与编辑，
> `plugin-source-runtime` 给每个音源一个属于自己的 fiber，运行在其专属的 `ctx.isolate('http')`
> 作用域内（§5）。把它们放进配置文件，意味着加一台服务器要手改 JSON，也让"导入这串字符串"
> 变成开发者的动作（[06 §9](../sources/authoring.md#9-导入更新与分享)）。

### 6.5 热重载

开发环境下，`@cordisjs/plugin-hmr` 监视工作区，并在原位重载发生变化的插件。由于卸载是彻底
的，这对受影响的子树而言确实等价于一次重启 —— 旧 fiber 的音频图、监听器与定时器全部消失。
桌面端可直接使用；移动端则由内核在底层重载，同时与 Metro Fast Refresh 在视图层配合。

---

