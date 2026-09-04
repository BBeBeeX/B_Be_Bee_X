/**
 * The scanner, against a real filesystem and a real database.
 *
 * The codec is faked — a tag reader is `core-codec-*`'s contract to keep, not
 * this plugin's — but everything else is real, because the behaviours that
 * matter here are exactly the ones a fake would paper over: what gets opened,
 * what gets written, and what happens when a file disappears.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import type { AudioMetadata, DbService, Uri } from '@BBeBee/protocol'
import plugin, { type Scanner } from './index.js'
import { splitArtists, sortKey } from './import.js'
import { artworkId } from './ids.js'

/** Counts what the scanner asks of the codec — the exit criterion is a count. */
interface FakeCodec {
  metadataReads: string[]
  artworkReads: string[]
  tags: Map<string, AudioMetadata>
  failures: Set<string>
}

function codecPlugin(fake: FakeCodec) {
  class CodecFake extends Service {
    constructor(ctx: Context) {
      super(ctx, 'codec')
    }
    async readMetadata(uri: Uri): Promise<AudioMetadata> {
      fake.metadataReads.push(uri)
      if (fake.failures.has(uri)) throw new Error('unsupported codec')
      // No title by default, so the filename fallback is exercised rather
      // than hidden behind a fake that always knows one.
      return fake.tags.get(uri) ?? { artist: 'Unknown', hasArtwork: false }
    }
    async readArtwork(uri: Uri): Promise<Uint8Array | undefined> {
      fake.artworkReads.push(uri)
      return new Uint8Array([1, 2, 3, 4])
    }
    async decode() {
      throw new Error('not needed')
    }
    async probeDuration() {
      return 0
    }
    supportedFormats(): string[] {
      return ['mp3', 'flac']
    }
  }
  return CodecFake
}

interface Harness {
  ctx: Context
  scanner: Scanner
  db: DbService
  dir: string
  uri: Uri
  codec: FakeCodec
  write(name: string, content?: string): Promise<string>
}

async function harness(
  opts: { pollIntervalMinutes?: number; canWatch?: boolean } = {},
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'bbebee-scan-'))
  const codec: FakeCodec = {
    metadataReads: [],
    artworkReads: [],
    tags: new Map(),
    failures: new Set(),
  }

  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-scan-app-')) })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(codecPlugin(codec))
  if (opts.canWatch === false) {
    // Stand in for the desktop bridge, whose `canWatch` is false.
    Object.defineProperty(ctx.fs, 'canWatch', { get: () => false, configurable: true })
  }
  await ctx.plugin(plugin, {
    batchSize: 2,
    watchDebounceMs: 5,
    ...(opts.pollIntervalMinutes !== undefined
      ? { pollIntervalMinutes: opts.pollIntervalMinutes }
      : {}),
  })
  await tick()

  return {
    ctx,
    scanner: ctx.scanner as Scanner,
    db: ctx.db,
    dir,
    uri: pathToFileURL(dir).href.replace(/\/$/, ''),
    codec,
    async write(name: string, content = 'audio') {
      const path = join(dir, name)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, content)
      return pathToFileURL(path).href
    },
  }
}

