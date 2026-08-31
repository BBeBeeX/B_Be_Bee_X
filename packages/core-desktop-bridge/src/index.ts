/**
 * Renderer-side `ctx.fs`, `ctx.db` and `ctx.paths` over the IPC bridge.
 *
 * ADR-3 puts the kernel in the renderer, which is sandboxed — so Node is
 * unreachable there and `core-fs-node` cannot run in-process. These are the
 * "thin IPC clients" docs/02 §2 describes: they add no behaviour, they only
 * forward. The behaviour has exactly one home, in `core-*-node`, running in
 * main.
 *
 * The capability gate applies here as it does anywhere: these services read
 * their interception config and refuse out-of-scope work *before* the call
 * leaves the renderer.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { assertFs, capabilityConfigOf } from '@BBeBee/kernel'
import type { CapabilityConfig } from '@BBeBee/kernel'
import { pluginDirName as pluginDirNameLocal, uriContains } from '@BBeBee/protocol'
import type {
  DbService,
  Disposable,
  FileStat,
  FsService,
  Migration,
  PathsService,
  ReadOptions,
  SqlValue,
  Uri,
  WatchEvent,
  WellKnownDir,
  WriteOptions,
} from '@BBeBee/protocol'
import { requireBridge, type BridgeApi } from './protocol.js'

export * from './protocol.js'

type Scope = 'own' | 'media' | 'cache' | 'downloads' | 'logs' | 'all'

/* ── ctx.paths ─────────────────────────────────────────────────────────── */

/**
 * Paths are fetched once at startup, because `PathsService` promises
 * synchronous access and IPC cannot provide it.
 */
export class PathsBridge extends Service implements PathsService {
  readonly appData: Uri
  readonly cache: Uri
  readonly temp: Uri
  readonly logs: Uri
  readonly downloads: Uri
  readonly music?: Uri

  constructor(ctx: Context, snapshot: Record<string, string | undefined>) {
    super(ctx, 'paths')
    this.appData = snapshot['appData'] ?? ''
    this.cache = snapshot['cache'] ?? ''
    this.temp = snapshot['temp'] ?? ''
    this.logs = snapshot['logs'] ?? ''
    this.downloads = snapshot['downloads'] ?? ''
    if (snapshot['music']) this.music = snapshot['music']
    this.pluginRoot = snapshot['pluginRoot'] ?? `${this.appData}/plugins`
  }

  private readonly pluginRoot: string

  pluginData(pluginId: string): Uri {
    // Must agree with `core-paths-node` exactly, or the fs gate in the
    // renderer would classify a plugin's own directory differently from the
    // host that serves it. The name is computed by the shared helper.
    return `${this.pluginRoot}/${pluginDirNameLocal(pluginId)}`
  }

  get(kind: WellKnownDir): Uri | undefined {
    switch (kind) {
      case 'data':
        return this.appData
      case 'cache':
        return this.cache
      case 'temp':
        return this.temp
      case 'logs':
        return this.logs
      case 'downloads':
        return this.downloads
      case 'music':
        return this.music
      default:
        return undefined
    }
  }
}

/** Ask main for every well-known path. Call once, before `createApp`. */
export async function fetchPaths(bridge: BridgeApi = requireBridge()): Promise<
  Record<string, string | undefined>
> {
  const keys = ['appData', 'cache', 'temp', 'logs', 'downloads', 'music'] as const
  const out: Record<string, string | undefined> = {}
  for (const key of keys) {
    out[key] = (await bridge.call('paths', key, [])) as string | undefined
  }
  out['pluginRoot'] = `${out['appData']}/plugins`
  return out
}

/* ── ctx.fs ────────────────────────────────────────────────────────────── */

export class FsBridge extends Service implements FsService {
  static inject = ['paths']

  /** Main can watch; the bridge simply forwards nothing yet. See below. */
  readonly canWatch = false

