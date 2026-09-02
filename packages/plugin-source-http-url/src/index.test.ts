/**
 * The SPI's floor.
 *
 * Half of what is asserted here is *absence*: no `search`, no `browse`, no
 * `library`. That is the regression test the whole optional surface rests on —
 * if a consumer calls an optional member without checking `capabilities`, this
 * provider is where it breaks.
 */

import { createServer, type Server } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@BBeBee/core-http-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { SourceHttpUrl } from './index.js'

let server: Server
let origin: string
let acceptRanges = true

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/missing') {
      res.writeHead(404)
      res.end()
      return
    }
    const headers: Record<string, string> = {
      'content-type': 'audio/mpeg',
      'content-length': '4096',
    }
    if (acceptRanges) headers['accept-ranges'] = 'bytes'
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(4096))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(() => server.close())

async function harness(entries: { url: string; title?: string }[] = []) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-url-')) })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  const source = new SourceHttpUrl(ctx, { entries })
  // Registered the way the plugin does it, so the tests exercise the same
  // object the registry hands out.
  const dispose = ctx.sources.register(source.provider())
  await tick()
  return { ctx, source, dispose, provider: ctx.sources.get('http-url')! }
}

describe('the required core, and nothing else', () => {
  it('implements exactly the required members', async () => {
    const { provider } = await harness()
    expect(typeof provider.getTrack).toBe('function')
    expect(typeof provider.resolveStream).toBe('function')
    expect(typeof provider.ping).toBe('function')
    expect(provider.auth, 'auth is required of every provider').toBeDefined()

    // Absent, not stubbed. A member that throws is a lie about the contract.
    expect(provider.search).toBeUndefined()
    expect(provider.browse).toBeUndefined()
    expect(provider.getAlbum).toBeUndefined()
    expect(provider.getArtist).toBeUndefined()
    expect(provider.getPlaylist).toBeUndefined()
    expect(provider.getLyrics).toBeUndefined()
    expect(provider.library).toBeUndefined()
  })

  it('declares every optional capability false', async () => {
    const { provider } = await harness()
    const caps = provider.capabilities
    expect(caps.browse).toBe(false)
    expect(caps.lyrics).toBe(false)
    expect(caps.artwork).toBe(false)
    expect(Object.values(caps.search).every((v) => v === false)).toBe(true)
    expect(Object.values(caps.library).every((v) => v === false)).toBe(true)
  })

  it('is skipped by a fan-out search rather than breaking it', async () => {
    // What `ctx.sources.searchAll` does with a provider that cannot search.
    const { ctx } = await harness([{ url: `${origin}/a.mp3` }])
    const { byProvider } = await ctx.sources.searchAll({ text: 'anything' })
    expect(byProvider).toEqual([])
  })
})

describe('resolution', () => {
  it('resolves a configured url to a remote handle', async () => {
    const { source, provider } = await harness()
    const urn = source.add({ url: `${origin}/track.mp3`, title: 'A Web Track' })
    const id = urn.split(':').pop()!

    const handle = await provider.resolveStream(id, {
      quality: 'normal',
      saveData: false,
      acceptFormats: [],
    })
    expect(handle.kind).toBe('remote')
    expect(handle.target).toBe(`${origin}/track.mp3`)
    expect(handle.byteLength).toBe(4096)
    expect(handle.mimeType).toBe('audio/mpeg')
    expect(handle.expiresAt, 'a plain url does not expire').toBeUndefined()
  })

  it('learns whether the stream can be seeked instead of assuming', async () => {
    acceptRanges = false
    try {
      const { source, provider } = await harness()
      const id = source.add({ url: `${origin}/noranges.mp3` }).split(':').pop()!
      const handle = await provider.resolveStream(id, {
        quality: 'normal',
        saveData: false,
        acceptFormats: [],
      })
      expect(handle.seekable, 'no Accept-Ranges means no scrubber').toBe(false)
    } finally {
      acceptRanges = true
    }
  })

  it('reports a dead url in the taxonomy', async () => {
    const { source, provider } = await harness()
    const id = source.add({ url: `${origin}/missing` }).split(':').pop()!
    await expect(
      provider.resolveStream(id, { quality: 'normal', saveData: false, acceptFormats: [] }),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('titles a url by its last path segment when nothing better is known', async () => {
    const { source, provider } = await harness()
    const id = source.add({ url: `${origin}/music/Some%20Song.mp3` }).split(':').pop()!
    const track = await provider.getTrack(id)
    expect(track.title, 'no tags exist, so nothing is invented').toBe('Some Song.mp3')
    expect(track.artists).toEqual([])
  })

  it('gives the same url the same id every time', async () => {
    const { source } = await harness()
    expect(source.add({ url: `${origin}/x.mp3` })).toBe(source.add({ url: `${origin}/x.mp3` }))
  })
})

describe('instances', () => {
  it('may be configured more than once', async () => {
    // `instantiable: true`: two web addresses are two instances, and their
    // URNs never collide.
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-url-multi-')) })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(httpPlugin, {})
    await ctx.plugin(sourcesPlugin, {})
    await ctx.plugin(plugin, { instanceId: 'radio-a', entries: [{ url: `${origin}/a.mp3` }] })
    await ctx.plugin(plugin, { instanceId: 'radio-b', entries: [{ url: `${origin}/b.mp3` }] })
    await tick()

    expect(ctx.sources.providers.map((p) => p.instanceId).sort()).toEqual(['radio-a', 'radio-b'])
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-url-leak-')) })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(httpPlugin, {})
    await ctx.plugin(sourcesPlugin, {})
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    expect(ctx.sources.providers).toHaveLength(1)

    await fiber.dispose()
    await tick()
    expect(ctx.sources.providers).toHaveLength(0)

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
