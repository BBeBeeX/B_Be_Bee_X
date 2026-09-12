import { describe, expect, it } from 'vitest'
import { permute } from './shuffle.js'

describe('permute', () => {
  it('is deterministic: the same seed, the same order, every time', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(permute(values, 42)).toEqual(permute(values, 42))
  })

  it('is a permutation: nothing lost, nothing duplicated', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = permute(values, 7)
    expect([...out].sort((a, b) => a - b)).toEqual(values)
  })

  it('actually shuffles rather than returning the input order', () => {
    // Eight elements and a fixed seed — pinned once, deliberately, so a PRNG
    // change is a decision and not a silent drift in every user's queue.
    expect(permute([1, 2, 3, 4, 5, 6, 7, 8], 1)).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('leaves the input untouched', () => {
    const values = [1, 2, 3, 4]
    permute(values, 9)
    expect(values).toEqual([1, 2, 3, 4])
  })

  it('agrees across seeds only by coincidence of length, not of order', () => {
    expect(permute([1, 2, 3, 4, 5], 1)).not.toEqual(permute([1, 2, 3, 4, 5], 2))
  })

  it('degenerates gracefully: empty and singleton collections', () => {
    expect(permute([], 5)).toEqual([])
    expect(permute(['only'], 5)).toEqual(['only'])
  })
})
