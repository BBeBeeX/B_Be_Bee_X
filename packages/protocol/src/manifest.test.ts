import { describe, expect, it } from 'vitest'
import { allowsFs, allowsHost, hostMatches, serviceForCapability } from './manifest.js'

describe('hostMatches', () => {
  it('matches an exact host', () => {
    expect(hostMatches('music.example.org', 'music.example.org')).toBe(true)
    expect(hostMatches('music.example.org', 'evil.example.org')).toBe(false)
  })

  it('matches a leading wildcard against subdomains only', () => {
    expect(hostMatches('*.example.org', 'music.example.org')).toBe(true)
    expect(hostMatches('*.example.org', 'a.b.example.org')).toBe(true)
    // The bare apex is NOT matched by *.apex — this is the usual convention
    // and keeps a grant narrower than a reader might assume.
    expect(hostMatches('*.example.org', 'example.org')).toBe(false)
  })

  it('does not let a suffix match a different domain', () => {
    // The dangerous case: 'notexample.org' must not match '*.example.org'.
    expect(hostMatches('*.example.org', 'notexample.org')).toBe(false)
  })

  it('treats a bare * as total', () => {
    expect(hostMatches('*', 'anything.at.all')).toBe(true)
  })
})

describe('allowsHost', () => {
  it('permits only granted patterns', () => {
    const granted = ['net:host/*.example.org', 'db:own']
    expect(allowsHost(granted, 'music.example.org')).toBe(true)
    expect(allowsHost(granted, 'tracker.evil.com')).toBe(false)
  })

  it('denies everything when nothing was granted', () => {
    expect(allowsHost([], 'music.example.org')).toBe(false)
  })
})

describe('allowsFs', () => {
  it('honours scope', () => {
    expect(allowsFs(['fs:read:media'], 'read', 'media')).toBe(true)
    expect(allowsFs(['fs:read:media'], 'read', 'downloads')).toBe(false)
  })

  it('treats :all as covering every scope', () => {
    expect(allowsFs(['fs:read:all'], 'read', 'cache')).toBe(true)
  })

  it('lets write imply read on the same scope', () => {
    expect(allowsFs(['fs:write:downloads'], 'read', 'downloads')).toBe(true)
    // …but never the reverse.
    expect(allowsFs(['fs:read:downloads'], 'write', 'downloads')).toBe(false)
  })
})

describe('serviceForCapability', () => {
  it.each([
    ['fs:read:media', 'fs'],
    ['net:host/*', 'http'],
    ['db:own', 'db'],
    ['secrets:own', 'secrets'],
    ['audio', 'audio'],
    ['mediaSession', 'mediaSession'],
  ])('%s governs %s', (cap, service) => {
    expect(serviceForCapability(cap)).toBe(service)
  })

  it('returns undefined for an unknown capability', () => {
    expect(serviceForCapability('telepathy')).toBeUndefined()
  })
})
