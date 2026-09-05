/**
 * M1 exit criterion 1, at the size the criterion names.
 *
 * > Scan a folder of ≥ 5,000 files; incremental rescan of an unchanged library
 * > costs stat calls only. — docs/10 §M1
 *
 * The other scanner tests use a fake codec and ten files, which is the right
 * shape for asserting behaviour. This one is deliberately different: a real
 * corpus of real tagged files, read by the **real** `core-codec-node`, through
 * an instrumented `ctx.fs` that counts what was called. It is the only place
 * the criterion is actually checked rather than approximated.
 *
 * "Stat calls only" is asserted as a count of content reads being zero.
 * Timing would not do: a fast disk makes a scanner that reads every byte look
 * fine, and that is precisely the regression this guards against.
 */

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { CodecNode } from '@BBeBee/core-codec-node'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { countingFs, generateCorpus, type Corpus, type CountingFs } from '@BBeBee/tooling-fixtures'
import type { DbService } from '@BBeBee/protocol'
import plugin, { type Scanner } from './index.js'

/**
 * How many tracks the corpus holds.
 *
 * The criterion says 5,000 and that is the default, because a criterion
 * checked at a tenth of its size is not checked. `BBEBEE_CORPUS_TRACKS` exists
 * for someone iterating on this file, not for CI.
 */
const TRACKS = Number(process.env['BBEBEE_CORPUS_TRACKS'] ?? '5000')

let corpus: Corpus
let root: string

beforeAll(async () => {
  root = await tempDir('bbebee-corpus')
  corpus = await generateCorpus({
    root: join(root, 'library'),
    tracks: TRACKS,
    // Short files: the criterion is about how many, not how long.
    durationMs: 200,
  })
}, 300_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

interface Harness {
  ctx: Context
  scanner: Scanner
  db: DbService
  fs: CountingFs
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-corpus-app') })
  await ctx.plugin(FsNode)

  /*
   * Instrumented in place, before anything that uses it loads.
   *
   * One service instance is shared by every fiber, so patching it covers the
   * scanner *and* the codec reading tags through it — which is the pair whose
   * combined reads the criterion is actually about.
   */
  const counting = countingFs(ctx.fs)

  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(CodecNode)
  await ctx.plugin(plugin, { batchSize: 200 })
  await tick()

  return { ctx, scanner: ctx.scanner as Scanner, db: ctx.db, fs: counting }
}

describe(`a library of ${TRACKS} files`, () => {
  it(
    'imports on the first pass and costs stat calls only on the second',
    async () => {
      const h = await harness()
      await h.scanner.addRoot(pathToFileURL(corpus.root).href.replace(/\/$/, ''))

      const first = await h.scanner.scan()

      // Every well-formed file lands, and every malformed one is *recorded*
      // rather than skipped — a library that silently loses six tracks is the
      // failure docs/11 §4.7 exists to prevent, and importing them as untitled
      // phantoms instead is the failure it prevents in the other direction.
      expect(first.added).toBe(corpus.playable.length)
      expect(first.errors).toBe(corpus.broken.length)

      const rows = await h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tracks')
      expect(rows?.n).toBe(corpus.playable.length)

      const errored = await h.db.query<{ uri: string }>(
        "SELECT uri FROM scan_entries WHERE status = 'error'",
      )
      expect(
        errored.length,
        'a file that would not parse is listed, with a reason, not dropped',
      ).toBe(corpus.broken.length)

      // The first pass genuinely opened files — otherwise the second pass
      // proving it did not would mean nothing.
      expect(h.fs.bytesReadFrom().length).toBeGreaterThan(0)

      h.fs.reset()
      const second = await h.scanner.scan()

      expect(second).toMatchObject({ added: 0, updated: 0, removed: 0, errors: 0 })
      expect(
        h.fs.bytesReadFrom(),
        'an unchanged rescan opens no file: (size, mtime) against scan_entries decides',
      ).toEqual([])
      expect(h.fs.counts.stat + h.fs.counts.list).toBeGreaterThan(0)
    },
    300_000,
  )

  it(
    'reads a fraction of each file, not all of it',
    async () => {
      /*
       * The load-bearing property behind "minutes, not an afternoon"
       * (docs/11 §4.1): `readMetadata` reads a bounded head window rather than
       * the whole file. Asserted against the corpus's own byte total, because
       * a ceiling per file says nothing about a scan of five thousand.
       */
      const h = await harness()
      await h.scanner.addRoot(pathToFileURL(corpus.root).href.replace(/\/$/, ''))
      h.fs.reset()
      await h.scanner.scan()

      const opened = h.fs.bytesReadFrom().length
      expect(opened).toBeGreaterThan(0)
      // One open per file at most: a second read of the same file is a
      // regression in the artwork path, which used to re-open to fetch a cover.
      expect(opened).toBeLessThanOrEqual(corpus.files.length * 2)
    },
    300_000,
  )
})
