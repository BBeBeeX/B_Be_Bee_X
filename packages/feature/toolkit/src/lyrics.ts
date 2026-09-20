/**
 * Pure lyrics parsing and active line synchronization.
 *
 * Zero dependencies, no Cordis, no I/O.
 */

export interface LyricWord {
  text: string
  startMs: number
  endMs: number
}

export interface LyricLine {
  /** Timestamp in milliseconds from the start of the track, or undefined if unsynced. */
  timeMs?: number
  /** The text content of this lyric line. */
  text: string
  /** Optional translated text (e.g. for bilingual display). */
  translation?: string
  /** Optional phonetic / romaji transcription. */
  romaji?: string
  /** Optional word-level breakdown for future word-by-word karaoke highlighting. */
  words?: LyricWord[]
}

export interface ParsedLyrics {
  /** All lyric lines, sorted chronologically if synced. */
  lines: LyricLine[]
  /** True if at least one line has an associated timestamp. */
  synced: boolean
  /** Metadata offset tag value in milliseconds, if present in the LRC header. */
  offsetMs?: number
  /** Song title from [ti:...] tag, if present. */
  title?: string
  /** Artist name from [ar:...] tag, if present. */
  artist?: string
  /** Album title from [al:...] tag, if present. */
  album?: string
  /** LRC author from [by:...] tag, if present. */
  by?: string
}

const TIMESTAMP_REGEX = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const TAG_REGEX = /^\[([a-zA-Z]+):([^\]]*)\]$/
const WORD_TIMESTAMP_REGEX = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>([^<]*)/g

function parseTimeComponents(minStr: string, secStr: string, fracStr?: string): number {
  const min = parseInt(minStr, 10)
  const sec = parseInt(secStr, 10)
  let ms = 0
  if (fracStr !== undefined && fracStr.length > 0) {
    if (fracStr.length === 1) ms = parseInt(fracStr, 10) * 100
    else if (fracStr.length === 2) ms = parseInt(fracStr, 10) * 10
    else ms = parseInt(fracStr.slice(0, 3), 10)
  }
  return min * 60_000 + sec * 1000 + ms
}

/**
 * Parse an LRC or plain-text string into structured `ParsedLyrics`.
 */
export function parseLrc(content: string, options: { offsetMs?: number } = {}): ParsedLyrics {
  const lines = content.split(/\r?\n/)
  const parsedLines: LyricLine[] = []
  let synced = false
  let fileOffsetMs = options.offsetMs ?? 0
  let title: string | undefined
  let artist: string | undefined
  let album: string | undefined
  let by: string | undefined

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Check for metadata tags like [ti:Title], [ar:Artist], [al:Album], [by:Author], [offset:500]
    const tagMatch = trimmed.match(TAG_REGEX)
    if (tagMatch && tagMatch[1] && tagMatch[2] !== undefined) {
      const key = tagMatch[1].toLowerCase()
      const value = tagMatch[2].trim()
      if (key === 'ti') title = value
      else if (key === 'ar') artist = value
      else if (key === 'al') album = value
      else if (key === 'by') by = value
      else if (key === 'offset') {
        const parsed = parseInt(value, 10)
        if (!isNaN(parsed)) fileOffsetMs += parsed
      }
      continue
    }

    // Check for timestamps on this line
    const timestamps: number[] = []
    let match: RegExpExecArray | null

    TIMESTAMP_REGEX.lastIndex = 0
    while ((match = TIMESTAMP_REGEX.exec(trimmed)) !== null) {
      const m1 = match[1]
      const m2 = match[2]
      if (m1 && m2) {
        const ms = parseTimeComponents(m1, m2, match[3])
        timestamps.push(ms)
      }
    }

    if (timestamps.length > 0) {
      synced = true
      // Strip out all leading timestamps to extract the line's text
      let text = trimmed.replace(TIMESTAMP_REGEX, '').trim()

      // Parse word-level timestamps if present, e.g. <00:12.30>word
      let words: LyricWord[] | undefined
      if (text.includes('<')) {
        WORD_TIMESTAMP_REGEX.lastIndex = 0
        const wordList: LyricWord[] = []
        let wMatch: RegExpExecArray | null
        let prevTime: number | undefined

        while ((wMatch = WORD_TIMESTAMP_REGEX.exec(text)) !== null) {
          const wm1 = wMatch[1]
          const wm2 = wMatch[2]
          const wm4 = wMatch[4]
          if (wm1 && wm2 && wm4 !== undefined) {
            const wTime = parseTimeComponents(wm1, wm2, wMatch[3])
            const wText = wm4.trim()
            const lastWord = wordList[wordList.length - 1]
            if (prevTime !== undefined && lastWord) {
              lastWord.endMs = wTime
            }
            if (wText) {
              wordList.push({
                text: wText,
                startMs: wTime,
                endMs: wTime + 500, // default placeholder until next word
              })
            }
            prevTime = wTime
          }
        }

        if (wordList.length > 0) {
          words = wordList
          text = wordList.map((w) => w.text).join(' ')
        }
      }

      for (const timeMs of timestamps) {
        parsedLines.push({
          timeMs,
          text,
          words,
        })
      }
    } else {
      // Line without timestamp (e.g. plain text or intro notes)
      parsedLines.push({
        text: trimmed,
      })
    }
  }

  // If synced, sort timestamps ascending
  if (synced) {
    parsedLines.sort((a, b) => {
      const aTime = a.timeMs ?? -1
      const bTime = b.timeMs ?? -1
      return aTime - bTime
    })
  }

  return {
    lines: parsedLines,
    synced,
    offsetMs: fileOffsetMs !== 0 ? fileOffsetMs : undefined,
    title,
    artist,
    album,
    by,
  }
}

/**
 * Locate the active lyric index for a given position using binary search.
 *
 * Returns -1 if playback is before the first timestamp or if the list has no timestamps.
 */
export function findActiveLyricIndex(
  lines: readonly LyricLine[],
  positionMs: number,
  offsetMs = 0,
): number {
  if (!lines || lines.length === 0) return -1

  const effectiveTime = positionMs + offsetMs

  // Check if before first timed lyric
  const firstTimedIdx = lines.findIndex((l) => l.timeMs !== undefined)
  if (firstTimedIdx === -1) return -1
  const firstTimedLine = lines[firstTimedIdx]
  if (!firstTimedLine || firstTimedLine.timeMs === undefined || effectiveTime < firstTimedLine.timeMs) {
    return -1
  }

  let low = firstTimedIdx
  let high = lines.length - 1
  let activeIndex = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    const line = lines[mid]
    const lineTime = line?.timeMs

    if (lineTime === undefined || lineTime <= effectiveTime) {
      if (lineTime !== undefined) {
        activeIndex = mid
      }
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return activeIndex
}
