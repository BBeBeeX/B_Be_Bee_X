import { describe, expect, it } from 'vitest'
import { splitArtists } from './text.js'

describe('splitArtists', () => {
  it('splits on punctuation separators, with or without surrounding space', () => {
    expect(splitArtists('A; B')).toEqual(['A', 'B'])
    expect(splitArtists('A,B')).toEqual(['A', 'B'])
    expect(splitArtists('A ;B , C')).toEqual(['A', 'B', 'C'])
  })

  it('splits on a slash only when it stands alone', () => {
    // AC/DC is one band; "Simon / Garfunkel" is two.
    expect(splitArtists('AC/DC')).toEqual(['AC/DC'])
    expect(splitArtists('Simon / Garfunkel')).toEqual(['Simon', 'Garfunkel'])
  })

  it('splits on the written collaboration words', () => {
    expect(splitArtists('A feat. B')).toEqual(['A', 'B'])
    expect(splitArtists('A ft B')).toEqual(['A', 'B'])
    expect(splitArtists('A with B')).toEqual(['A', 'B'])
    expect(splitArtists('A Feat. B')).toEqual(['A', 'B'])
  })

  it('keeps the punctuation the word forms leave behind off the next name', () => {
    // `\bfeat\.?\b` does not match "feat. " — the boundary after `.` is not a
    // word boundary — so the separator here is the word form, and the dot
    // must not ride along.
    expect(splitArtists('A feat. B')).toEqual(['A', 'B'])
  })

  it('drops empty parts from stray separators', () => {
    expect(splitArtists('A; ; B')).toEqual(['A', 'B'])
    expect(splitArtists('  ')).toEqual([])
  })

  it('treats undefined and empty as no artist at all', () => {
    expect(splitArtists(undefined)).toEqual([])
    expect(splitArtists('')).toEqual([])
  })

  it('leaves a single name untouched', () => {
    expect(splitArtists('Kate Bush')).toEqual(['Kate Bush'])
  })
})