  private readonly bridge: BridgeApi

  constructor(ctx: Context) {
    super(ctx, 'fs')
    this.bridge = requireBridge()
  }

  /** Identical classification to `core-fs-node`, so the gate agrees. */
  private scopeOf(uri: Uri, gate: CapabilityConfig | undefined): Scope {
    const paths = this.ctx.paths
    if (uriContains(paths.temp, uri)) return 'cache'
    if (uriContains(paths.cache, uri)) return 'cache'
    if (uriContains(paths.downloads, uri)) return 'downloads'
    if (uriContains(paths.logs, uri)) return 'logs'
    if (paths.music && uriContains(paths.music, uri)) return 'media'
    if (gate) {
      if (uriContains(paths.pluginData(gate.instanceId), uri)) return 'own'
      if (uriContains(paths.appData, uri)) return 'all'
    }
    if (uriContains(paths.appData, uri)) return 'own'
    return 'all'
  }

  /** Refuse in the renderer, before the call crosses IPC. */
  private check(uri: Uri, mode: 'read' | 'write'): void {
    const config = this[Service.resolveConfig]()
    assertFs(config, mode, this.scopeOf(uri, capabilityConfigOf(config)))
  }

  private call<T>(method: string, args: unknown[]): Promise<T> {
    return this.bridge.call('fs', method, args) as Promise<T>
  }

  async dir(kind: WellKnownDir) {
    return this.call<Uri | undefined>('dir', [kind])
  }

  // `join`/`basename`/`extname` are pure string work and synchronous in the
  // contract, so they are computed here rather than round-tripped.
  join(base: Uri, ...segments: string[]): Uri {
    const tail = segments.filter(Boolean).join('/')
    return tail ? `${base.replace(/\/$/, '')}/${tail}` : base
  }
  basename(uri: Uri): string {
    return decodeURIComponent(uri.split('/').pop() ?? '')
  }
  extname(uri: Uri): string {
    const base = this.basename(uri)
    const dot = base.lastIndexOf('.')
    return dot > 0 ? base.slice(dot) : ''
  }

  async exists(uri: Uri) {
    this.check(uri, 'read')
    return this.call<boolean>('exists', [uri])
  }
  async stat(uri: Uri) {
    this.check(uri, 'read')
    return this.call<FileStat>('stat', [uri])
  }
  async list(uri: Uri) {
    this.check(uri, 'read')
    return this.call<FileStat[]>('list', [uri])
  }
  async mkdir(uri: Uri, opts?: { recursive?: boolean }) {
    this.check(uri, 'write')
    await this.call('mkdir', [uri, opts])
  }
  async remove(uri: Uri, opts?: { recursive?: boolean }) {
    this.check(uri, 'write')
    await this.call('remove', [uri, opts])
  }
  async move(from: Uri, to: Uri) {
    this.check(from, 'write')
    this.check(to, 'write')
    await this.call('move', [from, to])
  }
  async copy(from: Uri, to: Uri) {
    this.check(from, 'read')
    this.check(to, 'write')
    await this.call('copy', [from, to])
  }
  async readFile(uri: Uri, opts?: ReadOptions) {
    this.check(uri, 'read')
    // `signal` is a live object and cannot cross IPC; the rest is data.
    return this.call<string>('readFile', [uri, opts ? { encoding: opts.encoding } : undefined])
  }
  async readBytes(uri: Uri) {
    this.check(uri, 'read')
    return this.call<Uint8Array>('readBytes', [uri])
  }
  async writeFile(uri: Uri, data: string | Uint8Array, opts?: WriteOptions) {
    this.check(uri, 'write')
    await this.call('writeFile', [
      uri,
      data,
      opts ? { encoding: opts.encoding, append: opts.append } : undefined,
    ])
  }
  async freeSpace(uri: Uri) {
    this.check(uri, 'read')
    return this.call<number>('freeSpace', [uri])
  }
  async toPlayableUri(uri: Uri) {
    return this.call<Uri>('toPlayableUri', [uri])
  }
  async pickDirectory() {
    return this.call<Uri | undefined>('pickDirectory', [])
  }

