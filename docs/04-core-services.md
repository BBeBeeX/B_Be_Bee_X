# 04 — Core Services

> **What this answers.** **Layer 2** of [02 §1](./02-architecture.md#1-the-layer-model): every
> service key a feature plugin may use to touch the outside world, its TypeScript contract, its
> implementation on each target, and the places where the two platforms genuinely differ.

These are the only doors out of the sandbox. Core plugins are the one layer permitted to call a
platform SDK or the kernel's bootstrap surface directly, and that privilege is the whole reason
they exist: they convert *this machine's* API into a contract that Layers 3, 4 and 5 can be written
against once. If a feature needs something not listed here, the answer is to add a core service —
never to import a platform SDK ([02 §1](./02-architecture.md#the-invariant)).

The price of the privilege is that a core plugin holds **no domain knowledge**. `ctx.fs` moves
bytes and `ctx.db` runs SQL; neither knows what a track is. A core service that grows a concept
from Layer 4 has put the seam at the wrong altitude, and the symptom is always the same — the two
implementations stop being interchangeable.

All interfaces live in `packages/protocol/src/services/` and are applied to the context by module
augmentation. Implementations live in `packages/core/*` and are the sole holders of platform
dependencies.

> §§1–16 are the services in the order a reader meets them. §§17–18 are cross-cutting: the runtime
> requirements every implementation must satisfy, and the conformance suites that keep two
> implementations of one key honest. **§19 — `ctx.js`** is appended rather than inserted because it
> arrived with [ADR-5](./01-overview.md#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime)
> and renumbering a document other documents link into is a worse trade than an out-of-order
> section.

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
| Backing | Electron `net` module in `main`, streamed to the renderer | React Native `fetch` / `XMLHttpRequest` |
| CORS | Bypassed entirely — this is the reason it routes through `main` | Not applicable on native |
| Arbitrary headers | ✅ `Origin`, `Referer`, `User-Agent`, `Cookie` all settable | ✅ |
| Cookie jar | Chromium `Session` per `persist:` partition | RFC 6265 jar in JS, encrypted at rest |
| Proxy | ✅ System or configured | ⚠️ System proxy only |

`ctx.http` is the canonical `waterfall` interception point. Auth injection, retry, rate limiting,
and response caching are all plugins hooking `http/request` rather than features baked into the
client ([02 §5](./02-architecture.md#5-composition-how-features-reach-each-other)).

**A `Referer` header is Chromium's referrer, not an ordinary header.** Electron's `net.fetch` maps
it onto the URLRequest's referrer and validates it against the request's referrer policy before
sending. A main-process request has no document to take that policy from, so the default
`strict-origin-when-cross-origin` computes the origin alone for a cross-origin destination — and
cancels the request outright (`ERR_BLOCKED_BY_CLIENT`, *"with invalid referrer"*) when the header
says more, which is exactly the video-page URL a streaming CDN's hotlink check wants. The desktop
bridge therefore sets `referrerPolicy: 'unsafe-url'` on every bridged request that carries an
explicit `Referer`, so a source sends what it wrote
(`core-desktop-bridge/src/main.ts`).

### 2.1 Cookie jars

A signed-in music source must stay signed in across restarts
([06 §5.1](./06-music-sources.md#51-session-persistence--cookies-survive-the-app)). Cookie
persistence is therefore part of the platform contract rather than something a source document has
to express in rules.

**A jar belongs to one source.** `ctx.http` reads the scope id from the intercept config the
runtime sets per source ([06 §4.1](./06-music-sources.md#41-a-sources-lifetime)), so two Navidrome
servers get two jars and a cookie set by one is never sent to the other. An ungated caller — the
kernel, a core service, a test — has no scope and therefore no jar, which is correct: there is no
session to keep.

**It is envelope-encrypted, and the platform forces that.** `expo-secure-store` caps a value at
2048 bytes and a jar is routinely larger, so a random key goes to `ctx.secrets` and the jar itself
to a file encrypted under it. Losing the key makes the file bytes — which is exactly what
`signOut()` relies on. `ctx.http` adopts `ctx.secrets` on its own when one exists; a shell that had
to wire that by hand is a shell that can forget to, and forgetting produces an app where signing in
appears to work and never sticks. Without a credential store the jars stay in memory and are honest
about forgetting.

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
| At rest | Chromium encrypts the store with the OS keychain where one exists | **Envelope encryption**: a random AES key in `ctx.secrets`, ciphertext in the `cookie_jars` table ([07 §4.1](./07-data-model.md#41-sources-accounts-and-sessions)) |
| Clearing | `session.clearStorageData({ storages: ['cookies'] })` + partition removal | Row deleted, key deleted from `ctx.secrets` |

> ⚠️ **Why mobile does not simply put the jar in `ctx.secrets`.** `expo-secure-store` caps a value
> at **2048 bytes**, and a real session jar — several cookies with long signed values — exceeds
> that routinely. Chunking across keys is fragile under partial writes. Envelope encryption keeps
> the secret small (one key) and the payload unbounded, while preserving the invariant that the
> database never holds a readable credential.

> ⚠️ React Native's `fetch` uses a **shared, app-global** native cookie store on both platforms.
> That is the opposite of what per-instance isolation needs, so `core-http-rn` disables it and
> manages `Cookie` / `Set-Cookie` headers itself. Verify this per RN upgrade: a change in the
> default here silently leaks cookies between sources, which the conformance suite's
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
| Capability gate | ✅ | ✅ |

> ⚠️ **One statement per call.** `query`, `get` and `exec` take a single statement and refuse a
> string holding more than one. This is a contract, not a limitation of one driver: `prepare()`
> compiles the *first* statement and discards the rest **silently**, so
> `exec('CREATE TABLE a; CREATE TABLE b')` used to create `a`, resolve successfully, and leave no
> trace that `b` never happened — and a migration written that way recorded its version as applied
> and drifted the schema permanently, with no error to investigate. Pass statements separately, or
> use `up: string[]` in a migration. Semicolons inside string literals are not boundaries.
>
> The gate is on **both** implementations. `core-db-expo` had none at all for a while — `db:own`
> was enforced on desktop and unenforced on mobile — which is precisely the drift the conformance
> suites in §18 exist to catch, and why the `db-scope` suite must run on device and not only in
> Node.

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
line. Each source gets `ctx.secrets.namespace(sourceId)`, and the capability grammar
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

`openAuthSession` is what makes the `webview` login flow of
[06 §5](./06-music-sources.md#5-authentication-and-session) work identically: `expo-web-browser`'s
auth session on mobile, a `BrowserWindow` with a navigation listener on desktop. The cookies it
collects land in that source's jar (§2.1), which is the whole point.

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
service. What it adds is **transports**, each an ordinary plugin — and together they are
**Layer 3** of [02 §1](./02-architecture.md#1-the-layer-model), `packages/logs/*`:

| Plugin | When it runs | Behaviour |
|---|---|---|
| `plugin-log-buffer` | Always | In-memory ring buffer (default 2000 entries) backing the in-app log viewer. Claims `ctx.logBuffer` |
| `plugin-log-console` | Development only | `console.*` with plugin-scoped prefixes, at debug level. Nobody is watching a terminal in a shipped build |
| `plugin-log-file` | Shipped builds only | Rotating NDJSON under `ctx.paths.logs`, size- and count-capped. The log has to survive the app being closed, which is the case the console cannot cover |
| `plugin-log-crash` | *(not built)* | On an unhandled rejection, bundles recent buffer entries plus device info into a file the user may attach to a report. Never uploads anything on its own |

### Why it is a layer

Three rules follow from putting the transports between the core services and the features, and
each closes a way of getting logging wrong that reads as reasonable at the call site:

- **They load from the shell's `bootstrap:` array, not from the registry.** A transport enabled
  through the config allowlist starts *alongside* the feature plugins, so it misses the first
  lines each of them writes — which are the lines worth having when one of them did not start.
  Bootstrap entries are applied in order and awaited, so after the core services and before the
  first feature plugin is a position that actually exists.
- **Nothing above Layer 3 imports a transport.** `ctx.logger` is the whole interface; which sink
  is behind it is the shell's decision, made once, in `boot.ts`. An import would pin one
  implementation into code whose point is not to know, and would keep it loaded for as long as
  the importer lives.
- **`console.*` is an error above Layer 3.** It is not a smaller version of `ctx.logger`: it skips
  the redactor below, and it reaches neither the ring buffer that the log viewer reads nor the
  file a bug report attaches. The shells are the one exemption, because a boot failure can happen
  before any transport is loaded.

One consequence to be deliberate about: **bootstrap entries are not capability-gated**, so
`plugin-log-file` writes with the shell's own `ctx.fs` rather than through the gate that would
otherwise hold it to the `fs:write:logs` its manifest declares. That is the same bargain the core
services get, and for a related reason — a transport that had to be granted a capability before
it could record anything would have no way to report being refused one. The manifest still
declares the minimum, and it is what an M5 registry-loaded transport would be held to.

`conventions.test.ts` also requires every feature plugin to call `ctx.logger` at all. A plugin
that says nothing is not being tidy — it is the one whose failure arrives as an empty screen with
nothing behind it.

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
> query strings on URLs. Source rules put credentials in headers and query strings routinely, and
> the test screen's trace ([06 §10](./06-music-sources.md#10-diagnosing-a-broken-source)) exists
> to be copied into a forum thread — so the same redactor runs over traces, not only over logs.

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
| **A second JS engine** | `ctx.js` (§19) embeds QuickJS: a WASM build in the renderer, a native module on mobile. It is a native dependency, so mobile needs a dev-client rebuild when it lands, and the WASM asset must be bundled rather than fetched — the CSP forbids fetching it |

---

## 18. Contract tests

Every core service ships with a **shared conformance suite** in
`packages/protocol/src/conformance/`, exported as a function taking a service factory. Each
implementation runs it — `core-fs-node` under Vitest in Node, `core-fs-expo` under a Detox/device
test on a real simulator.

```ts
// packages/core/core-fs-node/test/conformance.test.ts
import { fsConformance } from '@BBeBee/protocol/conformance'
fsConformance(() => createNodeFs(testHarness()))
```

This is how the abstraction stays honest. Without it, the two implementations of `ctx.fs` drift
within a month, and every drift becomes a platform-specific bug in a feature plugin that did
nothing wrong. The suite is the executable form of this document.

---

## 19. `ctx.js` — the sandboxed evaluator

**Purpose.** Evaluate a snippet of untrusted JavaScript and get a value back, in a realm that
shares nothing with the app.

It exists for exactly one caller today: `plugin-source-runtime`, whose rules are written by
strangers ([06 §8](./06-music-sources.md#8-trust-what-an-imported-source-can-and-cannot-do)). It
is a core service rather than part of that plugin because embedding an interpreter means shipping
native code, which only `core-*` may do ([02 §1](./02-architecture.md#the-invariant)).

**Implemented by `core-js-quickjs-node`** (desktop and Node) on QuickJS compiled to WebAssembly.
Not `node:vm`, and the difference is the whole point: `vm` shares an object graph with the host,
so a script reaching `this.constructor.constructor` is out, and every published mitigation for
that is a blocklist someone eventually walks around. QuickJS is a separate interpreter — there is
no host object graph to reach, because there are no host objects in it.

⚠️ **`js` is an optional injection.** A build without a sandbox still runs every document that
needs no scripting, and derives the affected capabilities as *absent* for the rest rather than
offering a button that cannot work. Cordis treats every key in a plugin's own `inject` as
required, so this is expressed as a nested `ctx.inject(['js'], …)` — listing it at the top level
would mean one missing core service takes the whole source runtime down with it.

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
| Backing | `quickjs-emscripten-core` with a single-file WASM variant, embedded in the renderer bundle | A QuickJS JSI module |
| Isolation | A separate WASM instance per realm | A separate `JSRuntime` per realm |
| Interrupts | QuickJS interrupt handler, checked on backward jumps | Same |
| Async | Host functions may return promises; the realm's job queue is driven by the host | Same |

Rules the contract is built around, each of which a naive embedding gets wrong:

- **No ambient globals.** A realm starts with ECMAScript builtins and nothing else — no `fetch`,
  no timers, no `console`, no module loader. Everything a caller wants available must be
  `expose`d by name, which is what makes the host surface in
  [06 §8](./06-music-sources.md#8-trust-what-an-imported-source-can-and-cannot-do) an exhaustive
  list rather than a summary.
- **Values cross by cloning, never by reference.** Nothing inside the realm can retain a live
  object from the host, so it cannot walk the object graph to reach a service — the failure that
  makes same-realm "sandboxes" worthless.
- **Limits are enforced by the engine, not by convention.** A `while (true)` is interrupted, not
  waited on. This is the reason for a second engine rather than a `Worker`: a worker cannot be
  memory-capped and can only be killed, losing the diagnostic.
- **A realm is disposable and cheap.** One per source, disposed with that source's fiber. A leaked
  realm is a leaked native handle, so it is registered through `ctx.effect()` like any other.
- **`engine` is reported** so a rule can branch on it and a trace can record it. Two QuickJS
  builds are not identical, and a source that works on desktop and not on mobile must be
  debuggable rather than mysterious.

> ⚠️ **The sandbox bounds reach, not intent.** Code in a realm still sees everything the host
> passes in and can send it wherever the host's exposed functions allow — which is why the source
> runtime pairs this with a per-source **host allowlist** on `ctx.http`
> ([03 §7](./03-plugin-system.md#capability-grammar)). An evaluator without an egress limit is a
> containment story with a hole in the middle.

---

## 20. Where to go next

[05 — Audio & Playback](./05-audio-playback.md) builds the playback engine and DSP chain on top of
these services.
