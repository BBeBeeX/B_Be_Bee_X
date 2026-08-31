/**
 * The main-process host.
 *
 * Runs a headless Cordis context holding the real `core-*-node` services, and
 * exposes their methods over IPC. Reusing those services rather than
 * reimplementing the operations here is what keeps a single home for the
 * behaviour — `main` stays a dispatcher.
 *
 * Imported only by `apps/desktop/main`, never by the renderer.
 */

import { Context } from 'cordis'
import type { DbService, FsService, PathsService } from '@BBeBee/protocol'
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

export interface HostOptions {
  appName?: string
  /** Electron's `app.getPath`, so the OS answers win over XDG guesswork. */
  resolvePath?: (kind: string) => string | undefined
  databaseFileName?: string
}

export interface Host {
  ctx: Context
  dispose(): Promise<void>
}

/**
 * Stand up the services and wire them to IPC.
 *
 * Every handler is a dispatch. The security boundary is the *service list*:
 * only `fs`, `db` and `paths` are reachable, and only by their own methods.
 */
export async function createHost(ipc: IpcHost, options: HostOptions = {}): Promise<Host> {
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

  /* ── Generic method dispatch ──────────────────────────────────────── */

  ipc.handle(CH.call, async (_event, ...rest) => {
    const [service, method, args, token] = rest as unknown as [
      BridgedService,
      string,
      unknown[],
      string | undefined,
    ]
    const target = services[service]?.()
    if (!target) throw new Error(`bridge: unknown service "${service}"`)

    // A call carrying a transaction token is routed into that transaction's
    // view rather than the shared service, so it participates in the
    // transaction rather than queuing behind it (see core-db-node).
    if (token) {
      const open = transactions.get(token)
      if (!open) throw new Error(`bridge: unknown transaction "${token}"`)
      const fn = (open.tx as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`bridge: db has no method "${method}"`)
      return fn.apply(open.tx, args)
    }

    // `paths` is a bag of getters, not methods: a bare property read is the
    // only sensible call shape for it.
    if (service === 'paths' && args.length === 0) {
      const value = (target as unknown as Record<string, unknown>)[method]
      if (typeof value !== 'function') return value
    }

    const fn = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
    if (typeof fn !== 'function') throw new Error(`bridge: ${service} has no method "${method}"`)
    return fn.apply(target, args)
  })

  /* ── Chunked reads ────────────────────────────────────────────────── */

  let nextHandle = 1
  const readers = new Map<number, ReadableStreamDefaultReader<Uint8Array>>()

  ipc.handle(CH.streamOpen, async (_event, ...rest) => {
    const [uri, range] = rest as unknown as [string, { start: number; end?: number } | undefined]
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
    finish(commit: boolean): void
  }
  const transactions = new Map<string, OpenTx>()

  ipc.handle(CH.txBegin, async () => {
    const token = `tx${nextHandle++}`
    // The renderer drives the transaction body, so main holds it open and
    // waits for an explicit end. `started` resolves once BEGIN has run, so
    // the renderer never issues a tagged call into a transaction that is not
    // yet open.
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })

    void ctx.db
      .transaction(
        (tx) =>
          new Promise<void>((resolve, reject) => {
            transactions.set(token, {
              tx,
              finish: (commit) => (commit ? resolve() : reject(new Error('rollback'))),
            })
            started()
          }),
      )
      .catch(() => undefined)
      .finally(() => transactions.delete(token))

    await ready
    return token
  })

  ipc.handle(CH.txEnd, async (_event, ...rest) => {
    const [token, commit] = rest as unknown as [string, boolean]
    const open = transactions.get(token)
    if (!open) throw new Error(`bridge: unknown transaction "${token}"`)
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