describe('scanning', () => {
  it('imports tagged files into the catalogue', async () => {
    const h = await harness()
    const a = await h.write('a.mp3')
    await h.write('b.flac')
    await h.write('notes.txt')

    h.codec.tags.set(a, {
      title: 'Jóga',
      artist: 'Björk',
      albumArtist: 'Björk',
      album: 'Homogenic',
      trackNo: 2,
      year: 1997,
      durationMs: 302_000,
      genre: ['Electronic'],
      isrc: 'ISRC123',
      hasArtwork: true,
    })

    await h.scanner.addRoot(h.uri)
    const summary = await h.scanner.scan()

    expect(summary.added, 'the .txt is not audio').toBe(2)
    expect(summary.errors).toBe(0)

    const tracks = await h.db.query<{ title: string; track_no: number | null }>(
      'SELECT title, track_no FROM tracks ORDER BY title',
    )
    expect(tracks.map((t) => t.title).sort()).toEqual(['Jóga', 'b'])

    const album = await h.db.get<{ title: string; year: number }>('SELECT title, year FROM albums')
    expect(album).toMatchObject({ title: 'Homogenic', year: 1997 })

    const artists = await h.db.query<{ name: string }>('SELECT name FROM artists ORDER BY name')
    expect(artists.map((a) => a.name)).toContain('Björk')

    // The binding is what "this track is a file on disk" means (docs/07 §4.5).
    const binding = await h.db.get<{ uri: string; origin: string }>(
      'SELECT uri, origin FROM media_bindings WHERE uri = ?',
      [a],
    )
    expect(binding).toMatchObject({ uri: a, origin: 'scan' })

    const external = await h.db.get<{ value: string }>(
      "SELECT value FROM external_ids WHERE namespace = 'isrc'",
    )
    expect(external?.value, 'recorded now so M2 can link on it').toBe('ISRC123')
  })

  it('rescans an unchanged library with stat calls and nothing else', async () => {
    // M1's first exit criterion, as a count rather than an intention.
    const h = await harness()
    for (let i = 0; i < 10; i++) await h.write(`t${i}.mp3`)
    await h.scanner.addRoot(h.uri)

    const first = await h.scanner.scan()
    expect(first.added).toBe(10)
    expect(h.codec.metadataReads).toHaveLength(10)

    h.codec.metadataReads.length = 0
    h.codec.artworkReads.length = 0
    const second = await h.scanner.scan()

    expect(second, 'nothing changed').toMatchObject({ added: 0, updated: 0, removed: 0, errors: 0 })
    expect(h.codec.metadataReads, 'no file is opened on an unchanged rescan').toHaveLength(0)
    expect(h.codec.artworkReads).toHaveLength(0)
  })

  it('re-imports a file whose size or mtime changed', async () => {
    const h = await harness()
    const a = await h.write('a.mp3')
    await h.scanner.addRoot(h.uri)
    await h.scanner.scan()

    h.codec.metadataReads.length = 0
    h.codec.tags.set(a, { title: 'Retagged', artist: 'Björk', hasArtwork: false })
    await h.write('a.mp3', 'audio audio audio')

    const summary = await h.scanner.scan()
    expect(summary.updated).toBe(1)
    expect(h.codec.metadataReads).toEqual([a])
    const track = await h.db.get<{ title: string }>('SELECT title FROM tracks')
    expect(track?.title).toBe('Retagged')
  })

  it('re-reads everything when asked for a full scan', async () => {
    const h = await harness()
    await h.write('a.mp3')
    await h.scanner.addRoot(h.uri)
    await h.scanner.scan()

    h.codec.metadataReads.length = 0
    await h.scanner.scan({ full: true })
    expect(h.codec.metadataReads).toHaveLength(1)
  })

  it('records a file it cannot decode instead of dropping it', async () => {
    const h = await harness()
    const bad = await h.write('broken.mp3')
    await h.write('good.mp3')
    h.codec.failures.add(bad)

    await h.scanner.addRoot(h.uri)
    const summary = await h.scanner.scan()

    expect(summary).toMatchObject({ added: 1, errors: 1 })
    const entry = await h.db.get<{ status: string; error: string }>(
      'SELECT status, error FROM scan_entries WHERE uri = ?',
      [bad],
    )
    expect(entry?.status).toBe('error')
    expect(entry?.error, 'with the reason, for the "could not import" list').toMatch(/unsupported/)
  })

  it('survives a directory symlink cycle', async () => {
    // `ln -s . loop` inside a music folder — or two folders linking to each
    // other, which real collections do have — made the BFS queue never empty
    // and `found` grow without bound. The scan did not fail; it ran until the
    // process died, which is the worst shape a bug can take.
    const h = await harness()
    await h.write('a.mp3')
    await mkdir(join(h.dir, 'sub'), { recursive: true })
    await writeFile(join(h.dir, 'sub', 'b.mp3'), 'x')
    await symlink(h.dir, join(h.dir, 'sub', 'loop'), 'dir')

    await h.scanner.addRoot(h.uri, { recursive: true })
    const summary = await h.scanner.scan()

    // The guarantee is termination and a bounded result — not perfect
    // de-duplication, which needs canonical-path identity `ctx.fs` does not
    // expose. Both real files are found, and the loop does not run forever.
    const rows = await h.db.query<{ urn: string }>('SELECT urn FROM tracks')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.length, 'the walk is depth-bounded, not unbounded').toBeLessThan(200)
    expect(summary.errors).toBe(0)
  })

  it('walks subdirectories, and stops at the top when told not to', async () => {
    const h = await harness()
    await h.write('top.mp3')
    await h.write('deep/nested.mp3')

    await h.scanner.addRoot(h.uri, { recursive: false })
    expect((await h.scanner.scan()).added).toBe(1)

    await h.scanner.removeRoot(h.scanner.roots[0]!.id)
    await h.scanner.addRoot(h.uri, { recursive: true })
    expect((await h.scanner.scan()).added).toBe(2)
  })

  it('forgets a file that is gone, and the track it was', async () => {
    const h = await harness()
    const a = await h.write('a.mp3')
    await h.write('b.mp3')
    await h.scanner.addRoot(h.uri)
    await h.scanner.scan()
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(2)

    await rm(new URL(a))
    const summary = await h.scanner.scan()

    expect(summary.removed).toBe(1)
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(1)
    expect(
      await h.db.query('SELECT id FROM media_bindings WHERE uri = ?', [a]),
      'a binding whose file is gone is deleted, not left to fail at play time',
    ).toHaveLength(0)
    expect(await h.db.query('SELECT uri FROM scan_entries WHERE uri = ?', [a])).toHaveLength(0)
  })

  it('gives the same track the same URN on every scan', async () => {
    // Otherwise a rescan orphans every playlist entry and play record.
    const h = await harness()
    await h.write('a.mp3')
    await h.scanner.addRoot(h.uri)
    await h.scanner.scan()
    const before = await h.db.get<{ urn: string }>('SELECT urn FROM tracks')

    await h.scanner.scan({ full: true })
    const after = await h.db.query<{ urn: string }>('SELECT urn FROM tracks')
    expect(after).toHaveLength(1)
    expect(after[0]!.urn).toBe(before!.urn)
  })

  it('checkpoints per batch and reports progress', async () => {
    const h = await harness()
    for (let i = 0; i < 5; i++) await h.write(`t${i}.mp3`)
    const progress: number[] = []
    const changed: number[] = []
    h.ctx.on('scan/progress', (_root, done) => void progress.push(done))
    h.ctx.on('library/changed', (_kind, urns) => void changed.push(urns.length))

    await h.scanner.addRoot(h.uri)
    await h.scanner.scan()

    // batchSize is 2, so 5 files are three batches — each one a checkpoint.
    expect(progress).toEqual([2, 4, 5])
    expect(changed, 'the library fills progressively, not at the end').toEqual([2, 2, 1])
  })

  it('stops when cancelled, and says so', async () => {
    const h = await harness()
    for (let i = 0; i < 6; i++) await h.write(`t${i}.mp3`)
    await h.scanner.addRoot(h.uri)

    const abort = new AbortController()
    h.ctx.on('scan/progress', () => abort.abort())
    const summary = await h.scanner.scan({ signal: abort.signal })

    expect(summary.cancelled).toBe(true)
    expect(summary.added, 'the first batch is kept — that is the checkpoint').toBe(2)
    const kept = await h.db.query('SELECT urn FROM tracks')
    expect(kept).toHaveLength(2)
  })
})

