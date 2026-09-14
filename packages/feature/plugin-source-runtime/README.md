# @BBeBee/plugin-source-runtime

Layer 4（feature）— **整个仓库里唯一的源文档解释器**：把用户以文本导入的"音乐源字符串"（legado 书源模型的 JSON 文档）变成可播放的 `MediaProvider`。

## 概述

音乐源**不是插件**——它是一条 `sources` 表的行。本包是唯一把行变成可播放实体的东西，且没有第二个解释器要保持同步（"Sources are rows; this is the only thing that turns one into something playable"）。

它**不占用服务键**（不是 `Service` 子类）：读 `ctx.sources.sources`，为每个启用的可解释行注册一个 `MediaProvider`，每个源在自己的 fiber、自己的 `ctx.isolate('http')` 里运行。

- 必需注入：`['http', 'db', 'sources']`。
- 可选注入（嵌套 `ctx.inject`，这是 Cordis 表达可选依赖的方式）：`['js']`（QuickJS 沙箱——没有它的构建仍能跑所有不需要 `@js:` 的文档）、`['secrets']`（凭据存储）。两者独立：一个构建可能只有沙箱没有 keychain，或反之。
- 能力声明：`net:host/*`（主机在文档导入前不可知，per-source 收窄发生在 `startOne` 的 intercept 上）、`db:read:core`、`db:write:core`；contributes slot `settings.sources`。
- 规则求值全部委托给 `@BBeBee/source-rules`（纯逻辑）；**所有网络抓取都在本包**。

## 源文件

### `src/index.ts` — 插件入口与"活源"管理

**`SourceRuntime`**：

- `live: Map<sourceId, LiveSource>` — 一个源改动只拆除那一个源。
- **`start()`** — `sync()` 后挂监听：`source/imported → sync`、`source/changed → reload(id)`、`source/removed → stop(id)`。回调包在 `safely()` 里（fire-and-forget 事件里的未捕获 rejection 会把触发它的导入流程一起带崩）。⚠️ `start()` 必须在两个嵌套注入**之后**调用——启动源会加载凭据，先启动会在没有 keychain 时读它，把已登录源报成 anonymous。
- **`sync()`** — `wanted = sources.filter(r => r.enabled && isInterpretable(r.doc))`。⚠️ `isInterpretable` 是关键守卫：scanner 会给 `local` 写一条**无规则的行**，不加守卫会注册出第二个 provider 与真身竞争。文档没变的行**保留 fiber**（保住温热的 cookie jar）；`docHash` 变了才 replace；单个源启动失败只 warn 不连坐。
- **`startOne(record)`** — 每源生命周期核心：
  1. `ctx.isolate('http')` —— **每源一个 fiber、一个隔离的 HTTP 栈**：两个同型后端互相看不到对方的 cookie，一个慢源不会拖住另一个源；
  2. `intercept('http', { scopeId, allowedHosts })` —— 把通配 `net:host/*` 收窄到文档声明的 hosts；
  3. 构造 `DocumentSource`，挂 `auth.onStatusChange`（expired → emit `source/auth-expired`：过期是**事件不是错误**，源保持注册、缓存目录仍可浏览）；
  4. `sources.register(this.reporting(provider))` —— disposer 包在本地闭包里（穿过 service proxy 的不是 fiber 收集的那个）；`source.dispose()` 释放 realm（一个没人能回收的 WASM 分配）。
- **`reporting(provider)`** — 包装 `getTrack`/`resolveStream`，捕获 `RuleError` 上报后重抛。按 `sourceId\0block.field` 在 60s 窗口内合并去重（一百首队列里一条烂规则 = 一个事实而不是一百个事件）。
- **凭据的落点由 key 决定** — `secretKeysFor(sourceId)` = `{'var'} ∪ doc.loginUi[].id` 写入 `ctx.secrets`（OS keychain）；没有 `ctx.secrets` 的构建**拒绝存储凭据**而不是降级写进明文的 `source_vars`。非凭据值走 `ctx.sources.writeVar`，内存镜像保证 `src.vars.get` 同步可用。
- **`forget(sourceId, scoped)`** — sign-out 的真正实现：**三个存储全部尝试**（cookie jar、secrets namespace、source_vars），任何失败都收集、最后汇总抛错——后两个存储里是密码本身，因第一个失败就停下会把用户留在看不见的登录态里。
- **`trackPayload`/`albumPayload`** — 只读 SQL 取 `tracks.raw_json`/`albums.raw_json`（表名是调用点的字面量，绝不出自输入）。

