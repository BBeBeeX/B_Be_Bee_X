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
      name: 'decodes to PCM, or says plainly that decoding is not its job',
      because:
        'a decoder that returns an empty buffer instead of refusing is the one answer nothing ' +
        'downstream can tell from silence',
      async run({ codec, sample }) {
        /*
         * ⚠️ Deliberately two-sided. `ctx.codec.decode` is on the contract
         * because mobile has a real decoder behind it (`AudioDecoder`), while
         * on desktop decoding belongs to the audio engine — Web Audio's
         * `decodeAudioData` in the renderer — and a second decoder in the tag
         * reader would be a second answer to "what can this platform play".
         *
         * So an implementation may decode or may refuse; what it may not do is
         * return something shaped like audio with no audio in it. That is the
         * same rule as MD-1's "absent, not stubbed" and §4.1's "report what
         * could not be decoded, never skip it silently": a caller can handle a
         * refusal, and cannot handle a lie.
         */
        let decoded
        try {
          decoded = await codec.decode(sample.uri)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          assert(
            /audio|decode|not supported|unsupported/i.test(message),
            `a refusal must say where decoding lives, got: ${message}`,
          )
          return
        }

        assert(decoded.sampleRate > 0, `sampleRate must be positive, got ${decoded.sampleRate}`)
        assert(decoded.channels > 0, `channels must be positive, got ${decoded.channels}`)
        assert(
          decoded.pcm.length === decoded.channels,
          `pcm must hold one buffer per channel: ${decoded.pcm.length} for ${decoded.channels}`,
        )
        assert(
          decoded.pcm.every((channel) => channel.length > 0),
          'a decode that succeeded must return samples, not empty buffers',
        )
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
