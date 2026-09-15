import { describe, expect, it } from 'vitest'
import { formatBytes } from './bytes.js'

describe('formatBytes', () => {
  it('renders raw bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('steps up through decimal units', () => {
    expect(formatBytes(1000)).toBe('1.0 kB')
    expect(formatBytes(1_500_000)).toBe('1.5 MB')
    expect(formatBytes(2_000_000_000)).toBe('2.0 GB')
  })

  it('prints a whole number once the value is large', () => {
    // `1234.5 MB` is a number nobody repeats; `1.2 GB` is the one they do.
    expect(formatBytes(1234_500_000)).toBe('1.2 GB')
  })

  it('says nothing rather than zero when the size is unknown', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})
