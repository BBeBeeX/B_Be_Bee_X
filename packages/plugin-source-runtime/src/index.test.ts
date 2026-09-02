/**
 * The runtime's floor: a document with one rule block.
 *
 * Half of what is asserted here is *absence* — no `search`, no `browse`, no
 * `library`. That is the regression test the whole optional surface rests on,
 * and it is sharper than it was when the floor was a hand-written package:
 * capabilities are **derived**, so a one-block document genuinely has one
 * capability rather than a declared claim to one (docs/11 §4.10).
 */

import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import httpPlugin from '@BBeBee/core-http-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import { CORE_MIGRATIONS, MigrationRunner } from '@BBeBee/kernel'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'

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

/** The smallest legal document: a name, a URL, and one rule. */
function radio(path = '/track.mp3', extra: Record<string, unknown> = {}) {
  return {
    sourceUrl: `${origin}${path}`,
    sourceName: 'Example Radio',
    sourceType: 'radio',
    ruleStream: { url: '={{source.url}}', ...(extra.ruleStream ?? {}) },
    ...extra,
  }
}

async function harness(docs: unknown[] = []) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-runtime-')) })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(httpPlugin, {})
  await ctx.plugin(sourcesPlugin, {})
  await tick()
  await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)

  if (docs.length) await ctx.sources.import(JSON.stringify(docs))
  const fiber = await ctx.plugin(plugin, {})
  await tick()
  return { ctx, fiber }
}

describe('a document becomes a provider', () => {
  it('registers one provider per enabled source', async () => {
    const { ctx } = await harness([radio()])
    expect(ctx.sources.providers).toHaveLength(1)
    // The id is derived from sourceUrl, so it is stable across re-imports.
    expect(ctx.sources.providers[0]!.sourceId).toBe(ctx.sources.sources[0]!.id)
  })

  it('implements exactly the required members', async () => {
    const { ctx } = await harness([radio()])
    const provider = ctx.sources.providers[0]!
    expect(typeof provider.getTrack).toBe('function')
    expect(typeof provider.resolveStream).toBe('function')
    expect(typeof provider.ping).toBe('function')
    expect(provider.auth, 'auth is present on every provider').toBeDefined()

    // Absent, not stubbed. A member that throws is a lie about the contract.
    expect(provider.search).toBeUndefined()
    expect(provider.browse).toBeUndefined()
    expect(provider.getAlbum).toBeUndefined()
    expect(provider.getArtist).toBeUndefined()
    expect(provider.getPlaylist).toBeUndefined()
    expect(provider.getLyrics).toBeUndefined()
    expect(provider.library).toBeUndefined()
  })

  it('derives every optional capability as false', async () => {
    const { ctx } = await harness([radio()])
    const caps = ctx.sources.providers[0]!.capabilities
    expect(caps.browse).toBe(false)
    expect(caps.lyrics).toBe(false)
    expect(caps.artwork).toBe(false)
    expect(Object.values(caps.search).every((v) => v === false)).toBe(true)
    expect(Object.values(caps.library).every((v) => v === false)).toBe(true)
    expect(caps.streaming.urlExpiry, 'no expiresAt rule means no expiry').toBe(false)
  })

  it('derives urlExpiry from the presence of an expiresAt rule', async () => {
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{source.url}}', expiresAt: '=1' } }),
    ])
    expect(ctx.sources.providers[0]!.capabilities.streaming.urlExpiry).toBe(true)
  })

  it('is skipped by a fan-out search rather than breaking it', async () => {
    const { ctx } = await harness([radio()])
    const { bySource } = await ctx.sources.searchAll({ text: 'anything' })
    expect(bySource).toEqual([])
  })

  it('derives a rate limit from concurrentRate', async () => {
    const { ctx } = await harness([radio('/t.mp3', { concurrentRate: '3/1000' })])
    expect(ctx.sources.providers[0]!.capabilities.rateLimit).toEqual({
      requests: 3,
      windowMs: 1000,
    })
  })
})

