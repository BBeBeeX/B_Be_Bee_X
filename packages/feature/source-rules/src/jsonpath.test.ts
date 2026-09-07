/**
 * JSONPath, against the shapes real documents use.
 *
 * The Subsonic corpus document drives most of these: `$.subsonic-response.
 * searchResult3.song[*]` is the exact rule a working source ships with.
 */

import { describe, expect, it } from 'vitest'
import { parseJsonPath, queryJsonPath } from './jsonpath.js'
import { parseRule } from './parse.js'
import { RuleSyntaxError } from './syntax-error.js'

const doc = {
  'subsonic-response': {
    searchResult3: {
      song: [
        { id: '1', title: 'Jóga', artist: 'Björk' },
        { id: '2', title: 'Bachelorette', artist: 'Björk' },
      ],
    },
    status: 'ok',
  },
}

describe('queries', () => {
  it('reads a nested property, hyphens included', () => {
    // `subsonic-response` is the name that breaks a tokeniser treating `-` as
    // structural, and it is in every Subsonic document.
    expect(queryJsonPath(doc, '$.subsonic-response.status')).toEqual(['ok'])
  })

  it('reads every element of an array', () => {
    const songs = queryJsonPath(doc, '$.subsonic-response.searchResult3.song[*]')
    expect(songs).toHaveLength(2)
    expect((songs[0] as { title: string }).title).toBe('Jóga')
  })

  it('reads one element by index', () => {
    expect(queryJsonPath(doc, '$.subsonic-response.searchResult3.song[1].id')).toEqual(['2'])
  })

  it('counts a negative index from the end', () => {
    // How a document reaches "the last one" without knowing the length.
    expect(queryJsonPath(doc, '$.subsonic-response.searchResult3.song[-1].id')).toEqual(['2'])
  })

  it('reads a quoted property', () => {
    expect(queryJsonPath(doc, "$['subsonic-response']['status']")).toEqual(['ok'])
    expect(queryJsonPath(doc, '$["subsonic-response"]["status"]')).toEqual(['ok'])
  })

  it('walks every value of an object with .*', () => {
    expect(queryJsonPath({ a: 1, b: 2 }, '$.*')).toEqual([1, 2])
  })

  it('descends to every matching name', () => {
    expect(queryJsonPath(doc, '$..title')).toEqual(['Jóga', 'Bachelorette'])
  })

  it('maps across a wildcard, so a field of every element comes back', () => {
    expect(queryJsonPath(doc, '$.subsonic-response.searchResult3.song[*].id')).toEqual(['1', '2'])
  })

  it('returns the root for $', () => {
    expect(queryJsonPath(doc, '$')).toEqual([doc])
  })
})

describe('absence', () => {
  it('returns nothing for a path that does not match', () => {
    expect(queryJsonPath(doc, '$.nope.deeper')).toEqual([])
  })

  it('returns nothing for an index past the end', () => {
    expect(queryJsonPath(doc, '$.subsonic-response.searchResult3.song[9]')).toEqual([])
  })

  it('does not confuse null with absent', () => {
    // A field present and null is a value the caller may want to see; a
    // missing field is not. Folding them together loses that.
    expect(queryJsonPath({ a: null }, '$.a')).toEqual([null])
    expect(queryJsonPath({}, '$.a')).toEqual([])
  })

  it('does not reach through the prototype chain', () => {
    expect(queryJsonPath({}, '$.constructor')).toEqual([])
    expect(queryJsonPath({}, '$.toString')).toEqual([])
  })
})

describe('syntax errors', () => {
  it('refuses a path that does not start with $', () => {
    // "No results" is exactly what a valid-but-wrong path returns, so a
    // malformed one has to fail differently or the two are indistinguishable.
    expect(() => parseJsonPath('a.b')).toThrow(RuleSyntaxError)
  })

  it('refuses an unclosed bracket', () => {
    expect(() => parseJsonPath('$.a[0')).toThrow(/unclosed/)
  })

  it('refuses a filter expression rather than silently ignoring it', () => {
    // Filters are a scripting surface inside the declarative half of the
    // language; `@js:` is where computation belongs.
    expect(() => parseJsonPath('$.a[?(@.b==1)]')).toThrow(RuleSyntaxError)
  })

  it('refuses a stray character', () => {
    expect(() => parseJsonPath('$!x')).toThrow(RuleSyntaxError)
  })

  it('names the path in the message, so the failing rule is identifiable', () => {
    expect(() => parseJsonPath('$.a[')).toThrow(/\$\.a\[/)
  })
})

describe('one error class, not two', () => {
  it('reports a bad path and a bad rule as the same type', () => {
    /*
     * There used to be two classes both named `RuleSyntaxError`, and only the
     * JSONPath one was exported from the package. A caller catching it handled
     * a bad path and fell straight through on a bad rule — same name, different
     * identity, and nothing in the compiler to say so.
     */
    const path = tryCatch(() => parseJsonPath('a.b'))
    const rule = tryCatch(() => parseRule('$.a|||$.b'))
    expect(path).toBeInstanceOf(RuleSyntaxError)
    expect(rule).toBeInstanceOf(RuleSyntaxError)
    expect(rule!.constructor).toBe(path!.constructor)
  })

  it('keeps saying which grammar refused the string', () => {
    // The distinction the two classes drew was real; it just did not need to
    // be an identity.
    expect(tryCatch(() => parseJsonPath('a.b'))).toMatchObject({ dialect: 'JSONPath' })
    expect(tryCatch(() => parseRule('$.a|||$.b'))).toMatchObject({ dialect: 'rule' })
    expect(tryCatch(() => parseJsonPath('a.b'))!.message).toContain('bad JSONPath')
    expect(tryCatch(() => parseRule('$.a|||$.b'))!.message).toContain('bad rule')
  })
})

function tryCatch(fn: () => unknown): RuleSyntaxError | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return error as RuleSyntaxError
  }
}
