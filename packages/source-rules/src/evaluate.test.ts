/**
 * The rule pipeline, end to end.
 *
 * Nearly every case here is a shape a real source document uses, because the
 * language exists to express those and nothing else. The two invariants under
 * test throughout: absent is not empty, and a broken rule fails loudly rather
 * than returning the same "nothing" a merely outdated one does.
 */

import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import {
  RuleEngineUnavailableError,
  engineAvailable,
  evaluate,
  evaluateNodes,
  toText,
} from './evaluate.js'

const doc = {
  'subsonic-response': {
    searchResult3: {
      song: [
        { id: '1', title: 'Jóga', artist: 'Björk', duration: 303, suffix: 'flac' },
        { id: '2', title: 'Bachelorette', artist: 'Björk', duration: 315 },
      ],
    },
  },
}

const site = { block: 'ruleSearch', field: 'title', sourceId: 's1' }
const ctx = (document: unknown = doc, scope = {}) => ({
  document,
  scope,
  site,
  vars: new Map<string, string>(),
})

describe('selection', () => {
  it('reads a field of every element', () => {
    expect(evaluate('$.subsonic-response.searchResult3.song[*].title', ctx())).toEqual([
      'Jóga',
      'Bachelorette',
    ])
  })

  it('keeps objects when asked for nodes rather than text', () => {
    // A list rule selects elements; its fields are then evaluated against one
    // of them, so the objects have to survive the first step.
    const songs = evaluateNodes('$.subsonic-response.searchResult3.song[*]', ctx())
    expect(songs).toHaveLength(2)
    expect((songs[0] as { id: string }).id).toBe('1')
  })

  it('renders a template without touching the document', () => {
    expect(
      evaluate('={{source.url}}/rest/stream', ctx(doc, { source: { url: 'https://x' } })),
    ).toEqual(['https://x/rest/stream'])
  })

  it('runs a regex over the document text', () => {
    // Capture group 1 where there is one — `:(\\d+)kbps` means the number,
    // not the number and the word.
    expect(evaluate(':(\\d+)kbps', ctx('encoded at 320kbps'))).toEqual(['320'])
    expect(evaluate(':\\d+', ctx('320kbps'))).toEqual(['320'])
  })
})

describe('absence is not emptiness', () => {
  it('returns nothing for a path that matches nothing', () => {
    expect(evaluate('$.nope', ctx())).toEqual([])
  })

  it('returns an empty string for a field that is one', () => {
    expect(evaluate('$.a', ctx({ a: '' }))).toEqual([''])
  })

  it('returns an empty string for an empty template, not nothing', () => {
    // A template is text, so "no match" is not something it can mean.
    expect(evaluate('=', ctx())).toEqual([''])
  })
})

describe('alternatives', () => {
  it('takes the first that produces anything', () => {
    // The idiom for a backend that renamed a field: carry both rules and keep
    // working through the change.
    expect(evaluate('$.newName||$.title', ctx({ title: 'Jóga' }))).toEqual(['Jóga'])
  })

  it('falls through several', () => {
    expect(evaluate('$.a||$.b||$.c', ctx({ c: 'third' }))).toEqual(['third'])
  })

  it('does not fall through an empty string, which is a value', () => {
    expect(evaluate('$.a||$.b', ctx({ a: '', b: 'second' }))).toEqual([''])
  })

  it('returns nothing when no alternative matches', () => {
    expect(evaluate('$.a||$.b', ctx({}))).toEqual([])
  })
})

describe('concatenation and interleave', () => {
  it('concatenates in order', () => {
    expect(evaluate('$.a&&$.b', ctx({ a: 'x', b: 'y' }))).toEqual(['x', 'y'])
  })

  it('interleaves two lists', () => {
    expect(evaluate('$.a[*]%%$.b[*]', ctx({ a: [1, 3], b: [2, 4] }))).toEqual(['1', '2', '3', '4'])
  })

  it('interleaves lists of different lengths without dropping the tail', () => {
    expect(evaluate('$.a[*]%%$.b[*]', ctx({ a: [1, 2, 3], b: [9] }))).toEqual(['1', '9', '2', '3'])
  })
})

describe('replacements', () => {
  it('converts seconds to milliseconds, the way every document does', () => {
    // `##$##000` appends three zeroes: a seconds-based API into durationMs.
    expect(evaluate('$.subsonic-response.searchResult3.song[0].duration##$##000', ctx())).toEqual([
      '303000',
    ])
  })

  it('deletes when there is no replacement', () => {
    expect(evaluate('$.t## \\(live\\)', ctx({ t: 'Jóga (live)' }))).toEqual(['Jóga'])
  })

  it('replaces every match by default', () => {
    expect(evaluate('$.t##a##b', ctx({ t: 'aaa' }))).toEqual(['bbb'])
  })

  it('replaces only the first with the ### suffix', () => {
    expect(evaluate('$.t##a##b###', ctx({ t: 'aaa' }))).toEqual(['baa'])
  })

  it('applies to every selected value', () => {
    expect(evaluate('$.list[*]##x##y', ctx({ list: ['ax', 'bx'] }))).toEqual(['ay', 'by'])
  })
})