describe('resolution', () => {
  const prefs = { quality: 'normal' as const, saveData: false, acceptFormats: [] }

  it('renders ruleStream into a remote handle', async () => {
    const { ctx } = await harness([radio()])
    const provider = ctx.sources.providers[0]!
    const handle = await provider.resolveStream('t1', prefs)

    expect(handle.kind).toBe('remote')
    expect(handle.target).toBe(`${origin}/track.mp3`)
    expect(handle.byteLength).toBe(4096)
    expect(handle.mimeType).toBe('audio/mpeg')
    expect(handle.expiresAt, 'a plain url does not expire').toBeUndefined()
  })

  it('learns whether the stream can be seeked instead of assuming', async () => {
    acceptRanges = false
    try {
      const { ctx } = await harness([radio('/noranges.mp3')])
      const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
      expect(handle.seekable, 'no Accept-Ranges means no scrubber').toBe(false)
    } finally {
      acceptRanges = true
    }
  })

  it('honours a document that states seekable itself, without a probe', async () => {
    const { ctx } = await harness([
      radio('/live.mp3', { ruleStream: { url: '={{source.url}}', seekable: '=false' } }),
    ])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.seekable).toBe(false)
  })

  it('reports a dead url in the taxonomy', async () => {
    const { ctx } = await harness([radio('/missing')])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'not-found',
    })
  })

  it('renders prefs into the url, so quality is the document’s decision', async () => {
    const { ctx } = await harness([
      radio('/t.mp3', {
        ruleStream: { url: '={{source.url}}?q={{prefs.quality}}', seekable: '=true' },
      }),
    ])
    const handle = await ctx.sources.providers[0]!.resolveStream('t1', prefs)
    expect(handle.target).toBe(`${origin}/t.mp3?q=normal`)
  })

  it('fails with a RuleError naming the rule when a template cannot resolve', async () => {
    // Not a network failure and not a bug in the app: the document needs
    // editing, and saying so is the difference between a two-minute fix and a
    // support request (docs/06 §7).
    const { ctx } = await harness([
      radio('/t.mp3', { ruleStream: { url: '={{track.missingField}}' } }),
    ])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'rule',
      rule: { block: 'ruleStream', field: 'url' },
    })
  })

  it('refuses a selector rule rather than treating it as a literal url', async () => {
    const { ctx } = await harness([radio('/t.mp3', { ruleStream: { url: '$.url' } })])
    await expect(ctx.sources.providers[0]!.resolveStream('t1', prefs)).rejects.toMatchObject({
      code: 'rule',
    })
  })
})

describe('the source list drives the fibers', () => {
  it('starts nothing for a disabled source', async () => {
    const { ctx } = await harness([{ ...radio(), enabled: false }])
    expect(ctx.sources.providers).toHaveLength(0)
  })

  it('starts a source when it is enabled, and stops it when disabled', async () => {
    const { ctx } = await harness([{ ...radio(), enabled: false }])
    const id = ctx.sources.sources[0]!.id

    await ctx.sources.setEnabled(id, true)
    await tick()
    expect(ctx.sources.providers).toHaveLength(1)

    await ctx.sources.setEnabled(id, false)
    await tick()
    expect(ctx.sources.providers).toHaveLength(0)
  })

  it('picks up a source imported after it started', async () => {
    const { ctx } = await harness()
    expect(ctx.sources.providers).toHaveLength(0)

    await ctx.sources.import(JSON.stringify(radio()))
    await tick()
    expect(ctx.sources.providers).toHaveLength(1)
  })

  it('two documents are two sources with two ids', async () => {
    // Multi-instance is free now: two servers are two imported strings.
    const { ctx } = await harness([radio('/a.mp3'), { ...radio('/b.mp3'), sourceName: 'B' }])
    expect(ctx.sources.providers).toHaveLength(2)
    const ids = ctx.sources.providers.map((p) => p.sourceId)
    expect(new Set(ids).size, 'ids must not collide').toBe(2)
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-runtime-leak-')) })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(httpPlugin, {})
    await ctx.plugin(sourcesPlugin, {})
    await tick()
    await new MigrationRunner(ctx.db).apply('core', CORE_MIGRATIONS)
    await ctx.sources.import(JSON.stringify(radio()))
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

describe('the shipped fixtures', () => {
  it('imports and runs the example document in fixtures/sources', async () => {
    // The corpus claim from docs/09 §6, at the size the corpus currently is:
    // a document nobody compiled, imported as a string, resolves to a stream.
    // If this fails, either the rule engine changed or the example did.
    const { ctx } = await harness()
    const raw = await readFile(
      new URL('../../../fixtures/sources/direct-url.json', import.meta.url),
      'utf8',
    )

    const report = await ctx.sources.import(raw)
    expect(report.rejected, JSON.stringify(report.rejected)).toEqual([])
    expect(report.added).toHaveLength(1)
    await tick()

    const provider = ctx.sources.providers[0]!
    const handle = await provider.resolveStream('anything', {
      quality: 'normal',
      saveData: false,
      acceptFormats: [],
    })
    expect(handle.target).toBe('https://stream.example.org/live.mp3')
    expect(handle.mimeType).toBe('audio/mpeg')
    expect(handle.seekable, 'a live stream is not seekable').toBe(false)
  })

  it('round-trips through export unchanged', async () => {
    // Export must emit what was imported. The first time a user's document
    // comes back different, they stop trusting export (docs/07 §4.1).
    const { ctx } = await harness()
    const raw = await readFile(
      new URL('../../../fixtures/sources/direct-url.json', import.meta.url),
      'utf8',
    )
    await ctx.sources.import(raw)

    const exported = await ctx.sources.export()
    expect(JSON.parse(exported)).toEqual([JSON.parse(raw)])
  })
})