  /** Chunked over IPC, so a large file never materialises in one message. */
  createReadStream(uri: Uri, range?: { start: number; end?: number }): ReadableStream<Uint8Array> {
    this.check(uri, 'read')
    const bridge = this.bridge
    let handle: number | undefined
    return new ReadableStream<Uint8Array>({
      async start() {
        handle = await bridge.streamOpen(uri, range)
      },
      async pull(controller) {
        const chunk = await bridge.streamPull(handle!)
        if (chunk === null) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
      },
      async cancel() {
        if (handle !== undefined) await bridge.streamClose(handle)
      },
    })
  }

  /**
   * Buffered, then written in one call.
   *
   * ⚠️ Unlike the read side this is not chunked, so a very large write is held
   * in renderer memory first. M0 has no such writer; the download plugin (M3)
   * will need a chunked counterpart before it lands.
   */
  createWriteStream(uri: Uri, opts?: { append?: boolean }): WritableStream<Uint8Array> {
    this.check(uri, 'write')
    const chunks: Uint8Array[] = []
    const write = (data: Uint8Array) => this.writeFile(uri, data, { append: opts?.append ?? false })
    return new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
      async close() {
        const total = chunks.reduce((n, c) => n + c.length, 0)
        const merged = new Uint8Array(total)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.length
        }
        await write(merged)
      },
    })
  }

  /**
   * ⚠️ Not bridged. `canWatch` is false, so callers poll — the same path the
   * mobile implementation takes. Forwarding watch events would need a push
   * channel, which M0 has no consumer for.
   */
  async watch(_uri: Uri, _cb: (ev: WatchEvent) => void): Promise<Disposable> {
    return () => {}
  }
}

/* ── ctx.db ────────────────────────────────────────────────────────────── */

export class DbBridge extends Service implements DbService {
  private readonly bridge: BridgeApi

  constructor(ctx: Context) {
    super(ctx, 'db')
    this.bridge = requireBridge()
  }

  private call<T>(method: string, args: unknown[], token?: string): Promise<T> {
    return this.bridge.call('db', method, args, token) as Promise<T>
  }

  async query<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) {
    return this.call<T[]>('query', [sql, params])
  }
  async get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) {
    return this.call<T | undefined>('get', [sql, params])
  }
  async exec(sql: string, params: SqlValue[] = []) {
    return this.call<{ changes: number; lastInsertRowid: number }>('exec', [sql, params])
  }
  async defineSchema(namespace: string, migrations: Migration[]) {
    await this.call('defineSchema', [namespace, migrations])
  }

  /**
   * The callback runs in the renderer while the transaction stays open in
   * main, so statements are tagged with a token that routes them into it.
   *
   * The same rule as in-process applies: only calls made through the `tx`
   * argument join the transaction. An unrelated `ctx.db.exec()` sends no
   * token and therefore queues behind it in main.
   */
  async transaction<T>(fn: (tx: DbService) => Promise<T>): Promise<T> {
    const token = await this.bridge.txBegin()
    const view: DbService = {
      query: (sql, params = []) => this.call('query', [sql, params], token),
      get: (sql, params = []) => this.call('get', [sql, params], token),
      exec: (sql, params = []) => this.call('exec', [sql, params], token),
      defineSchema: async (ns, migrations) => {
        await this.call('defineSchema', [ns, migrations], token)
      },
      transaction: <U>(inner: (tx: DbService) => Promise<U>) => inner(view),
    }

    try {
      const result = await fn(view)
      await this.bridge.txEnd(token, true)
      return result
    } catch (error) {
      await this.bridge.txEnd(token, false).catch(() => undefined)
      throw error
    }
  }
}