describe('roots', () => {
  it('persists roots and reloads them', async () => {
    const h = await harness()
    const root = await h.scanner.addRoot(h.uri)
    expect(h.scanner.roots).toHaveLength(1)

    const rows = await h.db.query<{ id: string; uri: string }>('SELECT id, uri FROM scan_roots')
    expect(rows[0]).toMatchObject({ id: root.id, uri: h.uri })

    // Adding the same folder twice is a no-op, not a duplicate.
    await h.scanner.addRoot(h.uri)
    expect(h.scanner.roots).toHaveLength(1)
  })

  it('disables a root without forgetting it', async () => {
    const h = await harness()
    await h.write('a.mp3')
    const root = await h.scanner.addRoot(h.uri)
    await h.scanner.setEnabled(root.id, false)

    expect((await h.scanner.scan()).added).toBe(0)
    expect(h.scanner.roots[0]!.enabled).toBe(false)
  })

  it('removing a root can take its tracks with it', async () => {
    const h = await harness()
    await h.write('a.mp3')
    const root = await h.scanner.addRoot(h.uri)
    await h.scanner.scan()

    await h.scanner.removeRoot(root.id, { forgetTracks: true })
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(0)
    expect(await h.db.query('SELECT id FROM scan_roots')).toHaveLength(0)
  })
})