### `src/source.ts` — 一份文档 → 一个 MediaProvider（1851 行）

**`DocumentSource`**（导出）与内部的 `DocumentAuth`：

- **`DocumentAuth`** — flow 由文档推导，优先级：`loginUi` 非空 → `form`（**表单优先于 variableComment**——给双字段登录呈现单行变量框是没人能完成的屏幕）；否则 `variableComment` → `variable`；否则 `none`。`status` 是**派生的不是快照的**（检查每个声明字段是否已存）——构造时快照会在持久化变量加载前读取，每次重启都把已登录源报成 anonymous。`refresh()` 单飞合并并发 401 风暴，一旦 expired 就不再尝试（`signIn` 是唯一清除者）——对 401 一切的后端重试循环是打向用户自己服务器的 credential-stuffing。
- **`DocumentSource`** — 构造器**不求值任何规则**（构造期求值曾让整个插件 FAILED、所有源每次启动都不可用）。
  - **realm 管理**：`js` 适配器把 `@js:` 体包成 async 箭头（既接受表达式也接受带 `return` 的多语句体）。**realm 每源一个、生命周期 = 源的生命周期**（`jsLib` 和 `src.cache` 是文档积累的状态）；**中毒的 realm 被替换而不是复用**——`ctx.js` 对超限的 realm 会退役它，复用死 realm 意味着一次超时永久砖化该源。
  - **能力派生 getter**（`searchable`/`browsable`/`albumable`/`lyricable`）：两段式——文档描述了它 **且** 本构建能跑其规则（`rulesRunnable`；URL 模板不当规则 parse，`{{source.url}}/x` 会被推断成 CSS 选择器）。
  - **`search(query, page)`** — `searchUrl` 经 `evaluateUrlTemplate`（URL 模板不是选择器，`=` 可省）→ `parseUrlObject` 拆 URL+options → `assertAllowed` → `withReauth(fetchChecked)` → `evaluateListRule` → `rowToTrack`。payload（后端原始元素 ∪ 规则求值字段，规则胜出）随结果返回，由 `ctx.sources` 写进 `raw_json`。`hasMore = tracks.length > 0`（后端很少说总数，编造 total 产生会撒谎的进度条）。
  - **`browse(nodeId?, page?)`** — 三段式（explore → ruleExplore → ruleTrackList）：阶段由 node id 携带而非推断；节点 id 自包含（base64url，重启后导航栈恢复仍可用）；有 `childUrl` = 有地方可去，无 = 可以播放。
  - **`getAlbum(id)`** — `childUrl` 来自 browse 存的 payload（没有则报"browse 到它一次"，不是"没有这张专辑"）；`ruleAlbum.trackListUrl` 存在时歌曲在另一个文档里。
  - **`getLyrics(id)`** — 对 **track 的存储 payload** 求值（为歌词重新跑一次搜索是荒谬的）；规则产出 URL → 抓回歌词，否则产物就是歌词；格式 `lrc|ttml|plain` 或嗅探 `[mm:ss.xx]`。
  - **`resolveStream(id, prefs)`** — URN 变成字节的一刻。scope 的 `track.id` 由调用者的值**最后铺开**（存储 payload 里的 id 不能顶掉要解析的那首）。`ruleStream.url` 求值 → **`assertAllowed(target)`**——这是唯一离开本包、由 `ctx.audio` 在 scoped http 之外直接抓取的产物，没有这一查 egress allowlist 管不住真正搬运字节的请求。`seekable` 未声明时 `probe()`：HEAD 看 `Accept-Ranges`，状态码细拆（405/501=可播、404/410=NotFound、401/403=Auth、429=RateLimit、≥500=Network）——把所有状态塌成 NotFound 曾制造三个谎言。其余可选字段（`mimeType`/`byteLength`/`expiresAt`/`bitrateKbps`/`quality`/`headers`）逐一 `renderOptional`，其中 **`quality` 必须是 `STREAM_QUALITIES` 之一**——文档报了一个不是档位的值会让下游无法比较，所以抛 `RuleError` 而不是丢弃。
  - **`login()`** — 文档自己写请求体（form/JSON），会话落在源自己的 cookie jar；所有失败归一为 `AuthError`（调用者的问题只有"凭据行不行"）。
  - **`withReauth`** — `AuthError` 且 form 流 → refresh 一次后重试，**只重试一次**；`fetchChecked` 跑 `doc.loginCheckJs`——没有 HTTP 状态能可靠表达"服务器又开始回登录页了"。
  - **`debug(step)`** — tracer 入口；`secrets()` 给出强脱敏名单（`var` 及其按 `:` 拆分的两半 + loginUi 各字段值——trace 是会被贴到论坛求援的东西）。

