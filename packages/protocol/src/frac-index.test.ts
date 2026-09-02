import { describe, expect, it } from 'vitest'
import { FracIndexError, between, needsRebalance, sequence } from './frac-index.js'

const sorted = (keys: string[]) => [...keys].sort()

describe('between', () => {
  it('produces a first key for an empty list', () => {
    const key = between()
    expect(key.length).toBeGreaterThan(0)
    expect(between(undefined, key) < key).toBe(true)
    expect(between(key, undefined) > key).toBe(true)
  })

  it('always lands strictly between its neighbours', () => {
    const a = between()
    const b = between(a)
    const mid = between(a, b)
    expect(a < mid).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('survives repeated insertion at the same point', () => {
    // The pathological case: dragging an item to the same slot over and over.
    let low = between()
    const high = between(low)
    const keys = [low, high]
    for (let i = 0; i < 200; i++) {
      const key = between(low, high)
      expect(low < key && key < high, `${low} < ${key} < ${high}`).toBe(true)
      keys.push(key)
      low = key
    }
    expect(sorted(keys)).toEqual([...new Set(sorted(keys))])
  })

  it('keeps a random insertion sequence in order', () => {
    // A list built by inserting at random positions must still read back in
    // insertion-visible order — the property the queue depends on.
    const items: string[] = [between()]
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(Math.random() * (items.length + 1))
      const key = between(items[at - 1], items[at])
      items.splice(at, 0, key)
    }
    expect(items).toEqual(sorted(items))
    expect(new Set(items).size).toBe(items.length)
  })

  it('refuses neighbours in the wrong order', () => {
    const a = between()
    const b = between(a)
    expect(() => between(b, a)).toThrow(FracIndexError)
    expect(() => between(a, a)).toThrow(FracIndexError)
  })

  it('refuses a key that is not a fractional index', () => {
    expect(() => between('NOT A KEY')).toThrow(FracIndexError)
    // A trailing zero has no midpoint below it, so it is never generated.
    expect(() => between('a0')).toThrow(/trailing zero/)
  })
})

describe('sequence', () => {
  it('returns ascending keys inside the given bounds', () => {
    const keys = sequence(50)
    expect(keys).toHaveLength(50)
    expect(keys).toEqual(sorted(keys))

    const low = between()
    const high = between(low)
    const inner = sequence(10, low, high)
    expect(inner).toEqual(sorted(inner))
    expect(low < inner[0]!).toBe(true)
    expect(inner[inner.length - 1]! < high).toBe(true)
  })

  it('returns nothing for a count of zero', () => {
    expect(sequence(0)).toEqual([])
  })
})

describe('needsRebalance', () => {
  it('fires only once keys have grown long', () => {
    expect(needsRebalance(between())).toBe(false)
    expect(needsRebalance('a'.repeat(40))).toBe(true)
  })
})
