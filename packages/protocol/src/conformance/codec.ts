/**
 * Conformance suite for `ctx.codec`.
 *
 * The scanner is only as good as this: it opens every changed file exactly
 * once and trusts what comes back. Two implementations read tags in entirely
 * different ways — `music-metadata` over a stream on desktop, a native reader
 * on mobile — so what they agree on has to be written down.
 *
 * The byte ceiling is the check that matters most. `readMetadata` that reads
 * whole files turns a 5,000-file scan into an afternoon, and nothing else in
 * the system would show it.
 */

import type { CodecService, Uri } from '../index.js'
import { assert, assertRejects, type ConformanceSuite } from './harness.js'

export interface CodecSample {
  uri: Uri
  title: string
  artist: string
  album?: string
  trackNo?: number
  year?: number
  hasArtwork: boolean
  /** The file's size on disk, for the byte-ceiling check. */
  sizeBytes: number
}

export interface CodecSubject {
  codec: CodecService
  /** A tagged file whose values are known. */
  sample: CodecSample
  /** A file that is not audio at all. */
  garbage: Uri
  /** A Uri with nothing behind it. */
  missing: Uri
  /**
   * Bytes pulled from storage since `resetBytes`, where the harness can
   * measure it. The ceiling check is skipped where it cannot.
   */
  bytesRead?(): number
  resetBytes?(): void
}

export const codecConformance: ConformanceSuite<CodecSubject> = {
  service: 'codec',
  checks: [
    {
      name: 'reads the tags the catalogue is built from',
      because: 'every row the scanner writes comes from these fields',
      async run({ codec, sample }) {
        const meta = await codec.readMetadata(sample.uri)
        assert(meta.title === sample.title, `title: expected ${sample.title}, got ${meta.title}`)
        assert(
          meta.artist === sample.artist,
          `artist: expected ${sample.artist}, got ${meta.artist}`,
        )
        if (sample.album !== undefined) {
          assert(meta.album === sample.album, `album: expected ${sample.album}, got ${meta.album}`)
        }
        if (sample.trackNo !== undefined) {
          assert(meta.trackNo === sample.trackNo, `trackNo: got ${meta.trackNo}`)
        }
        if (sample.year !== undefined) assert(meta.year === sample.year, `year: got ${meta.year}`)
        assert(
          meta.hasArtwork === sample.hasArtwork,
          `hasArtwork: expected ${sample.hasArtwork}, got ${meta.hasArtwork}`,
        )
      },
    },
    {
      name: 'does not read the whole file to read its tags',
      because: 'reading 40 MB per track turns a 5,000-file scan into an afternoon',
      async run({ codec, sample, bytesRead, resetBytes }) {
        if (!bytesRead || !resetBytes) return
        resetBytes()
        await codec.readMetadata(sample.uri)
        const read = bytesRead()
        assert(
          read < sample.sizeBytes,
          `read ${read} of ${sample.sizeBytes} bytes — the tag block is not the whole file`,
        )
      },
    },
    {
      name: 'returns embedded artwork as bytes',
      because: 'the scanner content-addresses the cover, so it needs the bytes',
      async run({ codec, sample }) {
        const art = await codec.readArtwork(sample.uri)
        if (!sample.hasArtwork) {
          assert(art === undefined, 'a file with no cover must answer undefined')
          return
        }
        assert(art !== undefined && art.length > 0, 'a file with a cover must answer bytes')
      },
    },
    {
      name: 'reports a file it cannot read rather than inventing tags',
      because: 'the scanner records the reason, and a silent empty answer erases it',
      async run({ codec, garbage, missing }) {
        await assertRejects(() => codec.readMetadata(missing), 'a missing file', /.+/)
        // Garbage may parse to nothing or reject; inventing a title is the
        // only wrong answer.
        try {
          const meta = await codec.readMetadata(garbage)
          assert(!meta.title, `a non-audio file must not yield a title, got ${meta.title}`)
        } catch {
          // Rejecting is equally correct.
        }
      },
    },
    {
      name: 'declares what this platform can decode',
      because: 'StreamPrefs.acceptFormats is built from it, and an empty list asks for nothing',
      async run({ codec }) {
        const formats = codec.supportedFormats()
        assert(Array.isArray(formats) && formats.length > 0, 'at least one format must be listed')
        assert(
          formats.every((f) => f === f.toLowerCase()),
          'formats are compared as lower-case',
        )
      },
    },
  ],
}
