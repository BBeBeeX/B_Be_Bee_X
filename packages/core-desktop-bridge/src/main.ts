/**
 * The main-process host.
 *
 * Runs a headless Cordis context holding the real `core-*-node` services, and
 * exposes their methods over IPC. Reusing those services rather than
 * reimplementing the operations here is what keeps a single home for the
 * behaviour — `main` stays a dispatcher.
 *
 * ⚠️ **The renderer is one security domain.** Anything running there can call
 * this bridge directly (`window.BBeBeeBridge.call(...)`), so the per-plugin
 * capability gate in `FsBridge`/`DbBridge` is *advisory within the renderer*:
 * it constrains a cooperating plugin, not code that chooses to bypass it. The
 * limits enforced here are therefore the ones that do not depend on knowing
 * which plugin is calling — a method allowlist, containment to the app's own
 * directories, and a refusal to let SQL reach other files. See
 * docs/02-architecture.md §2 and docs/03-plugin-system.md §7.
 *
 * Imported only by `apps/desktop/main`, never by the renderer.
 */

import { Context } from 'cordis'
import { assertSqlAllowed } from '@BBeBee/kernel'
import { uriContains, type DbService, type FsService, type PathsService } from '@BBeBee/protocol'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { CH, type BridgedService } from './protocol.js'

/**
 * The slice of `ipcMain` this host uses.
 *
 * Structural rather than an `electron` import, so the package stays testable
 * without Electron — and so the surface main exposes is visible in one place.
 * `any` matches Electron's own signature; narrowing it would make `ipcMain`
 * fail to satisfy this interface.
 */
export interface IpcHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
  removeHandler(channel: string): void
}

/** What the host can learn about a caller, when Electron provides it. */
interface CallerLike {
  sender?: {
    id?: number
    once?(event: string, listener: () => void): void
  }
}

export interface HostOptions {
  appName?: string
  /** Electron's `app.getPath`, so the OS answers win over XDG guesswork. */
  resolvePath?: (kind: string) => string | undefined
  databaseFileName?: string
  /** Concurrent chunked reads allowed. Bounds file-descriptor use. */
  maxOpenStreams?: number
  /** How long a renderer-driven transaction may stay open before rollback. */
  transactionIdleMs?: number
}

export interface Host {
  ctx: Context
  dispose(): Promise<void>
}

/**
 * Methods reachable over the bridge, per service.
 *
 * An allowlist, not a denylist: without it, `call('fs', 'constructor', …)` and
 * every inherited `Object.prototype` member are reachable, and the surface
 * main exposes silently grows with any method added to a service.
 */
const ALLOWED: Record<BridgedService, ReadonlySet<string>> = {
  fs: new Set([
    'dir', 'exists', 'stat', 'list', 'mkdir', 'remove', 'move', 'copy',
    'readFile', 'readBytes', 'writeFile', 'freeSpace', 'toPlayableUri', 'pickDirectory',
  ]),
  db: new Set(['query', 'get', 'exec', 'defineSchema']),
  paths: new Set([
    'appData', 'cache', 'temp', 'logs', 'downloads', 'music', 'pluginData', 'get',
  ]),
}

/** fs methods whose leading arguments are Uris that must stay inside the app. */
const URI_ARGS: Record<string, number[]> = {
  exists: [0], stat: [0], list: [0], mkdir: [0], remove: [0],
  move: [0, 1], copy: [0, 1], readFile: [0], readBytes: [0], writeFile: [0],
  freeSpace: [0], toPlayableUri: [0],
}

/*
 * SQL the bridge refuses outright is defined **once**, in the kernel's
 * `assertSqlAllowed`, and shared with the gated path.
 *
 * It used to be a second regex here listing only ATTACH and DETACH, while the
 * kernel's list also carried `VACUUM INTO` — which writes a database file to
 * any path the process can reach. The renderer could call
 * `call('db', 'exec', ["VACUUM INTO '/tmp/x.db'"])` and get exactly the
 * arbitrary-file write that the containment checks here exist to prevent. Two
 * lists drift; one does not.
 */

