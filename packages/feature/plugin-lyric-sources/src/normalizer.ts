import type { Lyrics } from '@BBeBee/protocol'
import { parseLrc } from '@BBeBee/toolkit'

/**
 * Format milliseconds into standard LRC timestamp tag [mm:ss.xx]
 */
export function formatLrcTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms))
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hundredths = Math.floor((safeMs % 1000) / 10)
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`
}

/**
 * Merge primary LRC lines with translated LRC lines matching timestamps
 */
export function mergeLyricsAndTranslation(mainLrc: string, transLrc: string): string {
  const transParsed = parseLrc(transLrc)
  const transMap = new Map<number, string>()
  for (const line of transParsed.lines) {
    if (line.timeMs !== undefined && line.text.trim()) {
      transMap.set(line.timeMs, line.text.trim())
    }
  }

  const mainParsed = parseLrc(mainLrc)
  if (mainParsed.lines.length === 0) {
    return mainLrc
  }

  const resultLines: string[] = []
  for (const line of mainParsed.lines) {
    if (line.timeMs !== undefined) {
      const tag = formatLrcTimestamp(line.timeMs)
      resultLines.push(`${tag}${line.text}`)
      const trans = transMap.get(line.timeMs)
      if (trans) {
        resultLines.push(`${tag}${trans}`)
      }
    } else {
      resultLines.push(line.text)
    }
  }

  return resultLines.join('\n')
}

/**
 * Normalizes any raw output from sandbox (LRC string, TTML, LRCLIB JSON, line arrays)
 * into standard application `Lyrics`.
 */
export function normalizeToLyrics(raw: unknown): Lyrics | undefined {
  if (raw === null || raw === undefined) return undefined

  // 1. If it's already a well-formed Lyrics object
  if (
    typeof raw === 'object' &&
    'format' in raw &&
    'content' in raw &&
    typeof (raw as Lyrics).content === 'string'
  ) {
    const l = raw as Lyrics
    const content = l.content.trim()
    if (!content) return undefined
    return {
      format: l.format ?? 'lrc',
      content,
      synced: Boolean(l.synced),
      offsetMs: typeof l.offsetMs === 'number' ? l.offsetMs : undefined,
      language: l.language,
    }
  }

  // 2. If it's an object with common API keys (LRCLIB, Netease, etc.)
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    // LRCLIB style
    if (typeof obj.syncedLyrics === 'string' && obj.syncedLyrics.trim()) {
      return normalizeToLyrics(obj.syncedLyrics)
    }
    if (typeof obj.plainLyrics === 'string' && obj.plainLyrics.trim()) {
      return normalizeToLyrics(obj.plainLyrics)
    }

    // Netease / QQ style { lrc: { lyric: "..." }, tlyric: { lyric: "..." } }
    let mainLyricText: string | undefined
    if (typeof obj.lrc === 'object' && obj.lrc !== null && 'lyric' in obj.lrc) {
      mainLyricText = String((obj.lrc as { lyric?: unknown }).lyric ?? '')
    } else if (typeof obj.lrc === 'string') {
      mainLyricText = obj.lrc
    } else if (typeof obj.lyric === 'string') {
      mainLyricText = obj.lyric
    } else if (typeof obj.lyrics === 'string') {
      mainLyricText = obj.lyrics
    }

    if (mainLyricText && mainLyricText.trim()) {
      let tlyricText: string | undefined
      if (typeof obj.tlyric === 'object' && obj.tlyric !== null && 'lyric' in obj.tlyric) {
        tlyricText = String((obj.tlyric as { lyric?: unknown }).lyric ?? '')
      } else if (typeof obj.tlyric === 'string') {
        tlyricText = obj.tlyric
      }

      if (tlyricText && tlyricText.trim()) {
        mainLyricText = mergeLyricsAndTranslation(mainLyricText, tlyricText)
      }
      return normalizeToLyrics(mainLyricText)
    }
  }

  // 3. If it's an array of lyric line items
  if (Array.isArray(raw)) {
    if (raw.length === 0) return undefined
    const lines: string[] = []
    let hasTimestamps = false

    for (const item of raw) {
      if (typeof item === 'string') {
        lines.push(item)
      } else if (typeof item === 'object' && item !== null) {
        const lineObj = item as Record<string, unknown>
        let ms: number | undefined
        if (typeof lineObj.timeMs === 'number') {
          ms = lineObj.timeMs
        } else if (typeof lineObj.seconds === 'number') {
          ms = Math.round(lineObj.seconds * 1000)
        } else if (typeof lineObj.time === 'number') {
          ms = lineObj.time < 1000 ? Math.round(lineObj.time * 1000) : lineObj.time
        }

        const text = String(lineObj.text ?? lineObj.content ?? lineObj.line ?? '')
        if (ms !== undefined) {
          hasTimestamps = true
          const tag = formatLrcTimestamp(ms)
          lines.push(`${tag}${text}`)
          if (lineObj.translation && typeof lineObj.translation === 'string') {
            lines.push(`${tag}${lineObj.translation}`)
          }
        } else if (text) {
          lines.push(text)
        }
      }
    }

    if (lines.length === 0) return undefined
    return {
      format: hasTimestamps ? 'lrc' : 'plain',
      content: lines.join('\n'),
      synced: hasTimestamps,
    }
  }

  // 4. String format processing
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return undefined

    // Try parsing string as JSON first (in case sandbox returned a stringified JSON)
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed)
        const normalized = normalizeToLyrics(parsed)
        if (normalized) return normalized
      } catch {
        // Not valid JSON, continue with text parsing
      }
    }

    // TTML or XML format
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<tt')) {
      return {
        format: 'ttml',
        content: trimmed,
        synced: true,
      }
    }

    // Parse with toolkit parseLrc to detect synced lines
    const parsedLrc = parseLrc(trimmed)
    if (parsedLrc.synced && parsedLrc.lines.length > 0) {
      return {
        format: 'lrc',
        content: trimmed,
        synced: true,
      }
    }

    // Unsynchronized plain text lyrics
    return {
      format: 'plain',
      content: trimmed,
      synced: false,
    }
  }

  return undefined
}
