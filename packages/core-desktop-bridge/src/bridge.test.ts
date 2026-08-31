/**
 * The IPC bridge, end to end, without Electron.
 *
 * A fake `ipcMain`/`ipcRenderer` pair connects the renderer-side services to a
 * real main-side host, and the shared conformance suites run *through* it. If
 * these pass, the claim "the same plugin graph runs on Electron" rests on the
 * bridge actually satisfying the same contracts — not on it having compiled.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { dbConformance, fsConformance, pathsConformance } from '@BBeBee/protocol/conformance'
import { createHost, type IpcHost } from './main.js'
import { DbBridge, FsBridge, PathsBridge, fetchPaths } from './index.js'
import type { BridgeApi } from './protocol.js'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bbebee-bridge-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** An in-process stand-in for `ipcMain` + `ipcRenderer.invoke`. */
function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const host: IpcHost = {
    handle: (channel, listener) => void handlers.set(channel, listener as never),
    removeHandler: (channel) => void handlers.delete(channel),
  }
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    // Structured-clone semantics are what Electron gives; JSON round-tripping
    // would be stricter than reality and would break Uint8Array.
    return handler({}, ...args)
  }
  return { host, invoke }
}

async function makeBridge(dir: string) {
  const { host, invoke } = fakeIpc()

  // Every well-known path is redirected into the scratch directory *before*
  // the host starts — the database is opened during `createHost`, so patching
  // paths afterwards would leave it pointing at the developer's real data
  // directory and share one file across every check.
  const layout: Record<string, string> = {
    userData: join(dir, 'data'),
    cache: join(dir, 'cache'),
    temp: join(dir, 'tmp'),
    logs: join(dir, 'data', 'logs'),
    downloads: join(dir, 'downloads'),
    music: join(dir, 'music'),
  }
  const mainHost = await createHost(host, {
    appName: 'BBeBee',
    resolvePath: (kind) => layout[kind],
  })

  const api: BridgeApi = {
    call: (service, method, args, token) =>
      invoke('BBeBee:call', service, method, args, token) as Promise<unknown>,
    streamOpen: (u, range) => invoke('BBeBee:stream:open', u, range) as Promise<number>,
    streamPull: (handle) => invoke('BBeBee:stream:pull', handle) as Promise<Uint8Array | null>,
    streamClose: (handle) => invoke('BBeBee:stream:close', handle) as Promise<void>,
    txBegin: () => invoke('BBeBee:tx:begin') as Promise<string>,
    txEnd: (token, commit) => invoke('BBeBee:tx:end', token, commit) as Promise<void>,
  }
  ;(globalThis as { window?: unknown }).window = { BBeBeeBridge: api }

  const snapshot = await fetchPaths(api)
  const ctx = new Context()
  await ctx.plugin(PathsBridge, snapshot)
  await ctx.plugin(FsBridge)
  await ctx.plugin(DbBridge)
  return { ctx, mainHost }
}

describe('paths over the bridge', () => {
  for (const check of pathsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const { ctx } = await makeBridge(await mkdtemp(join(root, 'paths-')))
      await check.run({ paths: ctx.paths })
    })
  }
})

describe('fs over the bridge', () => {
  for (const check of fsConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const dir = await mkdtemp(join(root, 'fs-'))
      const { ctx } = await makeBridge(dir)
      // Inside the app's cache root: main refuses any path outside the
      // application's own directories, which is the point of the containment
      // check — a scratch dir elsewhere would be rejected, correctly.
      const cache = await ctx.fs.dir('cache')
      const scratch = pathToFileURL(
        await mkdtemp(join(fileURLToPath(cache!), 'scratch-')),
      ).href.replace(/\/$/, '')
      await check.run({ fs: ctx.fs, scratch })
    })
  }
})

describe('db over the bridge', () => {
  for (const check of dbConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const { ctx } = await makeBridge(await mkdtemp(join(root, 'db-')))
      // The core schema is applied by the host, so these run against a live
      // database rather than an empty one — the checks create their own tables.
      await check.run({ db: ctx.db, reset: async () => undefined })
    })
  }
})

describe('bridge specifics', () => {
  it('reads a large file in chunks rather than one message', async () => {
    const dir = await mkdtemp(join(root, 'chunk-'))
    const { ctx } = await makeBridge(dir)
    const cache = await ctx.fs.dir('cache')
    const scratch = pathToFileURL(
      await mkdtemp(join(fileURLToPath(cache!), 'big-')),
    ).href.replace(/\/$/, '')
    const uri = ctx.fs.join(scratch, 'big.bin')

    const payload = new Uint8Array(200_000).map((_, i) => i % 251)
    await ctx.fs.writeFile(uri, payload)

    const reader = ctx.fs.createReadStream(uri).getReader()
    let chunks = 0
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks++
      total += value.length
    }
    expect(total).toBe(payload.length)
    expect(chunks, 'a large read should arrive in several IPC messages').toBeGreaterThan(1)
  })

  it('a transaction driven from the renderer rolls back in main', async () => {
    // The callback runs on this side while the transaction stays open in the
    // host — the part of the bridge most likely to be subtly wrong.
    const { ctx } = await makeBridge(await mkdtemp(join(root, 'tx-')))
    await ctx.db.exec('CREATE TABLE t (a TEXT)')

    await expect(
      ctx.db.transaction(async (tx) => {
        await tx.exec('INSERT INTO t VALUES (?)', ['x'])
        throw new Error('deliberate')
      }),
    ).rejects.toThrow('deliberate')

    expect(await ctx.db.query('SELECT * FROM t')).toEqual([])
  })

  it('an untagged write during a renderer transaction is independent of it', async () => {
    // The same guarantee as in-process (docs/07 §6): a bystander must not
    // join, and must survive the rollback.
    const { ctx } = await makeBridge(await mkdtemp(join(root, 'tx2-')))
    await ctx.db.exec('CREATE TABLE t (a TEXT)')

    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))

    const txn = ctx.db
      .transaction(async (tx) => {
        await tx.exec('INSERT INTO t VALUES (?)', ['txn'])
        await gate
        throw new Error('rollback')
      })
      .catch(() => undefined)

    const bystander = ctx.db.exec('INSERT INTO t VALUES (?)', ['bystander'])
    release()
    await txn
    await bystander

    const rows = (await ctx.db.query<{ a: string }>('SELECT a FROM t')).map((r) => r.a)
    expect(rows).toEqual(['bystander'])
  })

  it('the capability gate refuses before the call leaves the renderer', async () => {
    const { ctx } = await makeBridge(await mkdtemp(join(root, 'gate-')))
    const { scopeContext } = await import('@BBeBee/kernel')
    const gated = scopeContext(ctx, {
      pluginId: 'p',
      instanceId: 'p',
      requested: ['fs:read:cache'],
    }).fs
    await expect(gated.readFile(ctx.fs.join(ctx.paths.appData, 'store.json'))).rejects.toThrow(
      /capability|may not/i,
    )
  })

  it('reports a missing preload bridge in terms a human can act on', async () => {
    const saved = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = {}
    try {
      const ctx = new Context()
      await ctx.plugin(PathsBridge, {})
      await expect(ctx.plugin(FsBridge)).rejects.toThrow(/preload bridge is missing/)
    } finally {
      ;(globalThis as { window?: unknown }).window = saved
    }
  })
})
