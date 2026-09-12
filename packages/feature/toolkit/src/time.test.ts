import { describe, expect, it } from 'vitest'
import { formatDuration } from './time.js'

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9_000)).toBe('0:09')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(599_000)).toBe('9:59')
  })

  it('pads the minutes only once there are hours', () => {
    // 1:05:00, not 1:5:00 — and 5:00, not 05:00.
    expect(formatDuration(3_900_000)).toBe('1:05:00')
    expect(formatDuration(300_000)).toBe('5:00')
  })

  it('truncates rather than rounds', () => {
    // A track showing 3:34 the instant before it ends is right; showing 3:35
    // for a 3:34 track is the kind of wrong a user notices once and remembers.
    expect(formatDuration(3999)).toBe('0:03')
  })

  it('shows a placeholder rather than a lie when the duration is unknown', () => {
    // A live stream has no duration, and `0:00` would claim it does.
    expect(formatDuration(undefined)).toBe('--:--')
    expect(formatDuration(Number.NaN)).toBe('--:--')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('--:--')
    expect(formatDuration(-1)).toBe('--:--')
  })

  it('handles a long track without breaking down', () => {
    expect(formatDuration(7_265_000)).toBe('2:01:05')
  })
})
