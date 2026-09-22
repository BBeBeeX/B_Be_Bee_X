import { describe, expect, it } from 'vitest'
import { formatLogArguments } from './logging.js'

describe('formatLogArguments', () => {
  it('handles empty or missing arguments', () => {
    expect(formatLogArguments([])).toEqual({ text: '', fullMessage: '', unused: [] })
    expect(formatLogArguments(undefined as unknown as unknown[])).toEqual({
      text: '',
      fullMessage: '',
      unused: [],
    })
  })

  it('formats %s placeholders with strings, booleans, and numbers', () => {
    const result = formatLogArguments([
      'scanner: scanning specified dir %s (%s)',
      'dir-1',
      'file:///music',
    ])
    expect(result.text).toBe('scanner: scanning specified dir dir-1 (file:///music)')
    expect(result.fullMessage).toBe('scanner: scanning specified dir dir-1 (file:///music)')
    expect(result.unused).toEqual([])
  })

  it('formats %d and %i placeholders as numbers', () => {
    const result = formatLogArguments([
      'scanner: starting scan on %d specified dir(s) (full=%s)',
      0,
      false,
    ])
    expect(result.text).toBe('scanner: starting scan on 0 specified dir(s) (full=false)')
    expect(result.fullMessage).toBe('scanner: starting scan on 0 specified dir(s) (full=false)')
    expect(result.unused).toEqual([])
  })

  it('formats multiple %d, %s placeholders like scanner summary', () => {
    const result = formatLogArguments([
      'scanner: scan completed (added=%d, updated=%d, removed=%d, errors=%d, cancelled=%s)',
      1,
      2,
      3,
      0,
      true,
    ])
    expect(result.text).toBe(
      'scanner: scan completed (added=1, updated=2, removed=3, errors=0, cancelled=true)',
    )
    expect(result.fullMessage).toBe(
      'scanner: scan completed (added=1, updated=2, removed=3, errors=0, cancelled=true)',
    )
    expect(result.unused).toEqual([])
  })

  it('preserves literal percent when not followed by specifier or when %% is used', () => {
    expect(formatLogArguments(['progress: 100% complete']).fullMessage).toBe('progress: 100% complete')
    expect(formatLogArguments(['rate: 50%% done']).fullMessage).toBe('rate: 50% done')
  })

  it('formats %j, %o, %O with serialized JSON', () => {
    const result = formatLogArguments(['data: %j', { a: 1, b: 'two' }])
    expect(result.fullMessage).toBe('data: {"a":1,"b":"two"}')
  })

  it('formats %f with float numbers', () => {
    const result = formatLogArguments(['float: %f', 3.14159])
    expect(result.fullMessage).toBe('float: 3.14159')
  })

  it('formats Error instance cleanly in %s', () => {
    const err = new Error('disk full')
    const result = formatLogArguments(['failed: %s', err])
    expect(result.fullMessage).toContain('failed: Error: disk full')
  })

  it('handles Error instance as first argument', () => {
    const err = new Error('crash')
    const result = formatLogArguments([err])
    expect(result.fullMessage).toContain('Error: crash')
  })

  it('appends unused arguments to fullMessage and keeps them in unused', () => {
    const result = formatLogArguments(['settings: update', { volume: 0.8 }])
    expect(result.text).toBe('settings: update')
    expect(result.fullMessage).toBe('settings: update {"volume":0.8}')
    expect(result.unused).toEqual([{ volume: 0.8 }])
  })

  it('redacts sensitive credentials in templates and argument values', () => {
    const result = formatLogArguments([
      'fetching %s with auth: %s',
      'https://user:secret@music.com/?token=xyz789',
      'bearer abcdef123456',
    ])
    expect(result.fullMessage).not.toContain('secret@')
    expect(result.fullMessage).not.toContain('xyz789')
    expect(result.fullMessage).not.toContain('abcdef123456')
    expect(result.fullMessage).toContain('[redacted]')
  })
})
