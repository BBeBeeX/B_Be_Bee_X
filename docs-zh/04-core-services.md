# 04 —— 核心服务

> **本篇回答什么。** 平台抽象层：功能插件可用来触达外部世界的每一个服务键、它的
> TypeScript 契约、它在各目标平台上的实现，以及两个平台真正存在差异的地方。

这些是通向沙箱之外的唯一出口。如果某个功能需要这里未列出的东西，正确答案是新增一个核心服务 —— 而绝不是直接导入平台 SDK
（[02 §1](./02-architecture.md#the-invariant)）。

所有接口都位于 `packages/protocol/src/services/`，并通过模块扩充（module augmentation）应用到 Context 上。实现位于
`packages/core-*`，它们是唯一持有平台依赖的代码。

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
  /** Named cookie jar. Provider instances get their own via ctx.isolate('http'). */
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
（[02 §5](./02-architecture.md#5-composition-how-features-reach-each-other)）。

### 2.1 Cookie 罐

一个已登录的音源必须在应用重启后保持登录状态
（[06 §4.1](./06-music-sources.md#41-session-persistence--cookies-survive-the-app)）。因此
cookie 持久化是平台契约的一部分，而不是每个提供方各自重新实现的东西。

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
| 静态保护 | 存在系统钥匙串时，Chromium 用它加密存储 | **信封加密（envelope encryption）**：随机 AES 密钥放 `ctx.secrets`，密文放 `cookie_jars` 表（[07 §4.1](./07-data-model.md#41-providers-accounts-and-sessions)） |
| 清除 | `session.clearStorageData({ storages: ['cookies'] })` + 移除分区 | 删除该行，并从 `ctx.secrets` 删除密钥 |

> ⚠️ **为什么移动端不直接把 jar 放进 `ctx.secrets`。** `expo-secure-store` 对单个值的上限是
> **2048 字节**，而一个真实的会话 jar —— 若干条带长签名值的 cookie —— 动辄超出。跨 key 分块
> 在部分写入下非常脆弱。信封加密让秘密保持很小（一个密钥）而载荷不受限，同时保住了
> "数据库里绝不出现可读凭据"这一不变式。

> ⚠️ React Native 的 `fetch` 在两个平台上都用**应用全局共享**的原生 cookie 存储。这与按实例
> 隔离的需求恰好相反，因此 `core-http-rn` 禁用了它，自行管理 `Cookie` / `Set-Cookie` 请求头。
> 每次 RN 升级都要复核这一点：这里的默认行为一变，cookie 就会在提供方实例之间静默串漏，
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
  `store` 读取配置（[02 §3](./02-architecture.md#3-boot-sequence)）。让移动端的 store 依赖
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

选择 `node:sqlite` 消除了 Electron 项目中最恼人的一项维护负担 ——
每次版本升级都要针对 Electron 头文件重编译 `better-sqlite3`。两个平台都支持 FTS5，因此本地曲库搜索只需一份实现
（[07 §4.3](./07-data-model.md#43-catalogue)）。

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

**令牌只存放在这里，别无他处。** 绝不进 `ctx.db`，绝不进配置文件，也绝不进任何一行日志。每个提供方实例拿到的是
`ctx.secrets.namespace(instanceId)`，且能力语法中不存在 `secrets:all`
（[03 §7](./03-plugin-system.md#7-capability-model)）。

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

让 [02 §4](./02-architecture.md#4-what-background-means) 落地的服务。

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
（[07 §4.7](./07-data-model.md#48-downloads)）依靠它来拦停蜂窝网络下的传输。

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

`openAuthSession` 让 OAuth PKCE 在 [06 §4](./06-music-sources.md#4-authentication)
中的行为完全一致：移动端用 `expo-web-browser` 的 auth session，桌面端用一个带导航监听器的 `BrowserWindow`。

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
增加的是**传输端（transport）**，每一个都是普通插件：

| 插件 | 行为 |
|---|---|
| `plugin-log-console` | 仅开发环境。带插件作用域前缀的 `console.*` |
| `plugin-log-file` | `ctx.paths.logs` 下的滚动 NDJSON 文件，按大小与时长封顶 |
| `plugin-log-buffer` | 内存环形缓冲区（默认 2000 条），支撑应用内日志查看器 |
| `plugin-log-crash` | 遇到未处理的 rejection 时，把最近的缓冲条目连同设备信息打包成文件，供用户附加到问题报告。自身绝不主动上传任何东西 |

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
> 上的查询字符串。音源插件动辄把凭据放进请求头；一份即将被用户发出去的日志文件绝不能包含它们。

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

---

## 18. 契约测试

每个核心服务都附带一个**共享一致性测试套件**，位于
`packages/protocol/src/conformance/`，以函数形式导出，入参是一个服务工厂。每份实现都要跑它 ——
`core-fs-node` 在 Node 下用 Vitest 跑，`core-fs-expo` 在真实模拟器上以 Detox/设备测试的方式跑。

```ts
// packages/core-fs-node/test/conformance.test.ts
import { fsConformance } from '@BBeBee/protocol/conformance'
fsConformance(() => createNodeFs(testHarness()))
```

抽象就是这样保持诚实的。没有它，`ctx.fs` 的两份实现不出一个月就会漂移，而每一次漂移都会变成某个功能插件里无缘无故的平台专属
bug。这套套件就是本文档的可执行形式。

---

## 19. 下一步阅读

[05 —— 音频与播放](./05-audio-playback.md) 在这些服务之上构建播放引擎与 DSP 效果链。
