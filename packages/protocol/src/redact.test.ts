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

  it('leaves a redacted url parseable', () => {
    // The header regex used to read `https://host` as the header `https` with
    // value `//host`, rebuild it with a space, and hand back `https: //host` —
    // unparseable. A trace exists to be pasted somewhere.
    for (const url of [
      'https://host/x?t=1',
      'http://127.0.0.1:4533/rest?u=a&t=b',
      'ws://example.org/socket?token=abc',
    ]) {
      const out = redactForTrace(url)
      expect(() => new URL(out), out).not.toThrow()
      expect(out, out).not.toContain(': //')
    }
  })

  it('redacts the query but keeps the url structure intact', () => {
    const out = redactForTrace('https://music.example.org/rest?u=revers&t=abc&s=def')
    const parsed = new URL(out)
    expect(parsed.hostname).toBe('music.example.org')
    expect(parsed.pathname).toBe('/rest')
    expect(parsed.searchParams.get('u')).toBe('revers')
    expect(parsed.searchParams.get('t')).not.toBe('abc')
  })

  it('covers the credential names that actually appear in the wild', () => {
    // Each of these survived redaction until it was measured. `id_token` is a
    // JWT; `client_secret` is exactly what it says.
    const out = redactForTrace(
      'https://x.test/a?key=K&x-api-key=X&client_secret=C&id_token=J&sessionid=S&pwd=P',
    )
    for (const leaked of ['K', 'X', 'C', 'J', 'S', 'P']) {
      expect(out, `${leaked} survived`).not.toContain(`=${leaked}`)
    }
  })

  it('redacts a JSON body, which no query or header rule can see', () => {
    const out = redactForTrace('{"user":"revers","token":"abc123","password":"hunter2"}')
    expect(out).toContain('"user":"revers"')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('hunter2')
  })

  it('redacts a quoted form value without destroying the quotes', () => {
    const out = redactForTrace('token="abc123"&user="revers"')
    expect(out).not.toContain('abc123')
    expect(out).toContain('user="revers"')
  })

  it('redacts credential-named headers beyond Authorization', () => {
    const out = redactForTrace('Api-Key: secret1\nPassword: secret2\nAccept: text/plain')
    expect(out).not.toContain('secret1')
    expect(out).not.toContain('secret2')
    expect(out).toContain('Accept: text/plain')
  })

  it('redacts a JSON value containing an escaped quote', () => {
    // `[^"]*` stopped at the `\"` and left the tail of the secret in the
    // trace — the one outcome this function exists to prevent.
    const out = redactForTrace('{"token":"ab\\"cd","user":"revers"}')
    expect(out).not.toContain('cd')
    expect(out).toContain('"user":"revers"')
  })

  it('does not let one pair swallow the next', () => {
    // A `;`-separated query string put the following pair inside the first
    // value, so the second secret was never examined.
    const out = redactForTrace('a=1;token=SECRET;b=2')
    expect(out).not.toContain('SECRET')
    expect(out).toContain('a=1')
  })

  it('redacts a credential header whose value starts with //', () => {
    // The scheme guard used to be "the value starts with //", which let a
    // header genuinely called `cookie` skip redaction.
    const out = redactForTrace('Cookie: //notaurl-but-secret')
    expect(out).not.toContain('notaurl-but-secret')
  })

  it('stays fast on a long token that never becomes a url', () => {
    // An unbounded scheme label backtracks quadratically before a `://` that
    // never arrives.
    const started = Date.now()
    redactForTrace('a'.repeat(1500) + ' plain text')
    expect(Date.now() - started).toBeLessThan(500)
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
