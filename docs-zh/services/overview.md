# 核心能力服务总览与设计原则

> **历史章节映射：** 原 `docs-zh/04-core-services.md §0 – §1`。

> **本篇回答什么。** [02 §1](../architecture/layers.md#1-分层模型) 的 **第 2 层**：功能插件可用来触达
> 外部世界的每一个服务键、它的 TypeScript 契约、它在各目标平台上的实现，以及两个平台真正存在
> 差异的地方。

这些是通向沙箱之外的唯一出口。核心插件是唯一被允许直接调用平台 SDK 或内核引导面（bootstrap surface）的一层，而这份特权正是它们存在的全部理由：它们把*这台机器的* API 转换成一份契约，让第 3、4、5 层只需对着它写一次。如果某个功能需要这里未列出的东西，正确答案是新增一个核心服务 —— 而绝不是直接导入平台 SDK
（[02 §1](../architecture/layers.md#不变量)）。

这份特权的代价是：核心插件**不持有任何领域知识**。`ctx.fs` 搬运字节，`ctx.db` 跑 SQL；两者都不知道"曲目"是什么。一项长出了功能插件层概念的核心服务，就是把接缝放错了高度，而症状永远相同 —— 两份实现不再可以互换。

所有接口都位于 `packages/protocol/src/services/`，并通过模块扩充（module augmentation）应用到 Context 上。实现位于
`packages/core-*`，它们是唯一持有平台依赖的代码。

> §§1–16 是按读者遇见的顺序排列的服务。§§17–18 是横切的部分：每份实现都必须满足的运行时要求，
> 以及让同一个键的两份实现保持诚实的一致性测试套件。**§19 —— `ctx.js`** 采用追加而非插入，
> 因为它随
> [ADR-5](../architecture/overview.md#adr-5--音源是导入的字符串由一个运行时解释)
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
> 扫描器（[06](../sources/spec.md)）正是针对 `list`/`stat` 编写的，因此对此毫不在意。

---

