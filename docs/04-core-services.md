# 04 — Core Services

> **What this answers.** The platform abstraction layer: every service key a feature plugin may
> use to touch the outside world, its TypeScript contract, its implementation on each target, and
> the places where the two platforms genuinely differ.

These are the only doors out of the sandbox. If a feature needs something not listed here, the
answer is to add a core service — never to import a platform SDK
([02 §1](./02-architecture.md#the-invariant)).

All interfaces live in `packages/protocol/src/services/` and are applied to the context by module
augmentation. Implementations live in `packages/core-*` and are the sole holders of platform
dependencies.

---

## 0. Shared types

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

## 1. `ctx.fs` — virtual filesystem

**Purpose.** Read, write, enumerate, and stream bytes, without any plugin knowing what a path
looks like on the host.

The central idea is that plugins never handle absolute paths. They ask for a well-known directory
and resolve relative to it, producing opaque `Uri` values. This is what makes the same code work
against `file:///Users/x/Library/…`, `content://com.android.externalstorage/…`, and Expo's
sandboxed document directory.

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
| Backing | `node:fs/promises` in `main`, streamed over IPC | `expo-file-system` `File` / `Directory` classes |
| `dir('music')` | `app.getPath('music')` | ⚠️ No equivalent — returns `null` and callers must fall back to `pickDirectory()` |
| `watch` | `fs.watch`, reliable | ⚠️ Not supported. Resolves to a no-op disposer; the scanner falls back to polling `mtime` |
| `pickDirectory` | `dialog.showOpenDialog` | Storage Access Framework (Android) / document picker (iOS) |

> ⚠️ **The biggest leak in the whole abstraction.** On Android, a user-picked folder is a
> `content://` SAF tree URI, not a path: it cannot be handed to a native audio decoder, and its
> permission must be persisted across restarts. `core-fs-expo` persists the grant and exposes
> `fs.toPlayableUri(uri)` used by `ctx.audio`; on iOS and desktop that is the identity function.
> The scanner ([06](./06-music-sources.md)) is written against `list`/`stat` precisely so it does
> not care.

---

## 2. `ctx.http` — outbound HTTP

**Purpose.** A `fetch`-shaped client that is *not* subject to browser rules.

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
| Backing | Electron `net` module in `main`, streamed to the renderer | React Native `fetch` / `XMLHttpRequest` |
| CORS | Bypassed entirely — this is the reason it routes through `main` | Not applicable on native |
| Arbitrary headers | ✅ `Origin`, `Referer`, `User-Agent`, `Cookie` all settable | ✅ |
| Cookie jar | Chromium `Session` per `persist:` partition | RFC 6265 jar in JS, encrypted at rest |
| Proxy | ✅ System or configured | ⚠️ System proxy only |

`ctx.http` is the canonical `waterfall` interception point. Auth injection, retry, rate limiting,
and response caching are all plugins hooking `http/request` rather than features baked into the
client ([02 §5](./02-architecture.md#5-composition-how-features-reach-each-other)).

### 2.1 Cookie jars

A signed-in music source must stay signed in across restarts
([06 §4.1](./06-music-sources.md#41-session-persistence--cookies-survive-the-app)). Cookie
persistence is therefore part of the platform contract rather than something each provider
reimplements.

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

Semantics both implementations must satisfy — the shared conformance suite (§18) tests each one:

- A jar is **automatically applied**. Requests made through an `ctx.isolate('http')` scope send
  that scope's cookies and store `Set-Cookie` responses without the caller doing anything.
- `ready` resolves after rehydration. Requests issued before it are queued, never sent bare.
- **Expired cookies are dropped at load**, not replayed.
- `clear()` removes the persisted copy, not just the in-memory one.
- Jars are isolated: writes in one are invisible to another.

| | Electron (`core-http-node`) | Expo (`core-http-rn`) |
|---|---|---|
| Storage | `session.fromPartition('persist:BBeBee-<name>')` — Chromium's own cookie store, on disk, with correct expiry/`Secure`/`SameSite` handling for free | RFC 6265 jar in JS, serialised to JSON |
| At rest | Chromium encrypts the store with the OS keychain where one exists | **Envelope encryption**: a random AES key in `ctx.secrets`, ciphertext in the `cookie_jars` table ([07 §4.1](./07-data-model.md#41-providers-accounts-and-sessions)) |
| Clearing | `session.clearStorageData({ storages: ['cookies'] })` + partition removal | Row deleted, key deleted from `ctx.secrets` |

> ⚠️ **Why mobile does not simply put the jar in `ctx.secrets`.** `expo-secure-store` caps a value
> at **2048 bytes**, and a real session jar — several cookies with long signed values — exceeds
> that routinely. Chunking across keys is fragile under partial writes. Envelope encryption keeps
> the secret small (one key) and the payload unbounded, while preserving the invariant that the
> database never holds a readable credential.

> ⚠️ React Native's `fetch` uses a **shared, app-global** native cookie store on both platforms.
> That is the opposite of what per-instance isolation needs, so `core-http-rn` disables it and
> manages `Cookie` / `Set-Cookie` headers itself. Verify this per RN upgrade: a change in the
> default here silently leaks cookies between provider instances, which the conformance suite's
> isolation test is there to catch.

---

## 3. `ctx.ws` — WebSocket

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

Electron uses `ws` in `main` (which, unlike the renderer's `WebSocket`, can set headers — required
by several music backends). React Native uses its built-in `WebSocket`, which also supports
headers. Reconnection with backoff is a *consumer* concern, not built in.

---

## 4. `ctx.store` — namespaced key/value

For small, frequently read settings. Not for anything you would want to query.

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

**One implementation serves both platforms** — `core-store-fs`, a JSON document written through
`ctx.fs` with a temp-then-rename so a crash mid-write leaves the previous store intact rather than
a truncated one.

This revises the original plan (a JSON file on desktop, a `kv` table in the app database on
mobile), for two reasons found while building it:

- **Boot order.** `ctx.store` comes up *before* `ctx.db` — the kernel reads configuration through
  `fs` and `store` before a database exists ([02 §3](./02-architecture.md#3-boot-sequence)).
  A mobile store backed by `db` would invert that.
- **Nothing platform-specific was left.** Once it goes through `ctx.fs`, the two implementations
  were the same code twice, which is drift surface for no benefit.

The size ceiling that ruled out `AsyncStorage` does not apply to a plain file. `await store.set()`
resolves only once the write has landed when `flushDelayMs` is 0; with a batch window it returns
immediately and the pending batch is flushed by the plugin's disposer.

A corrupt store is quarantined (renamed aside) and the app starts with an empty one: settings are
recoverable, an unbootable app is not.

---

## 5. `ctx.db` — SQL

The workhorse. Everything in [07](./07-data-model.md) lives here.

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
| Backing | **`node:sqlite`** — ships with Node 22+, which Electron 44 bundles. No native rebuild, no `@electron/rebuild` on every upgrade | `expo-sqlite` |
| WAL | ✅ Enabled | ✅ Enabled |
| Concurrency | Serialized through the `main` host | Serialized in the native module |
| FTS5 | ✅ Available | ✅ Available |

Choosing `node:sqlite` removes the single most annoying maintenance burden in Electron projects —
recompiling `better-sqlite3` against Electron headers on every version bump. Both platforms expose
FTS5, so local library search is one implementation
([07 §4.3](./07-data-model.md#43-catalogue)).

---

## 6. `ctx.secrets` — credential storage

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

Electron: `safeStorage.encryptString` (Keychain / DPAPI / libsecret) with ciphertext in a file
under `userData`. Expo: `expo-secure-store` (Keychain / EncryptedSharedPreferences).

> ⚠️ On Linux without a running secret service, `safeStorage` falls back to plaintext.
> `isHardwareBacked` reports `false` and the UI says so rather than implying safety it lacks.

**Tokens live here and nowhere else.** Never in `ctx.db`, never in the config file, never in a log
line. Each provider instance gets `ctx.secrets.namespace(instanceId)`, and the capability grammar
has no `secrets:all` ([03 §7](./03-plugin-system.md#7-capability-model)).

---

## 7. `ctx.mediaSession` — now playing & transport controls

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
| Backing | Chromium's `navigator.mediaSession`, plus MPRIS (Linux), SMTC (Windows), and the macOS Now Playing centre via `main` | `react-native-audio-api`'s notification/lock-screen controls |
| Lock screen artwork | ✅ | ✅ — must be a local `Uri`; remote artwork is cached first |

---

## 8. `ctx.notify` — user notifications

```ts
export interface NotifyService {
  show(n: { id?: string; title: string; body?: string; iconUri?: Uri; silent?: boolean }): Promise<string>
  dismiss(id: string): Promise<void>
  onActivated(cb: (id: string) => void): Disposable
  requestPermission(): Promise<'granted' | 'denied'>
}
```

Electron `Notification` (no permission prompt) versus `expo-notifications` (permission required on
both platforms; callers must handle `denied` without breaking).

---

## 9. `ctx.background` — long work and wake locks

The service that makes [02 §4](./02-architecture.md#4-what-background-means) actionable.

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

Electron: `powerSaveBlocker` plus plain intervals; `canRunInBackground()` is `true`.
Expo: `expo-background-task` plus the audio session; `canRunInBackground()` is `true` only while
audio holds the process.

---

## 10. `ctx.paths` — well-known locations

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

Trivial, but having it as a service is what lets `ctx.fs` stay path-agnostic.

---

## 11. `ctx.device` — environment and input

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

`network().metered` is load-bearing: the download policy engine
([07 §4.7](./07-data-model.md#48-downloads)) uses it to hold cellular transfers.

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

`node:crypto` versus `expo-crypto`. `md5` is present only because the Subsonic API's auth scheme
requires it; it is not used for anything security-bearing.

---

## 13. `ctx.codec` — decoding and metadata

The bridge between bytes on disk and something the audio engine can use.

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

Electron: `music-metadata` in `main` for tags; Web Audio `decodeAudioData` for PCM.
Expo: `react-native-audio-api`'s `AudioDecoder` for PCM plus a native tag reader.

> ⚠️ `supportedFormats()` differs by platform and OS version. FLAC, ALAC, Opus, and DSD coverage
> is not uniform. The scanner records what it could not decode instead of silently skipping, so the
> user can see why a file did not import.

---

## 14. `ctx.shell` — leaving the app

```ts
export interface ShellService {
  openExternal(url: string): Promise<void>
  revealInFileManager(uri: Uri): Promise<void>   // no-op on mobile
  share(content: { uri?: Uri; text?: string; title?: string }): Promise<void>
  /** OAuth: opens a browser and resolves on redirect to the registered scheme. */
  openAuthSession(url: string, redirectUri: string): Promise<{ url: string } | { cancelled: true }>
}
```

`openAuthSession` is what makes OAuth PKCE work identically in
[06 §4](./06-music-sources.md#4-authentication): `expo-web-browser`'s auth session on mobile, a
`BrowserWindow` with a navigation listener on desktop.

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

One implementation, shared. Locale detection comes from `ctx.device.locale`.

---

## 16. `ctx.logger` — logging as transport plugins

Cordis provides `ctx.logger` itself, already scoped per plugin, so BBeBee does not define a logging
service. What it adds is **transports**, each an ordinary plugin:

| Plugin | Behaviour |
|---|---|
| `plugin-log-console` | Dev only. `console.*` with plugin-scoped prefixes |
| `plugin-log-file` | Rotating NDJSON under `ctx.paths.logs`, size- and age-capped |
| `plugin-log-buffer` | In-memory ring buffer (default 2000 entries) backing the in-app log viewer |
| `plugin-log-crash` | On an unhandled rejection, bundles recent buffer entries plus device info into a file the user may attach to a report. Never uploads anything on its own |

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

> ⚠️ **Redaction is mandatory.** Transports run a redactor over `meta` and `message` that strips
> anything keyed `token`, `password`, `authorization`, `cookie`, or `refresh_token`, and rewrites
> query strings on URLs. Music-source plugins put credentials in headers routinely; a log file
> the user is about to email must not contain them.

---

## 17. Runtime compatibility checklist

Concrete things that must be configured for Cordis and these services to run on Hermes and in a
sandboxed renderer. Each has bitten real projects.

| Concern | Requirement |
|---|---|
| **ESM + `exports` maps** | `cordis` is `"type": "module"` with an `exports` map. Metro needs `unstable_enablePackageExports: true` in `metro.config.js`. Vite handles it natively |
| **`Proxy` and `Symbol.for`** | Cordis's DI is built on them. Hermes supports both; do not enable any Proxy-stripping transform |
| **Standard decorators** | `@Inject` is a **2023-11 standard decorator**, not the legacy form. TS: `"target": "ES2022"` with no `experimentalDecorators`. Babel: `@babel/plugin-proposal-decorators` with `{ version: '2023-11' }` |
| **`AggregateError`** | Thrown by `ctx.parallel()` when listeners reject. Present in current Hermes; keep a polyfill in the mobile entry if the RN version is bumped downward |
| **`Symbol.asyncIterator`** | Used by async effect cleanup. Ensure the Babel preset does not downlevel it away |
| **Node builtins** | `cordis` imports none. If a dependency of a *core* plugin does, it belongs in `main`, not the renderer, and never in the mobile bundle |
| **`ReadableStream` / `WritableStream`** | Used by `ctx.fs` and `ctx.http`. Available in the renderer; on RN 0.86 verify presence and polyfill with `web-streams-polyfill` in the mobile entry if absent |
| **`structuredClone`** | Used by the desktop IPC bridge. Available in Electron; not needed on mobile |

---

## 18. Contract tests

Every core service ships with a **shared conformance suite** in
`packages/protocol/src/conformance/`, exported as a function taking a service factory. Each
implementation runs it — `core-fs-node` under Vitest in Node, `core-fs-expo` under a Detox/device
test on a real simulator.

```ts
// packages/core-fs-node/test/conformance.test.ts
import { fsConformance } from '@BBeBee/protocol/conformance'
fsConformance(() => createNodeFs(testHarness()))
```

This is how the abstraction stays honest. Without it, the two implementations of `ctx.fs` drift
within a month, and every drift becomes a platform-specific bug in a feature plugin that did
nothing wrong. The suite is the executable form of this document.

---

## 19. Where to go next

[05 — Audio & Playback](./05-audio-playback.md) builds the playback engine and DSP chain on top of
these services.
