/**
 * The smart-playlist compiler, as a table.
 *
 * What is pinned here is the security boundary: field names never reach the
 * SQL, values only ever reach it as bound parameters, and a rule that cannot
 * mean anything (an empty group, `contains` on a year) fails loudly instead of
 * compiling to something plausible.
 */

import { describe, expect, it } from 'vitest'
import { SmartQueryError } from '@BBeBee/protocol'
import type { SmartPlaylist } from '@BBeBee/protocol'
import { compileRule, compileSmartQuery } from './smart.js'

const NOW = Date.UTC(2026, 0, 1)

function query(rules: SmartPlaylist['rules'], extra: Partial<SmartPlaylist> = {}): string {
  const compiled = compileSmartQuery({ rules, ...extra }, NOW)
  return compiled.where
}

describe('compileSmartQuery', () => {
  it('compiles a nested tree with parameters in evaluation order', () => {
    const compiled = compileSmartQuery(
      {
        rules: {
          op: 'and',
          rules: [
            { field: 'year', cmp: 'gt', value: 1999 },
            {
              op: 'or',
              rules: [
                { field: 'loved', cmp: 'eq', value: true },
                { field: 'title', cmp: 'contains', value: 'blue' },
              ],
            },
          ],
        },
      },
      NOW,
    )

    expect(compiled.where).toBe("(COALESCE(t.year, 0) > ? AND (COALESCE(st.loved, 0) = ? OR t.title LIKE ? ESCAPE '\\'))")
    expect(compiled.params).toEqual([1999, 1, '%blue%'])
  })

  it('negates a subtree without negating a nullable comparison', () => {
    const compiled = compileSmartQuery(
      { rules: { op: 'not', rule: { field: 'rating', cmp: 'neq', value: 3 } } },
      NOW,
    )
    expect(compiled.where).toBe('NOT (NOT (COALESCE(st.rating, 0) = ?))')
    expect(compiled.params).toEqual([3])
  })

  it('escapes LIKE metacharacters, so 100% is a title and not a wildcard', () => {
    const compiled = compileSmartQuery(
      { rules: { field: 'title', cmp: 'contains', value: '100%_sure\\' } },
      NOW,
    )
    expect(compiled.params).toEqual(['%100\\%\\_sure\\\\%'])
  })

  it('turns inLast into an epoch-ms cutoff, relative to the passed now', () => {
    const compiled = compileSmartQuery(
      { rules: { field: 'lastPlayedAt', cmp: 'inLast', value: 7 } },
      NOW,
    )
    expect(compiled.where).toBe('COALESCE(st.last_played_at, 0) >= ?')
    expect(compiled.params).toEqual([NOW - 7 * 86_400_000])
  })

  it('compares the best binding tier by rank, not by name', () => {
    const compiled = compileSmartQuery({ rules: { field: 'quality', cmp: 'gt', value: 'high' } }, NOW)
    // `high` is rank 2, so this is "lossless or better" — the spelling `> 'high'`
    // would be true for `hi-res` and false for `lossless`, which is backwards.
    expect(compiled.params).toEqual([2])
    expect(compiled.where).toMatch(/media_bindings/)
  })

  it('maps orderBy through the same allowlist and keeps desc', () => {
    const compiled = compileSmartQuery(
      { rules: { field: 'loved', cmp: 'eq', value: true }, orderBy: 'playCount', desc: true },
      NOW,
    )
    expect(compiled.orderBy).toBe('COALESCE(st.play_count, 0)')
    expect(compiled.desc).toBe(true)
  })

  it('accepts only a positive integer limit', () => {
    expect(compileSmartQuery({ rules: { field: 'loved', cmp: 'eq', value: true }, limit: 50 }, NOW).limit).toBe(50)
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        compileSmartQuery({ rules: { field: 'loved', cmp: 'eq', value: true }, limit }, NOW),
      ).toThrow(SmartQueryError)
    }
  })

  it('refuses anything that is not a rule', () => {
    expect(() => compileRule(undefined as never)).toThrow(SmartQueryError)
    expect(() => query({ op: 'and', rules: [] })).toThrow(/no rules/)
    expect(() => query({ op: 'or', rules: [] })).toThrow(/no rules/)
  })

  it('refuses a field that is not in the allowlist', () => {
    expect(() => query({ field: 'toString' as never, cmp: 'eq', value: 1 })).toThrow(/unknown field/)
    expect(() => compileSmartQuery({ rules: { field: 'loved', cmp: 'eq', value: true }, orderBy: 'constructor' as never }, NOW)).toThrow(
      /unknown field/,
    )
  })

  it('refuses comparisons that field cannot mean', () => {
    expect(() => query({ field: 'year', cmp: 'contains', value: '19' })).toThrow(/does not apply/)
    expect(() => query({ field: 'title', cmp: 'inLast', value: 7 })).toThrow(/does not apply/)
    expect(() => query({ field: 'loved', cmp: 'eq', value: 'yes' })).toThrow(/boolean/)
    expect(() => query({ field: 'quality', cmp: 'eq', value: 'bogus' })).toThrow(/quality tier/)
  })

  it('reports the path of the offending rule', () => {
    try {
      query({ op: 'and', rules: [{ field: 'loved', cmp: 'eq', value: true }, { field: 'nope' as never, cmp: 'eq', value: 1 }] })
      expect.unreachable()
    } catch (error) {
      expect((error as SmartQueryError).path).toBe('rules.rules[1]')
    }
  })
})
