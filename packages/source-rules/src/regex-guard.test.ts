/**
 * The bound on a stranger's regex.
 *
 * JavaScript's engine is backtracking and uninterruptible: once `(a+)+b`
 * starts on a long input there is no timer, worker or signal that stops it.
 * Measured before this existed: 24 characters took 372ms; 50,000 never
 * returned, freezing the runtime with it.
 */

import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import { MAX_REGEX_INPUT, UnsafeRegexError, boundInput, compileRuleRegex, isUnsafeRegex } from './regex-guard.js'
import { evaluate } from './evaluate.js'

const ctx = (document: unknown) => ({
  document,
  scope: {},
  site: { block: 'ruleSearch', field: 'title', sourceId: 's1' },
  vars: new Map<string, string>(),
})

describe('detecting the exponential shapes', () => {
  it('refuses a repeated group that already repeats', () => {
    for (const pattern of ['(a+)+b', '(a*)*b', '(\\d+)*', '(x+)+$', '([a-z]+)+']) {
      expect(isUnsafeRegex(pattern).unsafe, pattern).toBe(true)
    }
  })

  it('refuses a repeated group containing an alternation', () => {
    // `(a|aa)+` gives the engine two ways to split every input.
    expect(isUnsafeRegex('(a|aa)+').unsafe).toBe(true)
    expect(isUnsafeRegex('(foo|foobar)*').unsafe).toBe(true)
  })

  it('refuses nesting one level deeper', () => {
    expect(isUnsafeRegex('((a+)+)+').unsafe).toBe(true)
  })

  it('allows the patterns real documents use', () => {
    // A guard that refuses ordinary rules is a guard nobody can ship with.
    for (const pattern of [
      '(\\d+)kbps',
      '^\\s*(.+?)\\s*$',
      '\\((live|remix)\\)',
      '[0-9]{4}',
      'a+b+c+',
      '(?:abc)+',
      '\\d{2,4}-\\d{2}',
    ]) {
      expect(isUnsafeRegex(pattern).unsafe, pattern).toBe(false)
    }
  })

  it('treats a fixed repeat as safe and an open one as a quantifier', () => {
    // `{2}` cannot multiply the search space; `{2,}` can.
    expect(isUnsafeRegex('(a{2})+').unsafe).toBe(false)
    expect(isUnsafeRegex('(a{2,})+').unsafe).toBe(true)
  })

  it('does not read a quantifier inside a character class', () => {
    expect(isUnsafeRegex('([+*]+)x').unsafe).toBe(false)
  })

  it('does not read an escaped quantifier', () => {
    expect(isUnsafeRegex('(a\\+)+').unsafe).toBe(false)
  })
})

describe('refusal reaches the author', () => {
  it('names the pattern and the reason', () => {
    expect(() => compileRuleRegex('(a+)+b', 'g')).toThrow(UnsafeRegexError)
    expect(() => compileRuleRegex('(a+)+b', 'g')).toThrow(/\(a\+\)\+b/)
  })

  it('arrives as a RuleError, so the tracer can attribute it', () => {
    // A refusal with no block or field is one the user cannot act on.
    try {
      evaluate(':(a+)+b', ctx('aaaa'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RuleError)
      expect((error as RuleError).rule).toEqual({ block: 'ruleSearch', field: 'title' })
    }
  })

  it('refuses it in a replacement too, not only a selector', () => {
    expect(() => evaluate('$.t##(a+)+b##x', ctx({ t: 'aaa' }))).toThrow(RuleError)
  })
})

describe('the input bound', () => {
  it('caps what any pattern is run against', () => {
    expect(boundInput('a'.repeat(MAX_REGEX_INPUT + 100))).toHaveLength(MAX_REGEX_INPUT)
    expect(boundInput('short')).toBe('short')
  })

  it('stays fast on input that would previously have hung', () => {
    // The measured case: this shape and this length took minutes.
    const started = Date.now()
    expect(() => evaluate(':(a+)+b', ctx('a'.repeat(50_000)))).toThrow(RuleError)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