### `src/fetch.ts` — 抓取规则求值所需的文档

- **`parseUrlObject(rendered)`** — legado 的"URL 对象"语法 `URL,{"method":"POST","body":"q={{key}}"}`；切在**第一个后面跟着可解析 JSON 对象的逗号**上（URL 和 body 里都可能有逗号）；options blob 坏了整串当 URL。
- **`fetchDocument(...)`** — 组装请求 → `withRetries` → 按内容类型 parse：自称 JSON 但 parse 失败回落为文本（"自称为 JSON 的 HTML 错误页"很常见）。返回 `{ value, text, baseUrl（重定向后）, status }`。
- **`withRetries`** — 只重试 `isRetryable` 的失败；退避 `100·2^(i-1)` 封顶 2000ms；**服务器自己的 `Retry-After` 享受更高天花板（60s）**——把 4 秒的等待钳到 2 秒等于保证再次被拒。
- **`statusError(status, …)`** — 状态码 → 错误类，与 probe 共用一张映射：**状态码不是诊断**（401 读成 not-found 会跳过重登路径，500 读成不可重试会把一个 blip 变成停掉的队列）。
- **`decode(response, charset)`** — charset 存在时用 `TextDecoder(charset)`：legado 源大量是 GBK/Big5 的中文站点，无条件按 UTF-8 解是无声的乱码页。
- Cookie 不在本文件处理——jar 属于 `ctx.http`（per-plugin 持久 jar）；sign-out 由 runtime 的 `forget` 清。

### `src/capabilities.ts` — 从文档推导能力

**核心原则："Nothing is declared."** 一个源能做什么，跟着它含有哪些规则块走；**存在但为空的块算不存在**（空块是写了一半的文档）。

- **`hasRules(block)`** — 块存在且至少一个值非空白。
- **`isInterpretable(doc)`** — 任一规则块有规则，或 `searchUrl`/`exploreUrl` 存在（守卫 scanner 写的无规则 `local` 行）。
- **`capabilitiesFor(doc, opts)`** — `opts` 由 `DocumentSource` 的 getter 算好（能力为真 = 文档描述了它 且 构建跑得动）。映射：`search.albums/artists/playlists` 恒 false（诚实答案是不猜）；**没有 `albums` 能力标志**——`getAlbum` 的存在就是信号；`streaming.seekable` 来自文档或服务器的 `Accept-Ranges`（不能 range 的流不能 seek，UI 收起拖动条）；`urlExpiry` = `ruleStream.expiresAt` 存在即信号；`rateLimit = parseRate(doc.concurrentRate)`（`'3/1000'` → `{ requests: 3, windowMs: 1000 }`）。

### `src/host.ts` — `src`：源文档能看到的全部宿主面

docs/06 §8 的清单即契约：**没有 `fetch`、没有 `require`、没有活得比调用久的 timer、没有文件系统**。"一段粘贴的字符串能做什么"的答案可以靠读一个文件回答。

- **`createSourceHost(deps)`** — 返回 `{ cache, functions }`；`functions` 是 `__src_*` 命名的平铺函数，逐个 `realm.expose`——跨界的是"一次调用 + 一个克隆值"，绝不是宿主对象图。
- 两个承重性质：
  1. **`src.get`/`src.post` 走源自己的 scoped HTTP**，内部先 `assertAllowed`——egress allowlist 对**脚本算出来的 URL** 与模板渲染的 URL 一视同仁，绕过它沙箱就是中间有洞的隔离故事；
  2. **`src.vars` 是凭据级的**：per-source、永不导出、sign-out 清除。
- **`SourceCache`** — 内存、TTL 有界、256 条上限 + 淘汰最老——"没有天花板的缓存是顶着友好名字的泄漏"。
- **`SRC_SHIM`** — realm 侧脚本（先于任何 `jsLib` preload）：组装冻结的 `globalThis.src`：`get/post`、`parse.json`（`html`/`xml` **故意缺席**且调用时抛清晰错误）、`crypto`（md5/sha1/sha256/hmac/base64/randomHex）、`cache.get/put`、`vars.get/put`、`url.encode/decode/resolve`、`time.now`、`log`。

