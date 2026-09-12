# 04 —— 核心服务

> **本篇回答什么。** [02 §1](./02-architecture.md#1-分层模型) 的 **第 2 层**：功能插件可用来触达
> 外部世界的每一个服务键、它的 TypeScript 契约、它在各目标平台上的实现，以及两个平台真正存在
> 差异的地方。

这些是通向沙箱之外的唯一出口。核心插件是唯一被允许直接调用平台 SDK 或内核引导面（bootstrap surface）的一层，而这份特权正是它们存在的全部理由：它们把*这台机器的* API 转换成一份契约，让第 3、4、5 层只需对着它写一次。如果某个功能需要这里未列出的东西，正确答案是新增一个核心服务 —— 而绝不是直接导入平台 SDK
（[02 §1](./02-architecture.md#不变量)）。

这份特权的代价是：核心插件**不持有任何领域知识**。`ctx.fs` 搬运字节，`ctx.db` 跑 SQL；两者都不知道"曲目"是什么。一项长出了功能插件层概念的核心服务，就是把接缝放错了高度，而症状永远相同 —— 两份实现不再可以互换。

所有接口都位于 `packages/protocol/src/services/`，并通过模块扩充（module augmentation）应用到 Context 上。实现位于
`packages/core-*`，它们是唯一持有平台依赖的代码。

> §§1–16 是按读者遇见的顺序排列的服务。§§17–18 是横切的部分：每份实现都必须满足的运行时要求，
> 以及让同一个键的两份实现保持诚实的一致性测试套件。**§19 —— `ctx.js`** 采用追加而非插入，
> 因为它随
> [ADR-5](./01-overview.md#adr-5--音源是导入的字符串由一个运行时解释)
> 而来，而给一份被其他文档链接的文档重新编号，其代价高于一节顺序错乱。

---

## 0. 共享类型

```ts
/** An abstract URI. Never a raw filesystem path — see §1. */
export type Uri = string

export interface Disposable { (): void }

export type WellKnownDir =
  | 'data'      // app-private, backed up, survives updates
  | 'cache'     // app-private, OS may delete under pressure
  | 'temp'      // scratch, deleted aggressively
  | 'music'     // user's music library (may be unavailable)
  | 'downloads' // where downloaded media lands
  | 'logs'

export class CapabilityError extends Error {
  constructor(public capability: string, message?: string) { super(message ?? capability) }
}
```

---

## 1. `ctx.fs` —— 虚拟文件系统

**用途。** 读取、写入、枚举与流式传输字节，而任何插件都不必知道宿主机上的路径长什么样。

核心思想是：插件从不处理绝对路径。它们请求一个众所周知的目录（well-known directory），并相对于它进行解析，得到不透明的
`Uri` 值。正是这一点，让同一份代码可以同时工作于 `file:///Users/x/Library/…`、
`content://com.android.externalstorage/…` 以及 Expo 的沙箱化文档目录。

```ts
export interface FileStat {
  uri: Uri
  name: string
  isDirectory: boolean
  size: number
  mtime: number          // epoch ms
  mimeType?: string
}

export interface ReadOptions { encoding?: 'utf8' | 'base64'; signal?: AbortSignal }
export interface WriteOptions { encoding?: 'utf8' | 'base64'; append?: boolean; signal?: AbortSignal }

export interface FsService {
  /** Resolve a well-known directory to a Uri. Throws if unavailable on this platform. */
  dir(kind: WellKnownDir): Promise<Uri>
  /** Join path segments onto a Uri. The only correct way to build a child Uri. */
  join(base: Uri, ...segments: string[]): Uri
  basename(uri: Uri): string
  extname(uri: Uri): string

  exists(uri: Uri): Promise<boolean>
  stat(uri: Uri): Promise<FileStat>
  list(uri: Uri): Promise<FileStat[]>
  mkdir(uri: Uri, opts?: { recursive?: boolean }): Promise<void>
  remove(uri: Uri, opts?: { recursive?: boolean }): Promise<void>
  move(from: Uri, to: Uri): Promise<void>
  copy(from: Uri, to: Uri): Promise<void>

  readFile(uri: Uri, opts?: ReadOptions): Promise<string>
  readBytes(uri: Uri, opts?: { signal?: AbortSignal }): Promise<Uint8Array>
  writeFile(uri: Uri, data: string | Uint8Array, opts?: WriteOptions): Promise<void>

  /** Streaming, for files too large to hold in memory (audio, artwork batches). */
  createReadStream(uri: Uri, range?: { start: number; end?: number }): ReadableStream<Uint8Array>
  createWriteStream(uri: Uri, opts?: { append?: boolean }): WritableStream<Uint8Array>

  /** Free space at a location, for download quota decisions. */
  freeSpace(uri: Uri): Promise<number>

  /** Watch a directory. Resolution and reliability vary sharply — see below. */
  watch(uri: Uri, cb: (ev: { type: 'add' | 'change' | 'unlink'; uri: Uri }) => void): Promise<Disposable>

  /** Ask the user to pick a folder, returning a Uri with durable permission. */
  pickDirectory(): Promise<Uri | null>
}
```

| | Electron (`core-fs-node`) | Expo (`core-fs-expo`) |
|---|---|---|
| 底层实现 | `node:fs/promises` 运行在 `main`，经 IPC 流式传输 | `expo-file-system` 的 `File` / `Directory` 类 |
| `dir('music')` | `app.getPath('music')` | ⚠️ 无对应物 —— 返回 `null`，调用方必须回退到 `pickDirectory()` |
| `watch` | `fs.watch`，可靠 | ⚠️ 不支持。解析为一个空操作 disposer；扫描器回退为轮询 `mtime` |
| `pickDirectory` | `dialog.showOpenDialog` | Storage Access Framework（Android）/ document picker（iOS） |

> ⚠️ **整个抽象中最大的泄漏点。** 在 Android 上，用户选择的文件夹是一个
> `content://` SAF 树 URI，而不是路径：它无法交给原生音频解码器，且其权限必须在重启之后仍然保留。
> `core-fs-expo` 会持久化该授权，并暴露 `fs.toPlayableUri(uri)` 供 `ctx.audio` 使用；在 iOS 与桌面端，它就是恒等函数。
> 扫描器（[06](./06-music-sources.md)）正是针对 `list`/`stat` 编写的，因此对此毫不在意。

---

## 2. `ctx.http` —— 出站 HTTP

**用途。** 一个形如 `fetch` 的客户端，但*不受*浏览器规则约束。

```ts
export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH'
  headers?: Record<string, string>
  body?: string | Uint8Array | FormData
  signal?: AbortSignal
  timeoutMs?: number
  redirect?: 'follow' | 'manual' | 'error'
  /** Named cookie jar. Each music source gets its own via ctx.isolate('http'). */
  jar?: string
  onProgress?: (loaded: number, total?: number) => void
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  url: string                       // after redirects
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  bytes(): Promise<Uint8Array>
  stream(): ReadableStream<Uint8Array>
}

export interface HttpService {
  (req: HttpRequest): Promise<HttpResponse>
  get<T>(url: string, init?: Omit<HttpRequest, 'url' | 'method'>): Promise<T>
  post<T>(url: string, body: unknown, init?: Omit<HttpRequest, 'url' | 'method' | 'body'>): Promise<T>
  /** Download to a Uri with resume support. Used by plugin-download. */
  download(req: HttpRequest & { to: Uri; resumeFrom?: number }): Promise<{ bytes: number; etag?: string }>
  /** Persistent per-instance cookie jars. See §2.1. */
  readonly cookies: CookieJarService
}
```

| | Electron (`core-http-node`) | Expo (`core-http-rn`) |
|---|---|---|
| 底层实现 | Electron `net` 模块运行在 `main`，流式传给渲染进程 | React Native `fetch` / `XMLHttpRequest` |
| CORS | 完全绕过 —— 这正是它要经过 `main` 的原因 | 原生端不适用 |
| 任意请求头 | ✅ `Origin`、`Referer`、`User-Agent`、`Cookie` 均可设置 | ✅ |
| Cookie jar | 每个 `persist:` 分区对应一个 Chromium `Session` | JS 实现的 RFC 6265 jar，静态加密 |
| 代理 | ✅ 系统代理或配置的代理 | ⚠️ 仅系统代理 |

`ctx.http` 是标准的瀑布（waterfall）拦截点。鉴权注入、重试、限速与响应缓存，全都是挂接
`http/request` 钩子的插件，而不是内建在客户端里的特性
（[02 §5](./02-architecture.md#5-组合功能之间如何触达彼此)）。

### 2.1 Cookie 罐

一个已登录的音源必须在应用重启后保持登录状态
（[06 §5.1](./06-music-sources.md#51-会话持久化--cookie-在应用关闭后依然存活)）。因此
cookie 持久化是平台契约的一部分，而不是每份音源文档要在规则里自行表达的东西。

**一个罐只属于一个源。** `ctx.http` 从运行时为每个源设置的拦截配置中读取 scope id
（[06 §4.1](./06-music-sources.md#41-一个源的生命周期)），因此两台 Navidrome 服务器得到两个罐，
其中一个设置的 cookie 绝不会被发给另一个。不经门控的调用方 —— 内核、一项核心服务、一个测试 ——
没有作用域，因此也没有罐，而这正是正确的：本就不存在要维持的会话。

**它经过信封加密，而且平台强制这一点。** `expo-secure-store` 对单个值的上限是 2048 字节，而一个
jar 动辄更大，因此一个随机密钥放 `ctx.secrets`，jar 本身则存为在该密钥之下加密的一个文件。密钥
一旦丢失，文件的字节也就随之失效 —— 这正是 `signOut()` 所依赖的机制。只要存在 `ctx.secrets`，
`ctx.http` 就会自行采用它；一个需要手工接线的壳，就是一个可能忘记接线的壳，而忘记的结果，是一
个登录看似成功、却永远存不住的应用。没有凭据存储时，各罐留在内存里，并诚实地说出自己会遗忘。

```ts
export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch ms. Absent means a session cookie — dropped when the jar is cleared. */
  expiresAt?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

export interface CookieJar {
  readonly name: string
  /** Resolves once the persisted jar has been loaded. Await before the first request. */
  readonly ready: Promise<void>
  get(url: string): Promise<Cookie[]>
  set(cookies: Cookie[]): Promise<void>
  /** All cookies, for export or inspection. Never logged. */
  all(): Promise<Cookie[]>
  remove(name: string, domain?: string): Promise<void>
  /** Empties the jar AND deletes its persisted copy. Called by signOut(). */
  clear(): Promise<void>
}

export interface CookieJarService {
  /** Returns the named jar, creating and rehydrating it on first access. */
  jar(name: string): CookieJar
  /** Forget a jar entirely, including its stored bytes. */
  destroy(name: string): Promise<void>
  list(): Promise<string[]>
}
```

两份实现都必须满足的语义 —— 共享一致性测试套件（§18）会逐条测试：

- cookie 罐是**自动生效**的。经 `ctx.isolate('http')` 作用域发出的请求会带上该作用域的
  cookie，并存储响应中的 `Set-Cookie`，调用方无需做任何事。
- `ready` 在回灌（rehydrate）完成后 resolve。在它之前发出的请求会被排队，绝不会裸发。
- **过期 cookie 在加载时被丢弃**，而不是照单重放。
- `clear()` 删除的是持久化副本，而不仅仅是内存中的那份。
- 各罐相互隔离：一个罐中的写入对另一个罐不可见。

| | Electron (`core-http-node`) | Expo (`core-http-rn`) |
|---|---|---|
| 存储 | `session.fromPartition('persist:BBeBee-<name>')` —— Chromium 自带的 cookie 存储，直接落盘，过期/`Secure`/`SameSite` 处理白拿 | JS 实现的 RFC 6265 jar，序列化为 JSON |
| 静态保护 | 存在系统钥匙串时，Chromium 用它加密存储 | **信封加密（envelope encryption）**：随机 AES 密钥放 `ctx.secrets`，密文放 `cookie_jars` 表（[07 §4.1](./07-data-model.md#41-音源账号与会话)） |
| 清除 | `session.clearStorageData({ storages: ['cookies'] })` + 移除分区 | 删除该行，并从 `ctx.secrets` 删除密钥 |

> ⚠️ **为什么移动端不直接把 jar 放进 `ctx.secrets`。** `expo-secure-store` 对单个值的上限是
> **2048 字节**，而一个真实的会话 jar —— 若干条带长签名值的 cookie —— 动辄超出。跨 key 分块
> 在部分写入下非常脆弱。信封加密让秘密保持很小（一个密钥）而载荷不受限，同时保住了
> "数据库里绝不出现可读凭据"这一不变式。

> ⚠️ React Native 的 `fetch` 在两个平台上都用**应用全局共享**的原生 cookie 存储。这与按实例
> 隔离的需求恰好相反，因此 `core-http-rn` 禁用了它，自行管理 `Cookie` / `Set-Cookie` 请求头。
> 每次 RN 升级都要复核这一点：这里的默认行为一变，cookie 就会在音源之间静默串漏，
> 一致性测试套件中的隔离测试正是为此而设。

---

## 3. `ctx.ws` —— WebSocket

```ts
export interface WsConnection {
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  readonly readyState: 0 | 1 | 2 | 3
}

export interface WsService {
  connect(url: string, opts?: {
    protocols?: string[]
    headers?: Record<string, string>
    onMessage?: (data: string | Uint8Array) => void
    onClose?: (code: number, reason: string) => void
    onError?: (err: Error) => void
  }): WsConnection
}
```

Electron 在 `main` 中使用 `ws`（与渲染进程的 `WebSocket` 不同，它可以设置请求头 —— 若干音源后端有此要求）。React
Native 使用内建的 `WebSocket`，它同样支持请求头。带退避的重连是*使用方*的职责，并未内建。

---

## 4. `ctx.store` —— 带命名空间的键值存储

用于小体积、频繁读取的设置。不适合任何需要查询的东西。

```ts
export interface StoreService {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  /** A view confined to a prefix. Plugins receive a pre-namespaced store. */
  namespace(ns: string): StoreService
}
```

**一份实现同时服务两个平台** —— `core-store-fs`：经 `ctx.fs` 写入的一个 JSON 文档，采用
"先写临时文件再改名"（temp-then-rename），写一半崩溃时留下的是完好的旧存储，而不是截断的。

这修订了最初的计划（桌面用 JSON 文件、移动端用应用数据库里的 `kv` 表），理由是构建时发现的
两点：

- **启动顺序。** `ctx.store` 比 `ctx.db` *先*就绪 —— 内核在数据库存在之前就要经 `fs` 和
  `store` 读取配置（[02 §3](./02-architecture.md#3-启动顺序)）。让移动端的 store 依赖
  `db` 会把这条顺序倒过来。
- **平台特有的东西已经不剩什么了。** 一旦走 `ctx.fs`，两份实现就是同一份代码抄两遍，
  只会平白增加漂移面。

当初排除 `AsyncStorage` 的大小上限问题对普通文件并不成立。`flushDelayMs` 为 0 时，
`await store.set()` 只在写入真正落盘后才 resolve；设了批量窗口则立即返回，未落盘的批次
由插件的 disposer 冲刷。

损坏的 store 会被隔离（改名挪到一旁），应用以空 store 启动：设置是可以重建的，无法启动的
应用不行。

---

## 5. `ctx.db` —— SQL

主力服务。[07](./07-data-model.md) 中的所有内容都存放在这里。

```ts
export type SqlValue = string | number | null | Uint8Array

export interface DbService {
  query<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | undefined>
  exec(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowid: number }>
  transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T>

  /**
   * Register a plugin-owned schema. Tables are prefixed with the namespace,
   * migrations are versioned per namespace, and everything is dropped if the
   * plugin is uninstalled with "remove data" selected. See 07 §6.
   */
  defineSchema(namespace: string, migrations: Migration[]): Promise<void>
}

export interface Migration {
  version: number
  up: string | string[]
  /** Optional; the project is forward-only, so this exists only for dev. */
  down?: string | string[]
}
```

| | Electron (`core-db-node`) | Expo (`core-db-expo`) |
|---|---|---|
| 底层实现 | **`node:sqlite`** —— 随 Node 22+ 一起提供，Electron 44 内置该版本。无需原生重编译，每次升级也不必跑 `@electron/rebuild` | `expo-sqlite` |
| WAL | ✅ 已启用 | ✅ 已启用 |
| 并发 | 经由 `main` 宿主串行化 | 在原生模块中串行化 |
| FTS5 | ✅ 可用 | ✅ 可用 |
| 能力门 | ✅ | ✅ |

> ⚠️ **每次调用一条语句。** `query`、`get` 与 `exec` 只接受单条语句，并拒绝包含多条的字符串。
> 这是契约，不是某个驱动的局限：`prepare()` 会编译*第一条*语句并**静默**丢弃其余的，因此
> `exec('CREATE TABLE a; CREATE TABLE b')` 曾经创建了 `a`、成功 resolve、不留任何 `b` 从未
> 发生的痕迹 —— 而一份如此编写的迁移把它的版本记为已应用，schema 从此永久漂移，也没有任何
> 错误可查。请分开传语句，或在迁移中使用 `up: string[]`。字符串字面量内部的分号不是边界。
>
> 这道门在**两份**实现上都有。`core-db-expo` 曾有一段时间完全没有 —— `db:own` 在桌面端被
> 强制、在移动端不设防 —— 这恰恰是 §18 的一致性测试套件要抓的漂移，也是 `db-scope` 套件必须
> 在真机、而不仅是在 Node 里跑的原因。

选择 `node:sqlite` 消除了 Electron 项目中最恼人的一项维护负担 ——
每次版本升级都要针对 Electron 头文件重编译 `better-sqlite3`。两个平台都支持 FTS5，因此本地曲库搜索只需一份实现
（[07 §4.3](./07-data-model.md#43-目录catalogue)）。

---

## 6. `ctx.secrets` —— 凭据存储

```ts
export interface SecretsService {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  namespace(ns: string): SecretsService
  /** False when no OS keychain is available; callers may warn the user. */
  readonly isHardwareBacked: boolean
}
```

Electron：`safeStorage.encryptString`（Keychain / DPAPI / libsecret），密文存放在 `userData`
下的文件中。Expo：`expo-secure-store`（Keychain / EncryptedSharedPreferences）。

> ⚠️ 在没有运行密钥服务的 Linux 上，`safeStorage` 会退化为明文。
> `isHardwareBacked` 会报告 `false`，UI 也会如实说明，而不是虚张声势。

**令牌只存放在这里，别无他处。** 绝不进 `ctx.db`，绝不进配置文件，也绝不进任何一行日志。每个音源拿到的是
`ctx.secrets.namespace(sourceId)`，且能力语法中不存在 `secrets:all`
（[03 §7](./03-plugin-system.md#7-能力模型)）。

---

## 7. `ctx.mediaSession` —— 正在播放与播放控制

```ts
export interface NowPlaying {
  title: string
  artist?: string
  album?: string
  artworkUri?: Uri
  durationMs?: number
  positionMs?: number
  playbackRate?: number
}

export type TransportCommand =
  | { type: 'play' } | { type: 'pause' } | { type: 'stop' }
  | { type: 'next' } | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'seek-relative'; deltaMs: number }
  | { type: 'rate'; loved: boolean }

export interface MediaSessionService {
  update(np: NowPlaying): void
  setPlaybackState(state: 'playing' | 'paused' | 'stopped'): void
  onCommand(cb: (cmd: TransportCommand) => void): Disposable
  /** Which commands the OS surface will actually display. */
  setSupportedCommands(types: TransportCommand['type'][]): void
  clear(): void
}
```

| | Electron (`core-media-session-electron`) | Expo (`core-media-session-rn`) |
|---|---|---|
| 底层实现 | Chromium 的 `navigator.mediaSession`，外加 MPRIS（Linux）、SMTC（Windows）以及 macOS "正在播放"中心，均经 `main` | `react-native-audio-api` 的通知/锁屏控制 |
| 锁屏封面 | ✅ | ✅ —— 必须是本地 `Uri`；远程封面需先缓存 |

---

## 8. `ctx.notify` —— 用户通知

```ts
export interface NotifyService {
  show(n: { id?: string; title: string; body?: string; iconUri?: Uri; silent?: boolean }): Promise<string>
  dismiss(id: string): Promise<void>
  onActivated(cb: (id: string) => void): Disposable
  requestPermission(): Promise<'granted' | 'denied'>
}
```

Electron 的 `Notification`（无需权限请求）对上 `expo-notifications`（两个平台都需要权限；调用方必须能优雅处理
`denied`，不能因此崩溃）。

---

## 9. `ctx.background` —— 长时任务与唤醒锁

让 [02 §4](./02-architecture.md#4-后台意味着什么) 落地的服务。

```ts
export interface BackgroundService {
  /** True when work may continue with the app not in the foreground. */
  canRunInBackground(): boolean
  /** Keep the process alive for foreground-ish work. Release promptly. */
  acquireWakeLock(reason: string): Promise<Disposable>
  /**
   * Register deferrable periodic work. On mobile this is the OS scheduler:
   * `intervalMinutes` is a *hint*, and a run may be hours late or skipped.
   */
  schedule(id: string, intervalMinutes: number, task: () => Promise<void>): Promise<Disposable>
  /** Fires before the host suspends. Checkpoint here. */
  onWillSuspend(cb: () => void | Promise<void>): Disposable
}
```

Electron：`powerSaveBlocker` 加上普通的定时器；`canRunInBackground()` 恒为 `true`。
Expo：`expo-background-task` 加上音频会话；只有在音频持有进程时 `canRunInBackground()` 才为 `true`。

---

## 10. `ctx.paths` —— 众所周知的位置

```ts
export interface PathsService {
  appData: Uri
  cache: Uri
  temp: Uri
  logs: Uri
  downloads: Uri
  /** Undefined where the platform has no shared music folder (iOS). */
  music?: Uri
  pluginData(pluginId: string): Uri
}
```

看似简单，但正是把它做成一项服务，`ctx.fs` 才能做到与路径无关。

---

## 11. `ctx.device` —— 环境与输入

```ts
export interface DeviceService {
  readonly platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux'
  readonly formFactor: 'phone' | 'tablet' | 'desktop'
  readonly appVersion: string
  readonly locale: string

  network(): Promise<{ online: boolean; type: 'wifi' | 'cellular' | 'ethernet' | 'none'; metered: boolean }>
  onNetworkChange(cb: (s: { online: boolean; metered: boolean }) => void): Disposable

  battery(): Promise<{ level: number; charging: boolean } | undefined>

  /** Desktop only; resolves to a no-op disposer on mobile. */
  onMediaKey(cb: (key: 'play-pause' | 'next' | 'previous' | 'stop') => void): Disposable
  registerHotkey(accelerator: string, cb: () => void): Disposable
}
```

`network().metered` 承载着关键逻辑：下载策略引擎
（[07 §4.7](./07-data-model.md#48-下载)）依靠它来拦停蜂窝网络下的传输。

---

## 12. `ctx.crypto`

```ts
export interface CryptoService {
  randomBytes(n: number): Uint8Array
  randomUUID(): string
  digest(algo: 'sha1' | 'sha256' | 'md5', data: Uint8Array | string): Promise<Uint8Array>
  hmac(algo: 'sha1' | 'sha256', key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array>
  /** Streaming digest for verifying large downloads without buffering. */
  digestStream(algo: 'sha256', stream: ReadableStream<Uint8Array>): Promise<Uint8Array>
}
```

`node:crypto` 对上 `expo-crypto`。`md5` 之所以存在，只是因为 Subsonic API
的认证方案需要它；它不用于任何涉及安全性的用途。

---

## 13. `ctx.codec` —— 解码与元数据

连接磁盘上的字节与音频引擎可用形式之间的桥梁。

```ts
export interface AudioMetadata {
  title?: string; artist?: string; albumArtist?: string; album?: string
  trackNo?: number; discNo?: number; year?: number; genre?: string[]
  durationMs?: number; bitrateKbps?: number; sampleRate?: number
  channels?: number; bitDepth?: number; codec?: string
  replayGainTrack?: number; replayGainAlbum?: number
  isrc?: string; musicbrainzTrackId?: string
  lyrics?: string
  hasArtwork: boolean
}

export interface CodecService {
  /** Read tags without decoding audio. Must not read the whole file. */
  readMetadata(uri: Uri): Promise<AudioMetadata>
  readArtwork(uri: Uri): Promise<Uint8Array | undefined>
  /** Decode to PCM for waveform rendering, gain analysis, or short samples. */
  decode(data: Uint8Array | Uri): Promise<{ sampleRate: number; channels: number; pcm: Float32Array[] }>
  probeDuration(uri: Uri): Promise<number>
  supportedFormats(): string[]
}
```

Electron：`main` 中用 `music-metadata` 读标签；用 Web Audio 的 `decodeAudioData` 解码 PCM。
Expo：用 `react-native-audio-api` 的 `AudioDecoder` 解码 PCM，外加一个原生标签读取器。

> ⚠️ `supportedFormats()` 随平台与操作系统版本而异。FLAC、ALAC、Opus 与 DSD
> 的覆盖并不一致。扫描器会记录下它无法解码的内容，而不是悄悄跳过，让用户能看明白某个文件为何没有导入。

---

## 14. `ctx.shell` —— 跳出应用

```ts
export interface ShellService {
  openExternal(url: string): Promise<void>
  revealInFileManager(uri: Uri): Promise<void>   // no-op on mobile
  share(content: { uri?: Uri; text?: string; title?: string }): Promise<void>
  /** OAuth: opens a browser and resolves on redirect to the registered scheme. */
  openAuthSession(url: string, redirectUri: string): Promise<{ url: string } | { cancelled: true }>
}
```

`openAuthSession` 让 [06 §5](./06-music-sources.md#5-认证与会话) 的
`webview` 登录流程行为完全一致：移动端用 `expo-web-browser` 的 auth session，桌面端用一个带导航监听器的 `BrowserWindow`。
它收集的 cookie 落进该音源的 jar（§2.1），这正是全部意义所在。

---

## 15. `ctx.i18n`

```ts
export interface I18nService {
  readonly locale: string
  t(key: string, params?: Record<string, string | number>): string
  /** Plugins ship their own catalogues; disposed with the plugin. */
  register(namespace: string, catalogues: Record<string, Record<string, string>>): Disposable
  onLocaleChange(cb: (locale: string) => void): Disposable
}
```

只有一份实现，双方共用。区域检测来自 `ctx.device.locale`。

---

## 16. `ctx.logger` —— 以传输插件形式实现的日志

`ctx.logger` 本身由 Cordis 提供，且已按插件划分作用域，因此 BBeBee 不再定义日志服务。BBeBee
增加的是**传输端（transport）**，每一个都是普通插件 —— 它们合在一起，就是
[02 §1](./02-architecture.md#1-分层模型) 的**第 3 层**，即 `packages/logs/*`：

| 插件 | 何时运行 | 行为 |
|---|---|---|
| `plugin-log-buffer` | 始终运行 | 内存环形缓冲区（默认 2000 条），支撑应用内日志查看器。声明 `ctx.logBuffer` |
| `plugin-log-console` | 仅开发环境 | 带插件作用域前缀的 `console.*`，debug 级别。发布构建里没人盯着终端看 |
| `plugin-log-file` | 仅发布构建 | `ctx.paths.logs` 下的滚动 NDJSON 文件，按大小与条数封顶。日志必须能在应用被关闭之后存活，这正是 console 覆盖不了的场景 |
| `plugin-log-crash` | *（未构建）* | 遇到未处理的 rejection 时，把最近的缓冲条目连同设备信息打包成文件，供用户附加到问题报告。自身绝不主动上传任何东西 |

### 为什么它是一层

把传输端放在核心服务与功能插件之间，会导出三条规则，而每一条都封死了一种在调用点看起来颇为
合理的错误日志写法：

- **它们从外壳的 `bootstrap:` 数组加载，而不是从注册表。** 经配置白名单启用的传输端会与功能
  插件*并肩*启动，因此会错过每个功能插件写下的最初几行 —— 而当某个插件没能启动时，恰恰是
  这些行最有价值。引导条目按序应用并被 await，所以"在核心服务之后、第一个功能插件之前"是一
  个真实存在的位置。
- **第 3 层之上的任何东西都不导入传输端。** `ctx.logger` 就是全部接口；它背后是哪个 sink，
  是外壳一次性地在 `boot.ts` 里做出的决定。一次导入，就会把某一份实现钉进一段其意义恰在于
  不该知道这件事的代码里，并且只要导入者还活着，那份实现就一直被挂着。
- **`console.*` 在第 3 层之上是错误。** 它不是 `ctx.logger` 的缩小版：它跳过下方的脱敏器，
  既到不了日志查看器读取的环形缓冲区，也到不了 bug 报告附带的那个文件。外壳是唯一的豁免，
  因为启动失败可能发生在任何传输端加载之前。

有一点后果需要刻意面对：**引导条目不受能力门约束**，因此 `plugin-log-file` 用外壳自己的
`ctx.fs` 写入，而不经过那道本会把它约束到其清单所声明的 `fs:write:logs` 的门。这与核心服务
拿到的是同一笔交易，理由也相关 —— 一个必须先被授予能力才能记录任何东西的传输端，一旦被拒
绝，就无从报告自己被拒绝了。清单仍然声明最小集合，而那正是将来经 M5 注册表加载的传输端会被
约束到的标准。

`conventions.test.ts` 还要求每个功能插件至少调用一次 `ctx.logger`。一个一言不发的插件并不是
整洁 —— 它正是那种失败时只给你一块空空如也的屏幕、背后什么都没有的插件。

```ts
export interface LogRecord {
  time: number
  level: 'error' | 'warn' | 'info' | 'debug'
  scope: string          // the plugin's name, supplied by Cordis
  message: string
  meta?: Record<string, unknown>
}

export interface LogTransport {
  write(record: LogRecord): void
  flush?(): Promise<void>
}
```

> ⚠️ **脱敏是强制的。** 传输端会对 `meta` 与 `message` 跑一个脱敏器，剔除键名为
> `token`、`password`、`authorization`、`cookie` 或 `refresh_token` 的内容，并重写 URL
> 上的查询字符串。音源规则动辄把凭据放进请求头与查询字符串，而规则追踪器
> （[06 §10](./06-music-sources.md#10-诊断一个坏掉的源)）存在的意义就是被复制进
> 论坛帖子 —— 所以同一个脱敏器也跑在追踪记录上，而不只是日志上。

---

## 17. 运行时兼容性清单

要让 Cordis 与这些服务跑在 Hermes 和沙箱化渲染进程上，必须逐一落实的具体事项。每一项都真实咬伤过项目。

| 关注点 | 要求 |
|---|---|
| **ESM + `exports` 映射** | `cordis` 是 `"type": "module"` 且带 `exports` 映射。Metro 需要在 `metro.config.js` 中设置 `unstable_enablePackageExports: true`。Vite 原生支持 |
| **`Proxy` 与 `Symbol.for`** | Cordis 的 DI 建立在它们之上。Hermes 两者都支持；不要启用任何剥离 Proxy 的转换 |
| **标准装饰器** | `@Inject` 是 **2023-11 标准装饰器**，不是旧式形式。TS：`"target": "ES2022"`，且不启用 `experimentalDecorators`。Babel：`@babel/plugin-proposal-decorators` 配 `{ version: '2023-11' }` |
| **`AggregateError`** | `ctx.parallel()` 在监听器拒绝时抛出。当前 Hermes 已有；若 RN 版本向下调整，需在移动端入口保留 polyfill |
| **`Symbol.asyncIterator`** | 异步 effect 清理会用到。确保 Babel preset 不会把它降级掉 |
| **Node 内建模块** | `cordis` 一个都不导入。如果某个*核心*插件的依赖导入了，那它应属于 `main` 而非渲染进程，且绝不进移动端 bundle |
| **`ReadableStream` / `WritableStream`** | `ctx.fs` 与 `ctx.http` 会用到。渲染进程中可用；RN 0.86 上请验证是否存在，缺失时在移动端入口用 `web-streams-polyfill` 补齐 |
| **`structuredClone`** | 桌面端 IPC 桥接会用到。Electron 中可用；移动端不需要 |
| **第二个 JS 引擎** | `ctx.js`（§19）内嵌 QuickJS：渲染进程中是 WASM 构建，移动端是原生模块。它是原生依赖，因此它落地时移动端需要一次 dev-client 重建；且 WASM 资产必须打进包内而不是在线拉取 —— CSP 禁止拉取它 |

---

## 18. 契约测试

每个核心服务都附带一个**共享一致性测试套件**，位于
`packages/protocol/src/conformance/`，以函数形式导出，入参是一个服务工厂。每份实现都要跑它 ——
`core-fs-node` 在 Node 下用 Vitest 跑，`core-fs-expo` 在真实模拟器上以 Detox/设备测试的方式跑。

```ts
// packages/core/core-fs-node/test/conformance.test.ts
import { fsConformance } from '@BBeBee/protocol/conformance'
fsConformance(() => createNodeFs(testHarness()))
```

抽象就是这样保持诚实的。没有它，`ctx.fs` 的两份实现不出一个月就会漂移，而每一次漂移都会变成某个功能插件里无缘无故的平台专属
bug。这套套件就是本文档的可执行形式。

---

## 19. `ctx.js` —— 沙箱化求值器

**用途。** 求值一段不受信任的 JavaScript 并拿回一个值，所在的 realm 与应用不共享任何东西。

如今它恰好只有一个调用方：`plugin-source-runtime`，其规则出自陌生人之手
（[06 §8](./06-music-sources.md#8-信任导入的源能做什么不能做什么)）。它是
核心服务而不是那个插件的一部分，因为内嵌一个解释器意味着交付原生代码，而只有 `core-*` 可以
这么做（[02 §1](./02-architecture.md#不变量)）。

**由 `core-js-quickjs-node` 实现**（桌面端与 Node），构建于编译成 WebAssembly 的 QuickJS 之上。不是 `node:vm`，而两者的差别正是全部要点：`vm` 与宿主共享一张对象图，脚本一旦够到 `this.constructor.constructor` 就出局了，而已发表的每一种缓解手段，终究是一份早晚有人绕开的黑名单。QuickJS 是一个独立的解释器 —— 里面没有宿主对象图可供够取，因为其中根本不存在宿主对象。

⚠️ **`js` 是一项可选注入。** 没有沙箱的构建依然会运行每一份无需脚本的文档，并就其余文档把受影响的能力推导为*缺席*，而不是提供一个无法工作的按钮。Cordis 把插件自身 `inject` 里的每一个键都当作必需，因此这里表达为一个嵌套的 `ctx.inject(['js'], …)` —— 把它列在顶层，意味着一个缺失的核心服务会把整个源运行时一起拖垮。

```ts
export interface JsRealm {
  /**
   * Evaluate `code` with `scope` bound as globals. Resolves with the completion
   * value, structured-cloned out of the realm — never a live reference into it.
   */
  eval<T = unknown>(code: string, scope?: Record<string, unknown>): Promise<T>
  /** Install a host function callable from inside. Arguments arrive cloned. */
  expose(name: string, fn: (...args: unknown[]) => unknown | Promise<unknown>): Disposable
  /** Evaluate once at realm creation — the source document's `jsLib`. */
  preload(code: string): Promise<void>
  dispose(): void
}

export interface JsLimits {
  /**
   * Wall clock for one uninterrupted stretch of engine execution.
   *
   * ⚠️ Not the whole call. A script that awaits hands control back, and each
   * continuation is a fresh stretch — so this bounds *loops*, which is what it
   * is for. An implementation that armed it only around the initial evaluation
   * leaves every continuation unbounded, which is a freeze rather than a
   * timeout.
   */
  timeoutMs: number
  /** Wall clock for one eval including everything it awaits — 06 §8's "10s with network". */
  budgetMs: number
  /** Heap ceiling. Exceeding it throws JsMemoryError. */
  memoryBytes: number
  /** Cap on the size of a returned value, before cloning. */
  maxResultBytes: number
}

export interface JsService {
  /** A fresh realm with nothing in it but ECMAScript builtins. */
  createRealm(limits: JsLimits): Promise<JsRealm>
  readonly engine: { name: string; version: string }
}

export class JsTimeoutError extends Error {}
export class JsMemoryError extends Error {}
```

| | Electron (`core-js-quickjs-node`) | Expo (`core-js-quickjs-rn`) |
|---|---|---|
| 底层实现 | 渲染进程中的 `quickjs-emscripten`（WASM） | 一个 QuickJS JSI 模块 |
| 隔离 | 每个 realm 一个独立的 WASM 实例 | 每个 realm 一个独立的 `JSRuntime` |
| 中断 | QuickJS 中断处理器，在向后跳转时检查 | 相同 |
| 异步 | 宿主函数可以返回 promise；realm 的作业队列由宿主驱动 | 相同 |

这份契约围绕以下规则建立，每一条都是天真的内嵌方式会搞错的：

- **没有环境全局。** realm 启动时只有 ECMAScript 内建对象，别的什么都没有 —— 没有 `fetch`、
  没有定时器、没有 `console`、没有模块加载器。调用方想让里面可用的每一样东西都必须按名
  `expose`，这正是让
  [06 §8](./06-music-sources.md#8-信任导入的源能做什么不能做什么) 的宿主面
  成为一份穷尽清单而非摘要的原因。
- **值靠克隆跨越，绝不靠引用。** realm 里的任何东西都无法保留来自宿主的活对象，因此它无法
  遍历对象图去够到某个服务 —— 这正是让同 realm "沙箱"一文不值的那个失败点。
- **限制由引擎强制执行，而不是靠约定。** `while (true)` 会被中断，而不是被等待。这正是要
  第二个引擎而不是 `Worker` 的原因：worker 无法设置内存上限，只能被杀掉，诊断信息也随之
  丢失。
- **realm 是可释放且廉价的。** 每个音源一个，随该音源的 fiber 一起释放。泄漏一个 realm 就是
  泄漏一个原生句柄，所以它和其他东西一样通过 `ctx.effect()` 注册。
- **`engine` 会被上报**，规则可以据此分支，追踪也可以记录它。两个 QuickJS 构建并不相同，
  一个在桌面端能跑、在移动端跑不了的音源，必须可调试而不是玄学。

> ⚠️ **沙箱约束的是触达能力，不是意图。** realm 中的代码仍然看得见宿主传入的一切，并且可以
> 把它送到宿主暴露的函数允许的任何地方 —— 这正是音源运行时把它与 `ctx.http` 上按音源的
> **主机白名单**搭配使用的原因
> （[03 §7](./03-plugin-system.md#能力语法)）。一个没有出口限制的求值器，就是一个
> 中间开了洞的遏制故事。

---

## 20. 下一步阅读

[05 —— 音频与播放](./05-audio-playback.md) 在这些服务之上构建播放引擎与 DSP 效果链。
