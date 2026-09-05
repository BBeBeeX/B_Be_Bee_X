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
  it('evaluates each field against its own element', async () => {
    const { rows } = await evaluateListRule(rule, ctx({
      songs: [{ id: '1', title: 'A', artist: 'X' }, { id: '2', title: 'B', artist: 'Y' }],
    }))
    expect(rows.map((r) => r.title)).toEqual(['A', 'B'])
    expect(rows.map((r) => r.artist)).toEqual(['X', 'Y'])
  })

  it('drops a row missing a required field, and counts the drop', async () => {
    // A search silently returning three of twenty results reads as a thin
    // backend rather than as a broken rule.
    const { rows, dropped } = await evaluateListRule(rule, ctx({
      songs: [{ id: '1', title: 'A' }, { id: '2' }],
    }))
    expect(rows).toHaveLength(1)
    expect(dropped).toBe(1)
  })

  it('counts a repeated id rather than letting it overwrite', async () => {
    const { rows, duplicates } = await evaluateListRule(rule, ctx({
      songs: [{ id: '1', title: 'A' }, { id: '1', title: 'A again' }],
    }))
    expect(rows).toHaveLength(1)
    expect(duplicates).toBe(1)
  })
})

describe('a value that is only whitespace', () => {
  it('is absence, not a value', async () => {
    /*
     * `"  "` passed the empty check, so a blank cell became the URN
     * `BBeBee:s1:track:  ` — an id that looks real, collides with every other
     * blank one on the page, and cannot be typed back.
     */
    const { rows, dropped } = await evaluateListRule(rule, ctx({
      songs: [{ id: '  ', title: 'A' }],
    }))
    expect(rows).toHaveLength(0)
    expect(dropped).toBe(1)
  })

  it('drops a blank title for the same reason', async () => {
    const { dropped } = await evaluateListRule(rule, ctx({ songs: [{ id: '1', title: '\n\t' }] }))
    expect(dropped).toBe(1)
  })

  it('trims a padded id, because a URN segment cannot carry the padding', async () => {
    const { rows } = await evaluateListRule(rule, ctx({ songs: [{ id: ' 42 ', title: 'A' }] }))
    expect(rows[0]!.trackId).toBe('42')
    expect(rowToTrack(rows[0]!, 's1', 'ruleSearch').urn).toBe('BBeBee:s1:track:42')
  })
})

describe('a document that is not JSON at all', () => {
  it('says so rather than reporting an empty backend', async () => {
    /*
     * `fetch.ts` hands a body on as text when it does not parse as JSON —
     * which is exactly what a backend does when it serves an HTML login page
     * with a 200. A JSONPath against that returned nothing, and a search
     * reporting zero results reads as "no matches", not "you are signed out".
     */
    const failure = () => evaluateListRule(rule, ctx('<html><body>Please sign in</body></html>'))
    await expect(failure()).rejects.toThrow(RuleError)
    await expect(failure()).rejects.toThrow(/HTML page/)
  })

  it('puts the body in the message, so the cause is visible', async () => {
    try {
      await evaluateListRule(rule, ctx('<html>Service temporarily unavailable</html>'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).excerpt).toContain('Service temporarily unavailable')
    }
  })

  it('names the block and field it was evaluating', async () => {
    try {
      await evaluateListRule(rule, ctx('not json'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).rule).toEqual({ block: 'ruleSearch', field: 'trackList' })
    }
  })
})

describe('a malformed field rule', () => {
  it('fails inside the taxonomy, naming the field', async () => {
    // `parseRule` throws `RuleSyntaxError`, which is not a `SourceError` — so
    // it used to escape past every handler that branches on `code` and surface
    // as "something went wrong".
    try {
      await evaluateListRule({ ...rule, artist: '$.a|||$.b' }, ctx({ songs: [{ id: '1', title: 'A' }] }))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RuleError)
      expect((error as RuleError).rule.field).toBe('artist')
    }
  })

  it('fails once, before any row is built', async () => {
    // Parsed per row, the same error was raised identically fifty times.
    const many = { songs: Array.from({ length: 50 }, (_, i) => ({ id: String(i), title: 'A' })) }
    await expect(evaluateListRule({ ...rule, artist: '$.a|||$.b' }, ctx(many))).rejects.toThrow(RuleError)
  })
})

describe('an optional field whose rule fails', () => {
  const withArtwork = { ...rule, artwork: '={{item.coverArt}}/thumb' }

  it('leaves the field out rather than failing the listing', async () => {
    /*
     * The case that forced this: `artwork` built from `{{item.coverArt}}`, on
     * a backend that omits `coverArt` for albums with no cover. One such row
     * made the whole page throw — fifty results replaced by an error over a
     * missing thumbnail.
     */
    const { rows, incomplete } = await evaluateListRule(withArtwork, ctx({
      songs: [{ id: '1', title: 'A', coverArt: 'c1' }, { id: '2', title: 'B' }],
    }))

    expect(rows).toHaveLength(2)
    expect(rows[0]!.artwork).toBe('c1/thumb')
    expect(rows[1]!.artwork, 'absent, and the row survives').toBeUndefined()
    expect(incomplete, 'counted, not swallowed').toBe(1)
  })

  it('keeps the failure, so a rule broken on every row is not invisible', async () => {
    const { incomplete, firstError } = await evaluateListRule(withArtwork, ctx({
      songs: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }],
    }))
    expect(incomplete).toBe(2)
    expect(firstError).toBeInstanceOf(RuleError)
  })

  it('still drops the row when a required rule fails', async () => {
    // A row with no id cannot be used, however the id failed to arrive.
    const { rows, dropped } = await evaluateListRule({ ...rule, trackId: '={{item.missing}}' }, ctx({
      songs: [{ id: '1', title: 'A' }],
    }))
    expect(rows).toHaveLength(0)
    expect(dropped).toBe(1)
  })
})
