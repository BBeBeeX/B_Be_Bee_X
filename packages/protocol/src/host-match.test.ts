/**
 * `allowedHosts` matching.
 *
 * This is a source's own egress declaration (docs/06 §8), so it has two ways
 * to be wrong and both are bad: too loose and the allowlist means nothing,
 * too strict and a legitimate source is stranded with an error whose remedy
 * the matcher itself refuses.
 */

import { describe, expect, it } from 'vitest'
import { declaredHostMatches, hostAllowedBy } from './manifest.js'

describe('exact matches always win', () => {
  it('accepts a single-label LAN host', () => {
    // `http://nas:4533` is a real Navidrome address on a real home network,
    // and import accepts it — so refusing it here stranded the source with
    // "add it to allowedHosts", which the same matcher then refused too.
    expect(hostAllowedBy('nas', ['nas'])).toBe(true)
    expect(hostAllowedBy('music', ['music'])).toBe(true)
    expect(hostAllowedBy('localhost', ['localhost'])).toBe(true)
  })

  it('accepts a docker service name', () => {
    expect(hostAllowedBy('navidrome', ['navidrome'])).toBe(true)
  })

  it('accepts an IPv6 literal, with or without brackets', () => {
    // `new URL('http://[::1]').hostname` keeps the brackets, so an author
    // copying the host out of their own URL writes them too.
    expect(hostAllowedBy('[::1]', ['[::1]'])).toBe(true)
    expect(hostAllowedBy('[::1]', ['::1'])).toBe(true)
    expect(hostAllowedBy('::1', ['[::1]'])).toBe(true)
    expect(hostAllowedBy('[fe80::1]', ['[fe80::1]'])).toBe(true)
  })

  it('accepts an IPv4 literal', () => {
    expect(hostAllowedBy('192.168.1.10', ['192.168.1.10'])).toBe(true)
  })

  it('accepts an ordinary domain', () => {
    expect(hostAllowedBy('music.example.org', ['music.example.org'])).toBe(true)
  })
})

describe('subdomains', () => {
  it('are covered by their parent', () => {
    expect(hostAllowedBy('cdn.example.org', ['example.org'])).toBe(true)
    expect(hostAllowedBy('a.b.example.org', ['example.org'])).toBe(true)
  })

  it('are covered by an explicit wildcard', () => {
    expect(hostAllowedBy('cdn.example.org', ['*.example.org'])).toBe(true)
  })

  it('a wildcard does not cover the apex', () => {
    // `*.example.org` conventionally means subdomains only.
    expect(hostAllowedBy('example.org', ['*.example.org'])).toBe(false)
  })

  it('an IPv6 entry has no subdomains', () => {
    expect(hostAllowedBy('evil.::1', ['::1'])).toBe(false)
  })
})

describe('internationalised names', () => {
  it('matches a unicode declaration against the punycode host a URL yields', () => {
    // `new URL(…).hostname` always punycodes, so an author writing their own
    // host in unicode declared something that could never match — and the
    // stored allowlist was a mixed-script list nobody could reconcile.
    expect(hostAllowedBy('xn--msik-0ra.example', ['müsik.example'])).toBe(true)
    expect(hostAllowedBy('xn--msik-0ra.example', ['xn--msik-0ra.example'])).toBe(true)
  })

  it('matches a punycode subdomain of a unicode declaration', () => {
    expect(hostAllowedBy('cdn.xn--msik-0ra.example', ['müsik.example'])).toBe(true)
  })

  it('canonicalises IPv6 spellings', () => {
    expect(declaredHostMatches('[::1]', '[0:0:0:0:0:0:0:1]')).toBe(true)
    expect(declaredHostMatches('::1', '[::1]')).toBe(true)
  })
})

describe('what must never match', () => {
  it('refuses a bare suffix that is not a subdomain', () => {
    // The classic: `example.org` must not admit `notexample.org`.
    expect(hostAllowedBy('notexample.org', ['example.org'])).toBe(false)
    expect(hostAllowedBy('fakeexample.org', ['example.org'])).toBe(false)
  })

  it('refuses an unrelated host', () => {
    expect(hostAllowedBy('169.254.169.254', ['music.example.org'])).toBe(false)
    expect(hostAllowedBy('evil.test', ['music.example.org'])).toBe(false)
  })

  it('refuses a single-label wildcard base', () => {
    // `*.org` is a wildcard over a whole TLD wearing a small word. It was
    // allowed for one round, after the exact-match fix moved the single-label
    // check onto the wrong arm.
    expect(hostAllowedBy('example.org', ['*.org'])).toBe(false)
    expect(hostAllowedBy('anything.com', ['*.com'])).toBe(false)
    // …including with the trailing-dot spelling an FQDN habit produces.
    expect(hostAllowedBy('example.org', ['*.org.'])).toBe(false)
    // A real domain still works as a wildcard base.
    expect(hostAllowedBy('cdn.example.org', ['*.example.org'])).toBe(true)
  })

  it('refuses a single-label entry as a suffix', () => {
    // `allowedHosts: ["org"]` reads as a modest declaration and must not
    // quietly mean "anywhere in .org" — but it still matches `org` itself,
    // which is the harmless reading.
    expect(hostAllowedBy('example.org', ['org'])).toBe(false)
    expect(hostAllowedBy('anything.com', ['com'])).toBe(false)
    expect(hostAllowedBy('org', ['org'])).toBe(true)
  })

  it('refuses an empty or blank entry', () => {
    expect(hostAllowedBy('example.org', [''])).toBe(false)
    expect(hostAllowedBy('example.org', ['   '])).toBe(false)
    expect(hostAllowedBy('example.org', [])).toBe(false)
  })
})

describe('normalisation', () => {
  it('ignores case', () => {
    expect(declaredHostMatches('MUSIC.Example.ORG', 'music.example.org')).toBe(true)
  })

  it('ignores a trailing FQDN dot on either side', () => {
    // Otherwise the runtime's check and the kernel's gate can disagree about
    // the same address.
    expect(declaredHostMatches('example.org.', 'example.org')).toBe(true)
    expect(declaredHostMatches('example.org', 'example.org.')).toBe(true)
    expect(declaredHostMatches('cdn.example.org.', 'example.org')).toBe(true)
  })

  it('ignores surrounding whitespace in a declaration', () => {
    expect(declaredHostMatches('example.org', '  example.org  ')).toBe(true)
  })
})
