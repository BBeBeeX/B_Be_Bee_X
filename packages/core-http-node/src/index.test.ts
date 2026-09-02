/**
 * The HTTP slice, against a real byte-serving server.
 *
 * A mocked `fetch` would prove the wrapper calls it; what needs proving is
 * `Range`, progress, timeouts and resumption over a socket that behaves like a
 * server — including the ones that stall.
 */

import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
import { CapabilityError } from '@BBeBee/protocol'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { type HttpNode } from './index.js'

const PAYLOAD = Buffer.from(
  Array.from({ length: 5000 }, (_, i) => i % 251),
)

let server: Server
let origin: string
/** Requests seen, so tests can assert what actually went out. */
const seen: { url: string; headers: Record<string, string | string[] | undefined> }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers })
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/stall') {
      // Never responds: the timeout is the point.
      return
    }
    if (url.pathname === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ hello: 'world', echoed: req.headers['x-echo'] ?? null }))
      return
    }
    if (url.pathname === '/status') {
      res.writeHead(Number(url.searchParams.get('code') ?? 500))
      res.end('nope')
      return
    }

    // /bytes — a range-aware file server.
    const range = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''))
    if (range) {
      const start = Number(range[1])
      const end = range[2] ? Number(range[2]) : PAYLOAD.length - 1
      const slice = PAYLOAD.subarray(start, end + 1)
      res.writeHead(206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${end}/${PAYLOAD.length}`,
        'accept-ranges': 'bytes',
        etag: '"v1"',
      })
      res.end(slice)
      return
    }
    res.writeHead(200, {
      'content-length': String(PAYLOAD.length),
      'accept-ranges': 'bytes',
      etag: '"v1"',
    })
    res.end(PAYLOAD)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => {
  server.close()
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'bbebee-http-'))
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root })
  await ctx.plugin(FsNode)
  await ctx.plugin(plugin, { defaultTimeoutMs: 2000 })
  await tick()
  return { ctx, http: ctx.http as unknown as HttpNode, root }
}

describe('requests', () => {
  it('is callable, and sets arbitrary headers', async () => {
    // Not subject to browser rules: `user-agent` and friends are settable,
    // which is the reason this service exists at all (docs/02 §2).
    const { ctx } = await harness()
    const response = await ctx.http({ url: `${origin}/json`, headers: { 'x-echo': 'yes' } })

    expect(response.status).toBe(200)
    expect(await response.json<{ hello: string; echoed: string }>()).toEqual({
      hello: 'world',
      echoed: 'yes',
    })
    expect(seen.at(-1)!.headers['user-agent']).toContain('BBeBee')
  })

  it('gets and posts JSON', async () => {
    const { ctx } = await harness()
    expect(await ctx.http.get<{ hello: string }>(`${origin}/json`)).toMatchObject({
      hello: 'world',
    })
    expect(await ctx.http.post<{ hello: string }>(`${origin}/json`, { a: 1 })).toMatchObject({
      hello: 'world',
    })
  })

  it('reads bytes and streams them with progress', async () => {
    const { ctx } = await harness()
    const bytes = await (await ctx.http({ url: `${origin}/bytes` })).bytes()
    expect(bytes.length).toBe(PAYLOAD.length)

    const progress: number[] = []
    const response = await ctx.http({
      url: `${origin}/bytes`,
      onProgress: (loaded) => void progress.push(loaded),
    })
    const reader = response.stream().getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(progress.at(-1)).toBe(PAYLOAD.length)
  })

  it('asks for a byte range, which is what seeking a stream needs', async () => {
    const { ctx } = await harness()
    const response = await ctx.http({
      url: `${origin}/bytes`,
      headers: { range: 'bytes=1000-1099' },
    })
    expect(response.status).toBe(206)
    expect((await response.bytes()).length).toBe(100)
    expect(response.headers['content-range']).toContain('/5000')
  })

  it('times out rather than hanging forever', async () => {
    const { ctx } = await harness()
    await expect(ctx.http({ url: `${origin}/stall`, timeoutMs: 50 })).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('honours an external abort signal', async () => {
    const { ctx } = await harness()
    const abort = new AbortController()
    const inflight = ctx.http({ url: `${origin}/stall`, signal: abort.signal })
    abort.abort()
    await expect(inflight).rejects.toMatchObject({ code: 'network' })
  })

  it('maps a transport failure onto the taxonomy', async () => {
    // `NetworkError` is the one class the player retries with backoff.
    const { ctx } = await harness()
    await expect(ctx.http({ url: 'http://127.0.0.1:1/nothing' })).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    })
  })

  it('reports an error status without throwing', async () => {
    // A 404 is an answer, not a transport failure; the caller decides.
    const { ctx } = await harness()
    const response = await ctx.http({ url: `${origin}/status?code=404` })
    expect(response.status).toBe(404)
  })
})

describe('the net:host gate', () => {
  it('refuses a host the plugin was not granted', async () => {
    // `net:host/<glob>` was a manifest string with no enforcement — the same
    // shape `db:own` once had. A plugin holding ctx.http could reach anything,
    // including intranet and cloud-metadata addresses (docs/03 §7).
    const { ctx } = await harness()
    const scoped = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-demo',
      requested: ['net:host/*.example.org'] as never,
    })

    await expect(scoped.http({ url: `${origin}/json` })).rejects.toThrow(CapabilityError)
    await expect(scoped.http.get(`${origin}/json`)).rejects.toThrow(/may not reach/)
    await expect(
      scoped.http.download({ url: `${origin}/bytes`, to: 'file:///tmp/x' }),
    ).rejects.toThrow(CapabilityError)
  })

  it('allows a granted host', async () => {
    const { ctx } = await harness()
    const scoped = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-demo',
      requested: ['net:host/127.0.0.1'] as never,
    })
    await expect(scoped.http({ url: `${origin}/json` })).resolves.toMatchObject({ status: 200 })
  })

  it('cannot be laundered by a waterfall listener rewriting the url', async () => {
    // The gate runs before the waterfall *and* after it, so a listener cannot
    // be used as a redirect to somewhere the caller was never granted.
    const { ctx } = await harness()
    ctx.on('http/request', ((req: { url: string }, next: () => unknown) => {
      req.url = 'http://169.254.169.254/latest/meta-data/'
      return next()
    }) as never)

    const scoped = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-demo',
      requested: ['net:host/127.0.0.1'] as never,
    })
    await expect(scoped.http({ url: `${origin}/json` })).rejects.toThrow(/may not reach/)
  })

  it('leaves ungated callers alone', async () => {
    // The kernel, core services and tests are trusted; only plugins are gated.
    const { ctx } = await harness()
    await expect(ctx.http({ url: `${origin}/json` })).resolves.toMatchObject({ status: 200 })
  })
})

describe('the http/request waterfall', () => {
  it('lets a listener rewrite the request', async () => {
    // Where M2's auth injection, retry and rate limiting hook in.
    const { ctx } = await harness()
    // Mutate and call next: `next(somethingElse)` is silently ignored, which
    // is why the signature takes no arguments (docs/07 §5).
    ctx.on('http/request', ((req: { headers?: Record<string, string> }, next: () => unknown) => {
      req.headers = { ...req.headers, 'x-echo': 'injected' }
      return next()
    }) as never)

    const body = await ctx.http.get<{ echoed: string }>(`${origin}/json`)
    expect(body.echoed).toBe('injected')
  })

  it('lets a listener answer without going out', async () => {
    const { ctx } = await harness()
    const before = seen.length
    ctx.on('http/request', (() => ({
      status: 200,
      headers: {},
      url: 'cache://',
      text: async () => '',
      json: async () => ({ hello: 'cached' }),
      bytes: async () => new Uint8Array(),
      stream: () => new ReadableStream(),
    })) as never)

    expect(await ctx.http.get<{ hello: string }>(`${origin}/json`)).toEqual({ hello: 'cached' })
    expect(seen.length, 'nothing reached the server').toBe(before)
  })
})

describe('download', () => {
  it('writes a URL to a file', async () => {
    const { ctx, root } = await harness()
    const to = pathToFileURL(join(root, 'out.bin')).href
    const result = await ctx.http.download({ url: `${origin}/bytes`, to })

    expect(result.bytes).toBe(PAYLOAD.length)
    expect(result.etag).toBe('"v1"')
    expect(await readFile(join(root, 'out.bin'))).toEqual(PAYLOAD)
  })

  it('resumes from where it stopped', async () => {
    // The shape M3's task queue is built on: resume by byte offset, and the
    // etag is what says the remote file is still the same one.
    const { ctx, root } = await harness()
    const to = pathToFileURL(join(root, 'partial.bin')).href
    await ctx.fs.writeFile(to, PAYLOAD.subarray(0, 2000))

    const result = await ctx.http.download({ url: `${origin}/bytes`, to, resumeFrom: 2000 })
    expect(result.bytes).toBe(PAYLOAD.length)
    expect(await readFile(join(root, 'partial.bin'))).toEqual(PAYLOAD)
    expect(seen.at(-1)!.headers.range).toBe('bytes=2000-')
  })
})

describe('cookies', () => {
  it('keeps jars apart and drops expired cookies', async () => {
    // ⚠️ In-memory only in M1 — persistence lands in M2 (docs/04 §2.1).
    const { ctx } = await harness()
    const home = ctx.http.cookies.jar('navidrome-home')
    const work = ctx.http.cookies.jar('navidrome-work')

    await home.set([
      { name: 'session', value: 'abc', domain: 'example.org', path: '/', secure: true, httpOnly: true },
      {
        name: 'stale',
        value: 'x',
        domain: 'example.org',
        path: '/',
        secure: true,
        httpOnly: true,
        expiresAt: Date.now() - 1000,
      },
    ])

    expect((await home.get('https://example.org/rest')).map((c) => c.name)).toEqual(['session'])
    expect(await work.all(), 'jars never see each other').toEqual([])

    await home.clear()
    expect(await home.all()).toEqual([])
  })

  it('does not hand example.com cookies to evilexample.com', async () => {
    // `host.endsWith(domain)` has no boundary: the attacker registers a domain
    // that ends with yours. RFC 6265 §5.1.3 wants a dot or an exact match.
    const { ctx } = await harness()
    const jar = ctx.http.cookies.jar('site')
    await jar.set([
      {
        name: 'session',
        value: 'secret',
        domain: 'example.com',
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ])

    expect(await jar.get('https://example.com/')).toHaveLength(1)
    expect(await jar.get('https://api.example.com/')).toHaveLength(1)
    expect(await jar.get('https://evilexample.com/'), 'not a subdomain').toHaveLength(0)
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-http-leak-')) })
    await ctx.plugin(FsNode)
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
