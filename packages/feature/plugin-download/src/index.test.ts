/**
 * The playback cache, against real SQL and a real filesystem.
 *
 * What is worth pinning is the *contract*: a remote resolve is cached while it
 * plays, the next resolve answers `kind: 'local'` without asking anything
 * downstream, and every path where the cache cannot be honoured — a missing
 * file, a failed download, a disabled cache — degrades to streaming rather
 * than to an error.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type { HttpRequest, StreamHandle, StreamPrefs, Uri } from '@BBeBee/protocol'
import plugin, { formatFor } from './index.js'

const URN = 'BBeBee:demo:track:1'
const PREFS: StreamPrefs = { quality: 'normal', saveData: false, acceptFormats: [] }

const REMOTE: StreamHandle = {
  kind: 'remote',
  target: 'https://cdn.example.test/audio.m4s?token=abc',
  seekable: true,
  headers: { Referer: 'https://example.test/video/1' },
}

/** `ctx.http`, with the transfer under the test's control. */
class HttpStub extends Service {
  static inject = ['fs']
  readonly calls: { url: string; headers?: Record<string, string>; to: Uri }[] = []
  bytes = new Uint8Array([1, 2, 3, 4])
  failure?: Error

  constructor(ctx: Context) {
    super(ctx, 'http')
  }

  async download(req: HttpRequest & { to: Uri; resumeFrom?: number }) {
    this.calls.push({
      url: req.url,
      ...(req.headers ? { headers: req.headers } : {}),
      to: req.to,
    })
    if (this.failure) throw this.failure
    await this.ctx.fs.writeFile(req.to, this.bytes)
    return { bytes: this.bytes.byteLength }
  }
}

async function harness(config: { enabled?: boolean; maxCacheBytes?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-download') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(HttpStub)
  const fiber = await ctx.plugin(plugin, config)
  await tick()

  // The catalogue's foreign keys need a source and a track before a binding
  // can exist, exactly as in the app.
  await ctx.db.exec(
    `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
     VALUES ('demo', 'https://demo.test', 'Demo', '{}', 'h', 0, 0)`,
  )
  await ctx.db.exec(
    `INSERT INTO tracks (urn, source_id, remote_id, title, fetched_at)
     VALUES (?, 'demo', '1', 'Cached', 0)`,
    [URN],
  )

  return {
    ctx,
    fiber,
    http: ctx.http as unknown as HttpStub,
    rows: () =>
      ctx.db.query<{ uri: Uri; origin: string; format: string | null; size_bytes: number | null }>(
        'SELECT uri, origin, format, size_bytes FROM media_bindings',
      ),
  }
}

/** Wait for a background write to land, rather than guessing at microtasks. */
async function until<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read()
    if (value !== undefined) return value
    await tick()
  }
  throw new Error('timed out waiting for the cache')
}

function resolve(ctx: Context, terminal: () => Promise<StreamHandle>): Promise<StreamHandle> {
  return ctx.waterfall('player/before-resolve', URN, PREFS, terminal)
}

