/**
 * Synthesised audio files, built byte by byte.
 *
 * The corpus generator needs thousands of *parseable* tagged files and needs
 * them in seconds. Shelling out to an encoder gives neither: five thousand
 * process spawns is minutes, and it makes the harness depend on whatever
 * happens to be installed — so the scan test would be green on one machine and
 * absent on another.
 *
 * So the files are written directly. They are real: a valid ID3v2.4 tag over
 * real MPEG-1 Layer III frames, and a real FLAC metadata chain with STREAMINFO
 * and a Vorbis comment block. `music-metadata` reads both the same way it
 * reads a file from a CD rip — tags, artwork, and a duration computed from the
 * stream rather than guessed.
 *
 * What they are *not* is decodable to sound: the MP3 frames are silence and
 * the FLAC carries no audio frames at all. Nothing in the scanner decodes, so
 * nothing in the scanner notices; a test that needs PCM wants a real encode.
 *
 * Dev-only. Nothing here is bundled into either shell.
 */

export interface TagValues {
  title: string
  artist: string
  album: string
  albumArtist?: string
  trackNo?: number
  trackTotal?: number
  discNo?: number
  year?: number
  genre?: string
  /** Written as `REPLAYGAIN_TRACK_GAIN`, e.g. `-7.50 dB`. */
  replayGainDb?: number
  durationMs: number
  /** PNG bytes for the embedded cover, or none. */
  artwork?: Uint8Array
}

/** A 1×1 PNG. Small enough that 5,000 copies cost nothing worth measuring. */
export const TINY_PNG: Uint8Array = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

/* ── MP3 ──────────────────────────────────────────────────────────────── */

const SAMPLE_RATE = 44100
/** MPEG-1 Layer III. Fixed, because the frame maths below assumes it. */
const SAMPLES_PER_FRAME = 1152
/** 128 kbps → `144 * 128000 / 44100`, truncated, as the spec says. */
const MP3_FRAME_BYTES = 417

/** ID3v2 sizes are seven bits per byte, so a size can never contain a sync word. */
function syncsafe(value: number): Uint8Array {
  return Uint8Array.of(
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  )
}

function be32(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** One ID3v2.4 frame: id, syncsafe size, two flag bytes, payload. */
function id3Frame(id: string, payload: Uint8Array): Uint8Array {
  return concat([utf8(id), syncsafe(payload.byteLength), Uint8Array.of(0, 0), payload])
}

/** A text frame. `0x03` is UTF-8, which is the only encoding worth writing. */
function textFrame(id: string, text: string): Uint8Array {
  return id3Frame(id, concat([Uint8Array.of(0x03), utf8(text)]))
}

export function mp3File(tags: TagValues | undefined, options: { durationMs: number }): Uint8Array {
  const frames: Uint8Array[] = []

  if (tags) {
    frames.push(textFrame('TIT2', tags.title))
    frames.push(textFrame('TPE1', tags.artist))
    frames.push(textFrame('TALB', tags.album))
    if (tags.albumArtist) frames.push(textFrame('TPE2', tags.albumArtist))
    if (tags.trackNo) {
      frames.push(
        textFrame('TRCK', tags.trackTotal ? `${tags.trackNo}/${tags.trackTotal}` : String(tags.trackNo)),
      )
    }
    if (tags.discNo) frames.push(textFrame('TPOS', String(tags.discNo)))
    if (tags.year) frames.push(textFrame('TDRC', String(tags.year)))
    if (tags.genre) frames.push(textFrame('TCON', tags.genre))
    if (tags.replayGainDb !== undefined) {
      // ReplayGain has no frame of its own; every writer uses a TXXX with a
      // null-terminated description, which is what readers look for.
      frames.push(
        id3Frame(
          'TXXX',
          concat([
            Uint8Array.of(0x03),
            utf8('REPLAYGAIN_TRACK_GAIN'),
            Uint8Array.of(0),
            utf8(`${tags.replayGainDb.toFixed(2)} dB`),
          ]),
        ),
      )
    }
    if (tags.artwork) {
      frames.push(
        id3Frame(
          'APIC',
          concat([
            Uint8Array.of(0x03),
            utf8('image/png'),
            Uint8Array.of(0),
            Uint8Array.of(0x03), // front cover
            Uint8Array.of(0), // empty description
            tags.artwork,
          ]),
        ),
      )
    }
  }

  const body = concat(frames)
  const header = tags
    ? concat([utf8('ID3'), Uint8Array.of(0x04, 0x00), Uint8Array.of(0x00), syncsafe(body.byteLength)])
    : new Uint8Array(0)

  /*
   * The audio itself.
   *
   * 0xFF 0xFB — sync, MPEG-1, Layer III, no CRC.
   * 0x90      — 128 kbps, 44.1 kHz, no padding.
   * 0xC0      — mono, no emphasis.
   *
   * The payload is zeroed. A decoder renders silence; a *parser* counts frames
   * and reports the duration, which is the only part anything here reads.
   */
  const frameCount = Math.max(1, Math.round((options.durationMs / 1000) * (SAMPLE_RATE / SAMPLES_PER_FRAME)))
  const audio = new Uint8Array(frameCount * MP3_FRAME_BYTES)
  for (let i = 0; i < frameCount; i++) {
    const at = i * MP3_FRAME_BYTES
    audio[at] = 0xff
    audio[at + 1] = 0xfb
    audio[at + 2] = 0x90
    audio[at + 3] = 0xc0
  }

  return concat([header, tags ? body : new Uint8Array(0), audio])
}

/* ── FLAC ─────────────────────────────────────────────────────────────── */

/** A metadata block header: last-block flag in the top bit, then a 24-bit size. */
function flacBlockHeader(type: number, size: number, last: boolean): Uint8Array {
  return Uint8Array.of(
    (last ? 0x80 : 0) | (type & 0x7f),
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
  )
}

/**
 * STREAMINFO, which is where a FLAC's duration comes from.
 *
 * The bit packing is unusual — a 20-bit sample rate, then 3 bits of channel
 * count and 5 of bit depth, then a 36-bit sample total straddling both — so it
 * is written through a bit cursor rather than by hand.
 */
function flacStreamInfo(totalSamples: number): Uint8Array {
  const out = new Uint8Array(34)
  const view = new DataView(out.buffer)
  view.setUint16(0, 4096) // min block size
  view.setUint16(2, 4096) // max block size
  // min/max frame size stay zero: "unknown", which is legal and true here.

  let bitAt = 8 * 10
  const putBits = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) {
      const bit = (value / 2 ** i) & 1
      if (bit) out[bitAt >> 3]! |= 0x80 >> (bitAt & 7)
      bitAt++
    }
  }
  putBits(SAMPLE_RATE, 20)
  putBits(2 - 1, 3) // stereo
  putBits(16 - 1, 5) // 16-bit
  putBits(totalSamples, 36)
  // The trailing 16 bytes are the MD5 of the unencoded audio. Zero means
  // "not computed", which every reader accepts.
  return out
}

