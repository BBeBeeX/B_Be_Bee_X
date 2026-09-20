import { describe, expect, it } from 'vitest'
import { findActiveLyricIndex, parseLrc } from './lyrics.js'

describe('parseLrc', () => {
  it('parses standard LRC format with metadata', () => {
    const sample = `
[ti:Sample Title]
[ar:Sample Artist]
[al:Sample Album]
[by:Sample Author]
[offset:500]

[00:01.00]First line
[00:05.50]Second line
[00:10.250]Third line with 3-digit ms
`
    const parsed = parseLrc(sample)
    expect(parsed.title).toBe('Sample Title')
    expect(parsed.artist).toBe('Sample Artist')
    expect(parsed.album).toBe('Sample Album')
    expect(parsed.by).toBe('Sample Author')
    expect(parsed.offsetMs).toBe(500)
    expect(parsed.synced).toBe(true)
    expect(parsed.lines).toHaveLength(3)

    expect(parsed.lines[0]).toEqual({
      timeMs: 1000,
      text: 'First line',
      words: undefined,
    })
    expect(parsed.lines[1]).toEqual({
      timeMs: 5500,
      text: 'Second line',
      words: undefined,
    })
    expect(parsed.lines[2]).toEqual({
      timeMs: 10250,
      text: 'Third line with 3-digit ms',
      words: undefined,
    })
  })

  it('handles multiple timestamps on one line and sorts them', () => {
    const sample = `
[00:15.00][00:02.00]Chorus line
[00:08.00]Verse line
`
    const parsed = parseLrc(sample)
    expect(parsed.lines).toHaveLength(3)
    expect(parsed.lines[0]?.timeMs).toBe(2000)
    expect(parsed.lines[0]?.text).toBe('Chorus line')
    expect(parsed.lines[1]?.timeMs).toBe(8000)
    expect(parsed.lines[1]?.text).toBe('Verse line')
    expect(parsed.lines[2]?.timeMs).toBe(15000)
    expect(parsed.lines[2]?.text).toBe('Chorus line')
  })

  it('handles unsynced plain text', () => {
    const sample = `
First line without timestamp
Second line without timestamp
Third line
`
    const parsed = parseLrc(sample)
    expect(parsed.synced).toBe(false)
    expect(parsed.lines).toHaveLength(3)
    expect(parsed.lines[0]?.timeMs).toBeUndefined()
    expect(parsed.lines[0]?.text).toBe('First line without timestamp')
  })

  it('parses enhanced LRC word timestamps', () => {
    const sample = `
[00:02.00]<00:02.00>Hello <00:02.50>world <00:03.00>again
`
    const parsed = parseLrc(sample)
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]?.timeMs).toBe(2000)
    expect(parsed.lines[0]?.text).toBe('Hello world again')
    expect(parsed.lines[0]?.words).toBeDefined()
    expect(parsed.lines[0]?.words?.length).toBe(3)
    expect(parsed.lines[0]?.words?.[0]).toEqual({
      text: 'Hello',
      startMs: 2000,
      endMs: 2500,
    })
  })
})

describe('findActiveLyricIndex', () => {
  const sample = parseLrc(`
[00:01.00]Line 1
[00:04.00]Line 2
[00:08.00]Line 3
[00:12.00]Line 4
`)

  it('returns -1 before the first lyric', () => {
    expect(findActiveLyricIndex(sample.lines, 500)).toBe(-1)
  })

  it('finds the active lyric at exact start time', () => {
    expect(findActiveLyricIndex(sample.lines, 1000)).toBe(0)
    expect(findActiveLyricIndex(sample.lines, 4000)).toBe(1)
  })

  it('finds the active lyric between timestamps', () => {
    expect(findActiveLyricIndex(sample.lines, 2500)).toBe(0)
    expect(findActiveLyricIndex(sample.lines, 6000)).toBe(1)
    expect(findActiveLyricIndex(sample.lines, 10000)).toBe(2)
  })

  it('remains on the last lyric after the last timestamp', () => {
    expect(findActiveLyricIndex(sample.lines, 15000)).toBe(3)
  })

  it('applies offsetMs properly', () => {
    // 500ms + 600ms offset = 1100ms -> should hit line 0 (starts at 1000ms)
    expect(findActiveLyricIndex(sample.lines, 500, 600)).toBe(0)
    // 4500ms - 1000ms offset = 3500ms -> should hit line 0 (between 1000 and 4000)
    expect(findActiveLyricIndex(sample.lines, 4500, -1000)).toBe(0)
  })

  it('returns -1 for empty or unsynced lines', () => {
    expect(findActiveLyricIndex([], 1000)).toBe(-1)
    const unsynced = parseLrc('Line 1\nLine 2')
    expect(findActiveLyricIndex(unsynced.lines, 1000)).toBe(-1)
  })
})
