import { describe, expect, it } from 'vitest'
import { assertSafeForTrace, redactForTrace } from './redact.js'

describe('redactForTrace', () => {
  it('strips secret query parameters, keeping the shape of the url', () => {
    // Subsonic's own auth scheme is the motivating case: `t` is a password
    // hash and `s` is its salt, both in the query string of every request.
    const out = redactForTrace(
      'https://music.example.org/rest/search3?query=bjork&u=revers&t=abc123&s=deadbeef',
    )
    expect(out).toContain('query=bjork')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('deadbeef')
    expect(out).toContain('music.example.org')
  })

  it('strips userinfo from a url', () => {
    expect(redactForTrace('https://user:hunter2@music.example.org/x')).not.toContain('hunter2')
  })

  it('removes the source variable wherever it appears, encoded or not', () => {
    // The variable is secret because of where it came from, not what it looks
    // like — no pattern would catch it.
    const secret = 'p@ss word'
    const out = redactForTrace(
      `https://x.test/a?opaque=${encodeURIComponent(secret)}&b=${secret}`,
      [secret],
    )
    expect(out).not.toContain(secret)
    expect(out).not.toContain(encodeURIComponent(secret))
  })

  it('ignores a very short "secret" rather than redacting everything', () => {
    // A one-character variable would otherwise turn the whole trace to noise.
    expect(redactForTrace('https://x.test/aaa', ['a'])).toContain('aaa')
  })

  it('strips credential headers but keeps the rest', () => {
    const out = redactForTrace('Authorization: Bearer secret-token\nAccept: application/json')
    expect(out).not.toContain('secret-token')
    expect(out).toContain('Accept: application/json')
  })

  it('strips secret-looking body parameters', () => {
    const out = redactForTrace('username=revers&password=hunter2')
    expect(out).toContain('username=revers')
    expect(out).not.toContain('hunter2')
  })

  it('truncates, so a trace stays readable', () => {
    expect(redactForTrace('a'.repeat(5000))).toHaveLength(2000 + '… (truncated)'.length)
  })

  it('leaves ordinary text alone', () => {
    expect(redactForTrace('trackList matched 12 items')).toBe('trackList matched 12 items')
  })

  it('survives a malformed url without throwing', () => {
    expect(() => redactForTrace('https://[not a url')).not.toThrow()
  })

  it('truncates even text the runtime vouches for', () => {
    expect(assertSafeForTrace('x'.repeat(5000)).length).toBeLessThan(5000)
  })
})
