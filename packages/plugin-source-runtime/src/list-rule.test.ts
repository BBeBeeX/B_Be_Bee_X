/**
 * The two-stage list evaluation.
 *
 * `trackList` selects the repeating element; every other field runs against
 * *one* of them. Most of what can go wrong here goes wrong quietly — a row
 * short of a field, a blank id, a page the backend repeated — so the tests are
 * mostly about what gets counted rather than what gets returned.
 */

import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import { evaluateListRule, rowToTrack } from './list-rule.js'

const ctx = (document: unknown) => ({
  document,
  scope: {},
  sourceId: 's1',
  block: 'ruleSearch',
})

const rule = {
  trackList: '$.songs[*]',
  trackId: '$.id',
  title: '$.title',
  artist: '$.artist',
}

describe('rows', () => {
  it('evaluates each field against its own element', () => {
    const { rows } = evaluateListRule(rule, ctx({
      songs: [{ id: '1', title: 'A', artist: 'X' }, { id: '2', title: 'B', artist: 'Y' }],
    }))
    expect(rows.map((r) => r.title)).toEqual(['A', 'B'])
    expect(rows.map((r) => r.artist)).toEqual(['X', 'Y'])
  })

  it('drops a row missing a required field, and counts the drop', () => {
    // A search silently returning three of twenty results reads as a thin
    // backend rather than as a broken rule.
    const { rows, dropped } = evaluateListRule(rule, ctx({
      songs: [{ id: '1', title: 'A' }, { id: '2' }],
    }))
    expect(rows).toHaveLength(1)
    expect(dropped).toBe(1)
  })

  it('counts a repeated id rather than letting it overwrite', () => {
    const { rows, duplicates } = evaluateListRule(rule, ctx({
      songs: [{ id: '1', title: 'A' }, { id: '1', title: 'A again' }],
    }))
    expect(rows).toHaveLength(1)
    expect(duplicates).toBe(1)
  })
})

describe('a value that is only whitespace', () => {
  it('is absence, not a value', () => {
    /*
     * `"  "` passed the empty check, so a blank cell became the URN
     * `BBeBee:s1:track:  ` — an id that looks real, collides with every other
     * blank one on the page, and cannot be typed back.
     */
    const { rows, dropped } = evaluateListRule(rule, ctx({
      songs: [{ id: '  ', title: 'A' }],
    }))
    expect(rows).toHaveLength(0)
    expect(dropped).toBe(1)
  })

  it('drops a blank title for the same reason', () => {
    expect(evaluateListRule(rule, ctx({ songs: [{ id: '1', title: '\n\t' }] })).dropped).toBe(1)
  })

  it('trims a padded id, because a URN segment cannot carry the padding', () => {
    const { rows } = evaluateListRule(rule, ctx({ songs: [{ id: ' 42 ', title: 'A' }] }))
    expect(rows[0]!.trackId).toBe('42')
    expect(rowToTrack(rows[0]!, 's1', 'ruleSearch').urn).toBe('BBeBee:s1:track:42')
  })
})

describe('a document that is not JSON at all', () => {
  it('says so rather than reporting an empty backend', () => {
    /*
     * `fetch.ts` hands a body on as text when it does not parse as JSON —
     * which is exactly what a backend does when it serves an HTML login page
     * with a 200. A JSONPath against that returned nothing, and a search
     * reporting zero results reads as "no matches", not "you are signed out".
     */
    const failure = () => evaluateListRule(rule, ctx('<html><body>Please sign in</body></html>'))
    expect(failure).toThrow(RuleError)
    expect(failure).toThrow(/HTML page/)
  })

  it('puts the body in the message, so the cause is visible', () => {
    try {
      evaluateListRule(rule, ctx('<html>Service temporarily unavailable</html>'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).excerpt).toContain('Service temporarily unavailable')
    }
  })

  it('names the block and field it was evaluating', () => {
    try {
      evaluateListRule(rule, ctx('not json'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).rule).toEqual({ block: 'ruleSearch', field: 'trackList' })
    }
  })
})

describe('a malformed field rule', () => {
  it('fails inside the taxonomy, naming the field', () => {
    // `parseRule` throws `RuleSyntaxError`, which is not a `SourceError` — so
    // it used to escape past every handler that branches on `code` and surface
    // as "something went wrong".
    try {
      evaluateListRule({ ...rule, artist: '$.a|||$.b' }, ctx({ songs: [{ id: '1', title: 'A' }] }))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RuleError)
      expect((error as RuleError).rule.field).toBe('artist')
    }
  })

  it('fails once, before any row is built', () => {
    // Parsed per row, the same error was raised identically fifty times.
    const many = { songs: Array.from({ length: 50 }, (_, i) => ({ id: String(i), title: 'A' })) }
    expect(() => evaluateListRule({ ...rule, artist: '$.a|||$.b' }, ctx(many))).toThrow(RuleError)
  })
})