describe('plugin-download', () => {
  it('caches a remote track while it plays, and plays the file next time', async () => {
    const { ctx, http, rows } = await harness()

    const first = await resolve(ctx, async () => REMOTE)
    expect(first).toEqual(REMOTE)

    const written = await until(async () => {
      const all = await rows()
      return all.length > 0 ? all : undefined
    })
    expect(http.calls[0], 'the stream was fetched with its own headers').toMatchObject({
      url: REMOTE.target,
      headers: REMOTE.headers,
    })
    expect(written).toHaveLength(1)
    expect(written[0]!.origin).toBe('download')
    expect(written[0]!.format).toBe('m4a')
    expect(await ctx.fs.exists(written[0]!.uri)).toBe(true)
    expect(written[0]!.size_bytes).toBe(4)

    // The second resolve short-circuits: nothing downstream is asked.
    let asked = false
    const second = await resolve(ctx, async () => {
      asked = true
      return REMOTE
    })
    expect(second.kind).toBe('local')
    expect(second.target).toBe(written[0]!.uri)
    expect(second.byteLength).toBe(4)
    expect(asked, 'a cache hit must not reach the provider').toBe(false)
  })

  it('drops a binding whose file is gone and streams instead', async () => {
    const { ctx, rows } = await harness()
    await resolve(ctx, async () => REMOTE)
    await until(async () => ((await rows()).length > 0 ? true : undefined))
    await ctx.fs.remove((await rows())[0]!.uri)

    let asked = false
    const handle = await resolve(ctx, async () => {
      asked = true
      return REMOTE
    })

    expect(handle.kind).toBe('remote')
    expect(asked).toBe(true)
    await until(async () => ((await rows()).length === 0 ? true : undefined))
  })

  it('writes nothing when caching is off, but still answers from the cache', async () => {
    const { ctx, http, rows } = await harness({ enabled: false })
    const handle = await resolve(ctx, async () => REMOTE)
    expect(handle.kind).toBe('remote')

    // Nothing landed, and nothing was attempted.
    await tick()
    await tick()
    expect(await rows()).toHaveLength(0)
    expect(http.calls).toHaveLength(0)

    // A binding written by an earlier session is still a hit.
    const uri = ctx.fs.join(ctx.paths.cache, 'media', 'pre-existing.m4a')
    await ctx.fs.mkdir(ctx.fs.join(ctx.paths.cache, 'media'), { recursive: true })
    await ctx.fs.writeFile(uri, new Uint8Array([9, 9]))
    await ctx.db.exec(
      `INSERT INTO media_bindings (id, track_urn, uri, format, size_bytes, origin, verified_at, created_at)
       VALUES ('bd_old', ?, ?, 'm4a', 2, 'download', 0, 0)`,
      [URN, uri],
    )

    const hit = await resolve(ctx, async () => REMOTE)
    expect(hit.kind).toBe('local')
    expect(hit.target).toBe(uri)
  })

  it('leaves no binding and no file when a download fails', async () => {
    const { ctx, http, rows } = await harness()
    http.failure = new Error('connection reset')

    const handle = await resolve(ctx, async () => REMOTE)
    expect(handle.kind).toBe('remote')

    await tick()
    await tick()
    expect(await rows()).toHaveLength(0)
    // A partial write is the download's job to clean up; what this asserts is
    // that no *binding* points at it, so the next play starts over.
    const files = await ctx.fs.list(ctx.fs.join(ctx.paths.cache, 'media')).catch(() => [])
    expect(files.filter((file) => !file.isDirectory)).toHaveLength(0)
  })

  it('evicts the least recently played entry once the budget is exceeded', async () => {
    const { ctx, http, rows } = await harness({ maxCacheBytes: 6 })
    http.bytes = new Uint8Array([1, 2, 3, 4])
    await resolve(ctx, async () => REMOTE)
    await until(async () => ((await rows()).length === 1 ? true : undefined))

    const second: StreamHandle = { ...REMOTE, target: 'https://cdn.example.test/two.m4s' }
    const urn2 = 'BBeBee:demo:track:2'
    await ctx.db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, fetched_at)
       VALUES (?, 'demo', '2', 'Second', 0)`,
      [urn2],
    )
    // Later, so the LRU order is deterministic without sleeping.
    await ctx.db.exec('UPDATE media_bindings SET verified_at = 1')
    await ctx.waterfall('player/before-resolve', urn2, PREFS, async () => second)

    const remaining = await until(async () => {
      const all = await ctx.db.query<{ track_urn: string; uri: Uri }>(
        'SELECT track_urn, uri FROM media_bindings',
      )
      return all.length === 1 && all[0]!.track_urn === urn2 ? all : undefined
    })
    expect(remaining).toHaveLength(1)
    expect(await ctx.fs.exists(remaining[0]!.uri)).toBe(true)
  })

  it('sweeps a file no binding names when the plugin starts', async () => {
    // Removing a source cascades its bindings away in SQL and leaves the
    // files; without a sweep those bytes are invisible to eviction.
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-download-sweep') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(HttpStub)
    const directory = ctx.fs.join(ctx.paths.cache, 'media')
    await ctx.fs.mkdir(directory, { recursive: true })
    const orphan = ctx.fs.join(directory, 'bd_orphan.m4a')
    await ctx.fs.writeFile(orphan, new Uint8Array([1]))

    await ctx.plugin(plugin, {})
    await tick()

    expect(await ctx.fs.exists(orphan)).toBe(false)
  })

  it('forgets a cached copy the player could not play', async () => {
    const { ctx, rows } = await harness()
    await resolve(ctx, async () => REMOTE)
    const written = await until(async () => {
      const all = await rows()
      return all.length > 0 ? all : undefined
    })
    await resolve(ctx, async () => REMOTE) // marks it as served

    ctx.emit('player/error', { code: 'provider', message: 'corrupt' } as never, URN)

    await until(async () => ((await rows()).length === 0 ? true : undefined))
    expect(await ctx.fs.exists(written[0]!.uri)).toBe(false)
  })

  it('names the container it can, and says nothing when it cannot', () => {
    expect(formatFor({ kind: 'remote', target: 'https://x/a.m4s?t=1', seekable: true })).toBe('m4a')
    expect(formatFor({ kind: 'remote', target: 'https://x/a.flac', seekable: true })).toBe('flac')
    expect(
      formatFor({ kind: 'remote', target: 'https://x/stream', mimeType: 'audio/mpeg', seekable: true }),
    ).toBe('mp3')
    expect(
      formatFor({ kind: 'remote', target: 'https://x/s', codec: 'mp4a.40.2', seekable: true }),
    ).toBe('m4a')
    expect(formatFor({ kind: 'remote', target: 'https://x/s', seekable: true })).toBeUndefined()
  })
})

describe('plugin-download lifecycle', () => {
  it('snapshots clean after unload', async () => {
    const root = await tempDir('bbebee-download-leak')
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(HttpStub)
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
