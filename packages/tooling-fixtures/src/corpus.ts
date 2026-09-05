/**
 * The corpus generator.
 *
 * M1's first exit criterion is a scan of **≥ 5,000 files** whose second pass
 * costs stat calls only (docs/10 §M1). Five thousand files is not a number you
 * can hand-check into a repository, so they are generated — deterministically,
 * from a seed, so a failure at file 3,412 is reproducible.
 *
 * It also emits the cases every real library contains and no hand-made fixture
 * ever does: a file with no tags, a truncated header, a zero-byte file, emoji
 * in a filename, an extension that lies about its codec, and one very long
 * track. The scanner's error path is then exercised by *default* rather than
 * by someone remembering to (docs/11 §7).
 *
 * Dev-only. Nothing here is bundled into either shell.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { flacFile, mp3File, TINY_PNG, type TagValues } from './audio-files.js'

export interface CorpusOptions {
  /** Directory to fill. Created, and emptied first if it exists. */
  root: string
  /** How many well-formed tracks. The criterion wants at least 5,000. */
  tracks?: number
  /** Per-track duration. Short by default: 5,000 files is the point, not 5,000 minutes. */
  durationMs?: number
  /** Embed cover art. Off makes the corpus about a third smaller. */
  artwork?: boolean
  /** Add the pathological files. On by default — that is the whole idea. */
  pathological?: boolean
  /** Anything reproducible. */
  seed?: number
}

export interface Corpus {
  root: string
  /** Every file written. */
  files: string[]
  /** Files that must import cleanly. */
  playable: string[]
  /**
   * Files the scanner must record with `scan_entries.status = 'error'`.
   *
   * Not "files it may skip": a library that silently loses six tracks is the
   * failure this list exists to catch (docs/11 §4.7).
   */
  broken: string[]
  totalBytes: number
}

/** A small, fast, seedable PRNG. Reproducibility is the only requirement. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ARTIST_WORDS = [
  'Björk', 'Sigur Rós', 'Múm', 'Ólafur', 'Jóhann', 'Kiasmos', 'Amiina',
  'Hildur', 'Ásgeir', 'Emilíana', 'Seabear', 'Sóley', 'Vök', 'Kaleo',
]
const ALBUM_WORDS = [
  'Homogenic', 'Ágætis byrjun', 'Finally We Are No One', 'Riceboy Sleeps',
  'Orphée', 'Swept', 'Kurr', 'Theatre', 'Endless Fall', 'Verses', 'Nótt',
]
const TITLE_WORDS = [
  'Jóga', 'Svefn-g-englar', 'Green Grass of Tunnel', 'Nótt', 'Dauðalogn',
  'Hoppípolla', 'We Have a Map', 'Unravel', 'Bachelorette', 'Hyperballad',
]

/** Filenames a real library contains and a hand-made fixture never does. */
const AWKWARD_NAMES = [
  '01 — Jóga (Álbum Edit).mp3',
  '02 🎧 emoji in the name.mp3',
  "03 apostrophe's & ampersand.mp3",
  '04   spaced   out   .mp3',
  '05 ünïcödé-ñörmalisation.mp3',
]