### `src/list-rule.ts` — 列表规则求值

- **两段式**：`trackList` 选出重复元素（保留对象）；其余每个字段对其中一个元素求值，`{{item}}` 在 scope 里命名它。
- 字段规则 `parseRule` **每页一次**而不是每字段每行一次（50 行 × 8 字段曾 parse 400 遍）。
- **三种"没取到"分开计数、绝不吞掉**（`ListRowsResult`）：`dropped`（缺必需字段或求值抛错的行——丢弃而非半成品入库）、`duplicates`（同页重复 trackId 会变成一个 URN 悄悄覆盖前者）、`incomplete`（**可选**字段失败——行保留、字段缺席；失败 ≠ 匹配为空，但对可选字段答案相同：不加）。空白即缺席（`"  "` 会产出打不回来的 URN）。
- **`rowToTrack`** — 显式类型收敛；`coerceDuration` 接受 `213`/`"3:33"`/`"213.4s"`，其余抛 `RuleError`——把 NaN 写进目录，很久之后才会以"拖动条不动"的形式浮现。返回 plain record 而非 `Track`——URN 命名空间是调用方的事。
- `RuleSyntaxError` 必须在此边界包成 `RuleError`（带 block/field/sourceId），否则它穿过所有按 `code` 分支的处理器。

### `src/trace.ts` — 规则追踪器

烂掉的源"可修复"而非"仅损坏"的原因（等价于 legado 的源调试屏，docs/06 §10）。三个承重性质：

1. **流式而非收集**——最需要解释的步骤是**还在跑的**那一步（向已停止应答的服务器的请求显示为一条无 status 的 `http` 行，这就是全部诊断）；
2. **所有步骤都出现，包括成功的**——失败通常发生在空结果之前两步；
3. **默认脱敏**——Subsonic URL 按惯例带密码 hash 和 salt。

- **`TraceCollector`** — 手写异步队列：push 永不阻塞（慢读者不能拖慢被 trace 的运行）；close 清空缓冲再结束迭代（不丢最后的事件）。`rule`/`error`/`result` 入口都经 `redactForTrace`；preview 截 400 字符。
- **`tracedHttp(http, collector)`** — 包装 `HttpService`，每请求一行（status/ms/bytes；body 只能被调用者消费一次，所以 bytes 取 `content-length` 头）；**失败时也发一行 `status: 0`** 再重抛。

## 信任模型与 allowlist 的执行点

源是**粘贴的字符串**，不是第一方代码。沙箱（`ctx.js` QuickJS）**约束的是 reach，不是 intent**——没有 ambient globals、值克隆跨界、限额由引擎执行。allowlist 三层纵深防御：

| 执行点 | 位置 | 管住什么 |
|---|---|---|
| `assertAllowed` | `DocumentSource` 内每次抓取前（含 `resolveStream` 的流 URL） | 模板渲染出的每一个 URL |
| `allowedHosts` intercept | 隔离的 `ctx.http` 内部（waterfall 前后都校验） | 实际发出的每个 HTTP 请求 |
| `src.get`/`src.post` 内 `assertAllowed` | `host.ts` | **脚本计算出的 URL** |

**凭据永不进文档**：`var` 与 `loginUi` 字段进 `ctx.secrets`，导出文档天然可分享。

## 配置

```ts
export interface SourceRuntimeConfig {
  defaultRate?: string  // 已声明、尚未消费——应用于文档未写 concurrentRate 的源（M2 接线）
}
```

## 事件

| 方向 | 事件 |
|---|---|
| 消费 | `source/imported`（→ sync）、`source/changed`（→ reload）、`source/removed`（→ stop） |
| 发出 | `source/rule-failed`（60s 合并窗口）、`source/auth-expired`（serial） |

## 导出

```ts
export const name = 'plugin-source-runtime'
export const inject = ['http', 'db', 'sources']
export interface SourceRuntimeConfig { defaultRate?: string }
export class SourceRuntime              // start / useJs / useSecrets
export class DocumentSource             // provider() / search / browse / getAlbum / getLyrics / resolveStream / ping / debug / dispose
export { capabilitiesFor, isInterpretable, parseRate }
export async function apply(ctx, config?)
export default { name, inject, apply }
```

## 相关文档

- `docs/06-music-sources.md`：源文档、规则语言、信任、调试
- `packages/feature/source-rules/README.md`：纯逻辑规则引擎
- `packages/core/core-js-quickjs-*`：`ctx.js` 沙箱
