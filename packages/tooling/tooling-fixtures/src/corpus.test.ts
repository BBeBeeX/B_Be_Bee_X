/**
 * The corpus generator's own checks.
 *
 * A fixture nobody tests is a fixture that quietly stops representing what it
 * claims to. These are the three properties the scanner tests lean on:
 * the files parse, the pathological set is what it says it is, and generating
 * five thousand of them stays cheap enough to run in CI.
 */

import { rm } from 'node:fs/promises'
import { readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseBuffer } from 'music-metadata'
import { tempDir } from '@BBeBee/kernel/testing'
import { generateCorpus, type Corpus } from './corpus.js'

let root: string
let corpus: Corpus

beforeAll(async () => {
  root = await tempDir('bbebee-corpus-self')
  corpus = await generateCorpus({ root: join(root, 'lib'), tracks: 300, durationMs: 200, seed: 7 })
}, 120_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('what it produces', () => {
  it('writes files a real parser reads', async () => {
    // Not "writes bytes": the whole point of building these by hand rather
    // than shelling out to an encoder is that they stay genuinely parseable.
    const sample = corpus.playable.filter((p) => p.endsWith('.mp3')).slice(0, 3)
    const flacs = corpus.playable.filter((p) => p.endsWith('.flac')).slice(0, 3)
    expect(sample.length + flacs.length).toBeGreaterThan(3)

    for (const path of [...sample, ...flacs]) {
      const parsed = await parseBuffer(await readFile(path))
      expect(parsed.format.sampleRate, `${basename(path)} has no format`).toBe(44100)
      expect(parsed.common.artist, `${basename(path)} has no artist`).toBeTruthy()
    }
  })

  it('splits playable from broken exactly', () => {
    expect(corpus.playable.length + corpus.broken.length).toBe(corpus.files.length)
    expect(corpus.broken.map((p) => basename(p)).sort()).toEqual([
      'cover.jpg.mp3',
      'empty.mp3',
      'truncated.flac',
    ])
  })

  it('groups into albums and artists rather than 300 singletons', () => {
    // A flat corpus would never exercise the upserts a real library hits on
    // every track, which is most of what the scanner's write path does.
    const albums = new Set(corpus.playable.map((p) => join(p, '..')))
    expect(albums.size).toBeGreaterThan(1)
    expect(albums.size).toBeLessThan(corpus.playable.length)
  })

  it('is reproducible from its seed', async () => {
    const again = await generateCorpus({
      root: join(root, 'again'),
      tracks: 300,
      durationMs: 200,
      seed: 7,
    })
    const strip = (c: Corpus) => c.files.map((p) => p.slice(c.root.length))
    // "A failure at file 3,412 is reproducible" is the claim in the header.
    expect(strip(again)).toEqual(strip(corpus))
  }, 120_000)
})

describe('what it costs', () => {
  it('keeps the long track long in duration, not in bytes', async () => {
    const long = corpus.files.find((p) => basename(p).startsWith('very-long'))!
    const { size } = await stat(long)

    /*
     * ⚠️ The regression this guards.
     *
     * It used to be a three-hour *MP3*, and an MP3's duration is counted from
     * its frames — 413,438 of them, 172 MB, assembled in memory and written to
     * disk for one fixture. On a small tmpfs that is a failed run, and it is
     * pure waste either way: what the file is for is a long duration reaching
     * the scanner's arithmetic.
     */
    expect(size).toBeLessThan(64 * 1024)
    const parsed = await parseBuffer(await readFile(long))
    expect(Math.round(parsed.format.duration ?? 0)).toBe(3 * 60 * 60)
  })

  it('stays small enough that 5,000 files is a CI-sized corpus', () => {
    const perFile = corpus.totalBytes / corpus.files.length
    // ~2.6 KB each at 200 ms with artwork. The scanner's criterion-1 test
    // generates 5,000, so anything much above this makes that run expensive
    // for no added coverage.
    expect(perFile).toBeLessThan(8 * 1024)
  })
})