export async function generateCorpus(options: CorpusOptions): Promise<Corpus> {
  const {
    root,
    tracks = 5000,
    durationMs = 400,
    artwork = true,
    pathological = true,
    seed = 1,
  } = options

  const random = mulberry32(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!

  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })

  const files: string[] = []
  const playable: string[] = []
  const broken: string[] = []
  let totalBytes = 0

  const write = async (path: string, bytes: Uint8Array, ok: boolean) => {
    await writeFile(path, bytes)
    files.push(path)
    ;(ok ? playable : broken).push(path)
    totalBytes += bytes.byteLength
  }

  /*
   * A realistic shape: ten tracks to an album, four albums to an artist.
   *
   * It matters because the scanner groups as it goes, and a corpus of 5,000
   * singletons would never exercise the album and artist upserts that a real
   * library hits five thousand times.
   */
  const perAlbum = 10
  const albumsPerArtist = 4
  const albums = Math.ceil(tracks / perAlbum)
  const cover = artwork ? TINY_PNG : undefined

  for (let albumIndex = 0; albumIndex < albums; albumIndex++) {
    const artistIndex = Math.floor(albumIndex / albumsPerArtist)
    const artist = `${pick(ARTIST_WORDS)} ${artistIndex}`
    const album = `${pick(ALBUM_WORDS)} ${albumIndex}`
    const dir = join(root, sanitise(artist), sanitise(album))
    await mkdir(dir, { recursive: true })

    const inThisAlbum = Math.min(perAlbum, tracks - albumIndex * perAlbum)
    for (let n = 1; n <= inThisAlbum; n++) {
      // Two formats, so the scanner's dispatch on extension is exercised and
      // the corpus is not a test of one parser.
      const asFlac = random() < 0.3
      const tags: TagValues = {
        title: `${pick(TITLE_WORDS)} ${albumIndex}-${n}`,
        artist,
        album,
        albumArtist: artist,
        trackNo: n,
        trackTotal: inThisAlbum,
        discNo: 1,
        year: 1990 + (albumIndex % 30),
        genre: 'Electronic',
        replayGainDb: -Number((random() * 12).toFixed(2)),
        durationMs,
        ...(cover ? { artwork: cover } : {}),
      }
      const name = `${String(n).padStart(2, '0')} ${sanitise(tags.title)}.${asFlac ? 'flac' : 'mp3'}`
      const bytes = asFlac ? flacFile(tags, { durationMs }) : mp3File(tags, { durationMs })
      await write(join(dir, name), bytes, true)
    }
  }

  if (pathological) {
    const dir = join(root, '_pathological')
    await mkdir(dir, { recursive: true })

    const base: TagValues = {
      title: 'Untitled', artist: 'Unknown', album: 'Unknown', durationMs,
    }

    // No tags at all. Importable — the scanner falls back to the filename —
    // so this is `playable`, not `broken`.
    await write(join(dir, 'no-tags.mp3'), mp3File(undefined, { durationMs }), true)

    // A truncated header: the first 12 bytes of a FLAC and nothing else.
    await write(join(dir, 'truncated.flac'), flacFile(base, { durationMs }).slice(0, 12), false)

    // Zero bytes. A partial copy, or a sync that failed halfway.
    await write(join(dir, 'empty.mp3'), new Uint8Array(0), false)

    // An extension that lies: FLAC bytes behind an `.mp3` name. The scanner
    // must trust the bytes, not the name — a reader dispatching on extension
    // reports "corrupt" for a file that is perfectly fine.
    await write(join(dir, 'actually-flac.mp3'), flacFile(base, { durationMs }), true)

    // Not audio at all.
    await write(join(dir, 'cover.jpg.mp3'), TINY_PNG, false)

    /*
     * One very long track: an audiobook or a DJ set.
     *
     * FLAC rather than MP3, and not for variety. An MP3's duration is *counted*
     * from its frames, so three hours of it is 413,438 frames — 172 MB, built
     * in memory and then written to disk, for one fixture. A FLAC's duration is
     * a field in STREAMINFO, so the same three hours costs about four hundred
     * bytes. What this file is for is a long *duration* reaching the scanner's
     * arithmetic, not a long file reaching the disk.
     */
    await write(
      join(dir, 'very-long.flac'),
      flacFile({ ...base, title: 'Three hours', durationMs: 3 * 60 * 60 * 1000 }, {
        durationMs: 3 * 60 * 60 * 1000,
      }),
      true,
    )

    // Awkward names, with real tags behind them.
    for (const [index, name] of AWKWARD_NAMES.entries()) {
      await write(
        join(dir, name),
        mp3File({ ...base, title: name, trackNo: index + 1, ...(cover ? { artwork: cover } : {}) }, {
          durationMs,
        }),
        true,
      )
    }
  }

  return { root, files, playable, broken, totalBytes }
}

/** Keep a path segment portable: no separators, no trailing dots or spaces. */
function sanitise(value: string): string {
  return value.replace(/[/\\:*?"<>|]/g, '_').replace(/[. ]+$/, '') || 'untitled'
}