export async function createHost(ipc: IpcHost, options: HostOptions = {}): Promise<Host> {
  const maxOpenStreams = options.maxOpenStreams ?? 64
  const transactionIdleMs = options.transactionIdleMs ?? 30_000

  const ctx = new Context()
  await ctx.plugin(PathsNode, {
    appName: options.appName ?? 'BBeBee',
    ...(options.resolvePath ? { resolve: options.resolvePath as never } : {}),
  })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: options.databaseFileName ?? 'BBeBee.db' })

  const services: Record<BridgedService, () => FsService | DbService | PathsService> = {
    fs: () => ctx.fs,
    db: () => ctx.db,
    paths: () => ctx.paths,
  }

  /**
   * Every location the app is allowed to touch.
   *
   * Not a per-plugin gate — main cannot tell one renderer caller from another —
   * but it does bound the blast radius to the app's own storage, so a bridge
   * call cannot reach `/etc/passwd` or the user's home directory at large.
   */
  const roots = (): string[] =>
    [
      ctx.paths.appData,
      ctx.paths.cache,
      ctx.paths.temp,
      ctx.paths.logs,
      ctx.paths.downloads,
      ctx.paths.music,
    ].filter((r): r is string => typeof r === 'string' && r.length > 0)

  function assertContained(uri: unknown): void {
    if (typeof uri !== 'string') throw new TypeError('bridge: expected a uri')
    // SAF content:// uris are opaque and are granted by the user picking them.
    if (uri.startsWith('content://')) return
    if (!roots().some((root) => uriContains(root, uri))) {
      throw new Error(`bridge: ${uri} is outside every application directory`)
    }
  }

  /* ── Generic method dispatch ──────────────────────────────────────── */

  ipc.handle(CH.call, async (event: CallerLike, ...rest) => {
    const [service, method, args, token] = rest as unknown as [
      BridgedService,
      string,
      unknown[],
      string | undefined,
    ]
    const target = services[service]?.()
    if (!target) throw new Error(`bridge: unknown service "${service}"`)
    if (!ALLOWED[service].has(method)) {
      throw new Error(`bridge: ${service}.${method} is not callable over the bridge`)
    }

    const callArgs = Array.isArray(args) ? args : []
    if (service === 'fs') {
      for (const index of URI_ARGS[method] ?? []) assertContained(callArgs[index])
    }
    if (service === 'db' && typeof callArgs[0] === 'string') {
      assertSqlAllowed(callArgs[0], 'the bridge')
    }

    // A call carrying a transaction token is routed into that transaction's
    // view rather than the shared service, so it participates in the
    // transaction rather than queuing behind it (see core-db-node).
    if (token) {
      const open = transactions.get(token)
      if (!open) throw new Error(`bridge: unknown transaction "${token}"`)
      open.touch()
      const fn = (open.tx as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`bridge: db has no method "${method}"`)
      return fn.apply(open.tx, callArgs)
    }

    // `paths` is a bag of getters, not methods: a bare property read is the
    // only sensible call shape for it.
    if (service === 'paths' && callArgs.length === 0) {
      const value = (target as unknown as Record<string, unknown>)[method]
      if (typeof value !== 'function') return value
    }

    const fn = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
    if (typeof fn !== 'function') throw new Error(`bridge: ${service} has no method "${method}"`)
    void event
    return fn.apply(target, callArgs)
  })

  /* ── Chunked reads ────────────────────────────────────────────────── */

  let nextHandle = 1
  const readers = new Map<number, ReadableStreamDefaultReader<Uint8Array>>()

  ipc.handle(CH.streamOpen, async (_event, ...rest) => {
    const [uri, range] = rest as unknown as [string, { start: number; end?: number } | undefined]
    assertContained(uri)
    if (readers.size >= maxOpenStreams) {
      // Each open reader holds a file descriptor. A renderer looping
      // streamOpen would otherwise exhaust main's descriptors.
      throw new Error(`bridge: too many open streams (${maxOpenStreams}); close some first`)
    }
    const handle = nextHandle++
    readers.set(handle, ctx.fs.createReadStream(uri, range).getReader())
    return handle
  })

  ipc.handle(CH.streamPull, async (_event, ...rest) => {
    const [handle] = rest as unknown as [number]
    const reader = readers.get(handle)
    if (!reader) throw new Error(`bridge: unknown stream ${handle}`)
    const { done, value } = await reader.read()
    if (done) {
      readers.delete(handle)
      return null
    }
    return value
  })

  ipc.handle(CH.streamClose, async (_event, ...rest) => {
    const [handle] = rest as unknown as [number]
    await readers.get(handle)?.cancel().catch(() => undefined)
    readers.delete(handle)
  })

  /* ── Transactions ─────────────────────────────────────────────────── */

  interface OpenTx {
    tx: DbService
    sessionId: number | undefined
    finish(commit: boolean): void
    touch(): void
  }
  const transactions = new Map<string, OpenTx>()

  /** Roll back and forget every transaction belonging to one renderer. */
  function abortSession(sessionId: number | undefined): void {
    for (const [token, open] of transactions) {
      if (open.sessionId === sessionId) {
        open.finish(false)
        transactions.delete(token)
      }
    }
  }

  ipc.handle(CH.txBegin, async (event: CallerLike) => {
    const sessionId = event?.sender?.id

    // Fail fast rather than deadlock: a second concurrent transaction would
    // queue behind the first, so `started` would never resolve and the
    // renderer would await forever.
    for (const open of transactions.values()) {
      if (open.sessionId === sessionId) {
        throw new Error('bridge: a transaction is already open for this session')
      }
    }

    const token = `tx${nextHandle++}`
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })

    void ctx.db
      .transaction(
        (tx) =>
          new Promise<void>((resolve, reject) => {
            const finish = (commit: boolean) => {
              clearTimeout(idle)
              if (commit) resolve()
              else reject(new Error('rollback'))
            }
            // ⚠️ The transaction is held open by the *renderer*, which may
            // reload, crash, or simply never call txEnd. Main's db queue would
            // then be blocked forever and the app would be unusable until
            // restart — so an unfinished transaction is rolled back.
            let idle = setTimeout(() => {
              transactions.delete(token)
              finish(false)
            }, transactionIdleMs)

            transactions.set(token, {
              tx,
              sessionId,
              finish,
              touch: () => {
                clearTimeout(idle)
                idle = setTimeout(() => {
                  transactions.delete(token)
                  finish(false)
                }, transactionIdleMs)
              },
            })
            started()
          }),
      )
      .catch(() => undefined)
      .finally(() => transactions.delete(token))

    // A renderer reload destroys its WebContents without ever sending txEnd.
    event?.sender?.once?.('destroyed', () => abortSession(sessionId))

    await ready
    return token
  })

  ipc.handle(CH.txEnd, async (_event, ...rest) => {
    const [token, commit] = rest as unknown as [string, boolean]
    const open = transactions.get(token)
    if (!open) throw new Error(`bridge: unknown transaction "${token}"`)
    transactions.delete(token)
    open.finish(commit)
  })

  return {
    ctx,
    async dispose() {
      for (const channel of Object.values(CH)) ipc.removeHandler(channel)
      for (const reader of readers.values()) await reader.cancel().catch(() => undefined)
      readers.clear()
      for (const open of transactions.values()) open.finish(false)
      transactions.clear()
    },
  }
}