function flacVorbisComment(tags: TagValues): Uint8Array {
  const comments: string[] = [
    `TITLE=${tags.title}`,
    `ARTIST=${tags.artist}`,
    `ALBUM=${tags.album}`,
  ]
  if (tags.albumArtist) comments.push(`ALBUMARTIST=${tags.albumArtist}`)
  if (tags.trackNo) comments.push(`TRACKNUMBER=${tags.trackNo}`)
  if (tags.trackTotal) comments.push(`TRACKTOTAL=${tags.trackTotal}`)
  if (tags.discNo) comments.push(`DISCNUMBER=${tags.discNo}`)
  if (tags.year) comments.push(`DATE=${tags.year}`)
  if (tags.genre) comments.push(`GENRE=${tags.genre}`)
  if (tags.replayGainDb !== undefined) {
    comments.push(`REPLAYGAIN_TRACK_GAIN=${tags.replayGainDb.toFixed(2)} dB`)
  }

  const vendor = utf8('BBeBee fixtures')
  const parts: Uint8Array[] = [le32(vendor.byteLength), vendor, le32(comments.length)]
  for (const comment of comments) {
    const bytes = utf8(comment)
    parts.push(le32(bytes.byteLength), bytes)
  }
  return concat(parts)
}

/** Vorbis comments are little-endian, alone among FLAC's fields. */
function le32(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function flacPicture(png: Uint8Array): Uint8Array {
  const mime = utf8('image/png')
  return concat([
    be32(3), // front cover
    be32(mime.byteLength),
    mime,
    be32(0), // empty description
    be32(1), // width
    be32(1), // height
    be32(24), // colour depth
    be32(0), // indexed colours: none
    be32(png.byteLength),
    png,
  ])
}

export function flacFile(tags: TagValues | undefined, options: { durationMs: number }): Uint8Array {
  const totalSamples = Math.round((options.durationMs / 1000) * SAMPLE_RATE)
  const blocks: Uint8Array[] = []

  const streamInfo = flacStreamInfo(totalSamples)
  blocks.push(flacBlockHeader(0, streamInfo.byteLength, !tags), streamInfo)

  if (tags) {
    const comment = flacVorbisComment(tags)
    const hasPicture = Boolean(tags.artwork)
    blocks.push(flacBlockHeader(4, comment.byteLength, !hasPicture), comment)
    if (tags.artwork) {
      const picture = flacPicture(tags.artwork)
      blocks.push(flacBlockHeader(6, picture.byteLength, true), picture)
    }
  }

  return concat([utf8('fLaC'), ...blocks])
}