describe('keeping up with the filesystem', () => {
  it('polls on its own where there is neither a watcher nor a background service', async () => {
    // Desktop has both problems: the bridge's `canWatch` is false and
    // `core-background-electron` does not exist yet — so without this fallback
    // there is no automatic rescan at all, and the library silently goes stale.
    const h = await harness({ pollIntervalMinutes: 1 / 600, canWatch: false }) // 100 ms
    await h.write('a.mp3')
    await h.scanner.addRoot(h.uri)
    await h.scanner.scan()
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(1)

    await h.write('b.mp3')
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(
      await h.db.query('SELECT urn FROM tracks'),
      'the new file was picked up without anyone asking',
    ).toHaveLength(2)
  })

  it('runs one scan at a time', async () => {
    // A watch event, a poll and a manual scan can arrive together; two walks
    // would fight over the abort controller and orphan one another.
    const h = await harness()
    for (let i = 0; i < 6; i++) await h.write(`t${i}.mp3`)
    await h.scanner.addRoot(h.uri)

    const [first, second] = await Promise.all([h.scanner.scan(), h.scanner.scan()])
    expect(first, 'the second caller joined the first scan').toBe(second)
    expect(first.added).toBe(6)
    expect(h.codec.metadataReads, 'and no file was read twice').toHaveLength(6)
  })
})

describe('tag handling', () => {
  it('splits an artist tag that names several people', () => {
    // "Artist feat. Other" as free text makes the featured artist unbrowsable.
    expect(splitArtists('Björk feat. Thom Yorke')).toEqual(['Björk', 'Thom Yorke'])
    expect(splitArtists('A; B / C')).toEqual(['A', 'B', 'C'])
    expect(splitArtists(undefined)).toEqual([])
  })

  it('does not split a band whose name contains a slash', () => {
    // AC/DC is one band; "Simon / Garfunkel" is two. The separator is the
    // whitespace, not the slash.
    expect(splitArtists('AC/DC')).toEqual(['AC/DC'])
    expect(splitArtists('Simon / Garfunkel')).toEqual(['Simon', 'Garfunkel'])
    expect(splitArtists('Godspeed You! Black Emperor')).toEqual(['Godspeed You! Black Emperor'])
  })

  it('files sort keys the way a library expects', () => {
    expect(sortKey('The Beatles')).toBe('beatles')
    expect(sortKey('"Heroes"')).toBe('heroes"')
    expect(sortKey(undefined)).toBeUndefined()
  })

  it('falls back to the filename when a file has no title tag', async () => {
    const h = await harness()
    await h.write('01 - Untagged Song.mp3')
    h.codec.tags.clear()
    await h.scanner.addRoot(h.uri)
    await h.scanner.scan()

    // The extension is not part of a title, and the name is URL-decoded.
    const track = await h.db.get<{ title: string }>('SELECT title FROM tracks')
    expect(track?.title).toBe('01 - Untagged Song')
  })
})

describe('identity', () => {
  it('gives different covers of the same size different ids', () => {
    // A single 32-bit round plus the length collides on same-size images often
    // enough to matter at library scale, and a collision silently gives one
    // album another's artwork.
    const a = new Uint8Array(4096).fill(7)
    const b = new Uint8Array(4096).fill(9)
    expect(artworkId(a)).not.toBe(artworkId(b))
    expect(artworkId(a), 'and it stays stable').toBe(artworkId(new Uint8Array(4096).fill(7)))
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const codec: FakeCodec = {
      metadataReads: [],
      artworkReads: [],
      tags: new Map(),
      failures: new Set(),
    }
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-scan-leak-')) })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(codecPlugin(codec))
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
