import { describe, expect, it } from 'vitest'
import {
  UrnError,
  formatUrn,
  instanceOf,
  isUrn,
  kindOf,
  orderUrnPair,
  parseUrn,
  tryParseUrn,
} from './urn.js'

describe('parseUrn', () => {
  it('parses a well-formed urn', () => {
    expect(parseUrn('BBeBee:navidrome-home:track:8f1a2c')).toEqual({
      instanceId: 'navidrome-home',
      kind: 'track',
      id: '8f1a2c',
    })
  })

  it('keeps colons in the provider-local id', () => {
    // Some backends use colons in their own identifiers, so only the first
    // three separators are structural.
    const urn = parseUrn('BBeBee:jellyfin:album:a:b:c')
    expect(urn.id).toBe('a:b:c')
    expect(urn.kind).toBe('album')
  })

  it.each([
    ['BBeBee:inst:track', 'too few segments'],
    ['spotify:inst:track:1', 'wrong scheme'],
    ['BBeBee::track:1', 'empty instance'],
    ['BBeBee:inst:song:1', 'unknown kind'],
    ['BBeBee:inst:track:', 'empty id'],
  ])('rejects %s (%s)', (input) => {
    expect(() => parseUrn(input)).toThrow(UrnError)
  })

  it('round-trips through formatUrn', () => {
    const urn = 'BBeBee:local:playlist:favourites'
    expect(formatUrn(parseUrn(urn))).toBe(urn)
  })
})

describe('helpers', () => {
  it('tryParseUrn returns undefined instead of throwing', () => {
    expect(tryParseUrn('nonsense')).toBeUndefined()
    expect(tryParseUrn('BBeBee:a:track:b')).toBeDefined()
  })

  it('extracts the instance and kind', () => {
    expect(instanceOf('BBeBee:nas:artist:9')).toBe('nas')
    expect(kindOf('BBeBee:nas:artist:9')).toBe('artist')
  })

  it('isUrn is a total predicate', () => {
    expect(isUrn('BBeBee:nas:artist:9')).toBe(true)
    expect(isUrn('')).toBe(false)
  })

  it('rejects an instance id containing a separator', () => {
    // Would otherwise produce a urn that reparses into different fields.
    expect(() => formatUrn({ instanceId: 'a:b', kind: 'track', id: '1' })).toThrow(UrnError)
  })
})

describe('orderUrnPair', () => {
  it('is canonical regardless of argument order', () => {
    // track_links stores each pair once, under CHECK (urn_a < urn_b).
    const a = 'BBeBee:local:track:1'
    const b = 'BBeBee:nas:track:2'
    expect(orderUrnPair(a, b)).toEqual(orderUrnPair(b, a))
    expect(orderUrnPair(b, a)[0] < orderUrnPair(b, a)[1]).toBe(true)
  })
})