describe('variables', () => {
  it('captures with @put and reads with @get', () => {
    // The pattern every scraped backend needs: pull a token out of one field
    // and use it two rules later.
    const context = ctx({ tok: 'abc', id: '1' })
    expect(evaluate('@put:{token:$.tok}$.id', context)).toEqual(['1'])
    expect(evaluate('@get:{token}', context)).toEqual(['abc'])
  })

  it('returns nothing for a name that was never captured', () => {
    expect(evaluate('@get:{missing}', ctx())).toEqual([])
  })
})

describe('failing loudly', () => {
  it('raises a RuleError for a malformed path', () => {
    // A valid-but-outdated rule returns nothing; a malformed one must not
    // look the same, or the two are indistinguishable in a trace.
    expect(() => evaluate('@json:$.a[', ctx())).toThrow(RuleError)
  })

  it('names the rule that failed', () => {
    try {
      evaluate('@json:$.a[', ctx())
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).rule).toEqual({ block: 'ruleSearch', field: 'title' })
    }
  })

  it('raises a RuleError for a malformed regex', () => {
    expect(() => evaluate(':(unclosed', ctx('text'))).toThrow(RuleError)
  })

  it('says an engine is unavailable rather than returning nothing', () => {
    // `@js:` needs ctx.js and the markup engines need a parser. Silence here
    // would read as "the backend changed", sending the author to the wrong fix.
    expect(() => evaluate('@js:return 1', ctx())).toThrow(RuleEngineUnavailableError)
    expect(() => evaluate('@css:h3', ctx())).toThrow(RuleEngineUnavailableError)
    expect(() => evaluate('@xpath://a', ctx())).toThrow(RuleEngineUnavailableError)
  })

  it('reports which engines this build has', () => {
    expect(engineAvailable('json')).toBe(true)
    expect(engineAvailable('js')).toBe(false)
  })
})

describe('toText', () => {
  it('stringifies scalars plainly', () => {
    expect(toText('a')).toBe('a')
    expect(toText(3)).toBe('3')
    expect(toText(true)).toBe('true')
  })

  it('treats null and undefined as empty', () => {
    expect(toText(null)).toBe('')
    expect(toText(undefined)).toBe('')
  })

  it('shows an object as JSON, not [object Object]', () => {
    // A rule that selected a subtree by mistake should show what it selected;
    // that is the fastest route to seeing the mistake.
    expect(toText({ a: 1 })).toBe('{"a":1}')
  })
})

/**
 * docs/06 §3.6: "Every error carries the source id, the rule block, the field,
 * and the input excerpt." The first three were there; the fourth was the one
 * §10's "copy trace" actually needs, and it was missing.
 */
describe('what a failed rule tells you about the input', () => {
  const failing = (document: unknown, sourceVar?: string) => {
    try {
      evaluate(':(a+)+b', {
        document,
        scope: sourceVar ? { source: { var: sourceVar } } : {},
        site: { block: 'ruleSearch', field: 'title', sourceId: 's1' },
        vars: new Map(),
      })
      return expect.unreachable('should have thrown') as never
    } catch (error) {
      return error as RuleError
    }
  }

  it('carries the document it was run against', () => {
    // Without this, a renamed backend field and an HTML login page served with
    // a 200 produce the same message and need opposite fixes.
    const error = failing('<html>Please sign in</html>')
    expect(error.excerpt).toContain('Please sign in')
    expect(error.message).toContain('Please sign in')
  })

  it('redacts a credential that reached the document', () => {
    expect(failing('token=hunter2secret&x=1', 'hunter2secret').excerpt).not.toContain('hunter2secret')
  })

  it('redacts a query parameter that looks like a secret', () => {
    // The trace is meant to be pasted into a forum thread. Over-broad on
    // purpose: a stray *** costs a reader nothing.
    expect(failing('https://host/rest/x?u=me&t=abcdef123456').excerpt).not.toContain('abcdef123456')
  })

  it('clips a large document rather than pasting it into a toast', () => {
    const error = failing(JSON.stringify({ songs: Array.from({ length: 500 }, (_, i) => ({ i })) }))
    expect(error.excerpt!.length).toBeLessThan(300)
    expect(error.excerpt).toMatch(/…$/)
  })

  it('still names the block and field', () => {
    expect(failing('x').rule).toEqual({ block: 'ruleSearch', field: 'title' })
    expect(failing('x').sourceId).toBe('s1')
  })

  it('leaves the message alone when there is nothing to excerpt', () => {
    // An engine this build cannot run is not an input failure, and quoting the
    // document would point the author at the wrong thing entirely.
    try {
      evaluate('@css:h3', {
        document: '<h3>x</h3>',
        scope: {},
        site: { block: 'ruleSearch', field: 'title', sourceId: 's1' },
        vars: new Map(),
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).excerpt).toBeUndefined()
      expect((error as Error).message).not.toContain('input was')
    }
  })
})
