/**
 * The rule parser.
 *
 * A rule is one line typed into a form field on a phone, so nearly every test
 * here is about a shape someone will actually write — and about the ones where
 * a naive parser produces something that looks parsed and is wrong.
 */

import { describe, expect, it } from 'vitest'
import { inferEngine, parseRule } from './parse.js'
import { RuleSyntaxError } from './syntax-error.js'

const atoms = (rule: string) => parseRule(rule).alternatives[0]!.parts[0]!.atoms

describe('engine inference', () => {
  it('reads the documented shapes', () => {
    expect(inferEngine('$.a.b').engine).toBe('json')
    expect(inferEngine('$[0]').engine).toBe('json')
    expect(inferEngine('//div/text()').engine).toBe('xpath')
    expect(inferEngine(':(\\d+)kbps').engine).toBe('regex')
    expect(inferEngine('=audio/mpeg').engine).toBe('template')
    expect(inferEngine('h3 a@text').engine).toBe('css')
  })

  it('strips the marker from the selector where it is not part of it', () => {
    // A regex rule's `:` and a template's `=` are prefixes; JSONPath's `$` is
    // part of the path and must survive.
    expect(inferEngine(':(\\d+)').selector).toBe('(\\d+)')
    expect(inferEngine('=x').selector).toBe('x')
    expect(inferEngine('$.a').selector).toBe('$.a')
  })

  it('treats a bare constant as a selector, as documented', () => {
    // The surprising-but-written-down rule: `audio/mpeg` without `=` is a CSS
    // selector, and the interpreter says so rather than returning the text.
    expect(inferEngine('audio/mpeg').engine).toBe('css')
  })
})

describe('explicit prefixes', () => {
  it('wins over inference', () => {
    expect(atoms('@json:$.a')[0]!.engine).toBe('json')
    expect(atoms('@css:h3')[0]!.engine).toBe('css')
    expect(atoms('@xpath://a')[0]!.engine).toBe('xpath')
    expect(atoms('@js:return 1')[0]!.engine).toBe('js')
  })

  it('accepts the <js> block form', () => {
    const atom = atoms('<js>return 1 + 1</js>')[0]!
    expect(atom.engine).toBe('js')
    expect(atom.selector).toBe('return 1 + 1')
  })
})

describe('combinators', () => {
  it('splits alternatives', () => {
    const parsed = parseRule('$.a||$.b||$.c')
    expect(parsed.alternatives).toHaveLength(3)
  })

  it('splits concatenation', () => {
    expect(atoms('$.a&&$.b')).toHaveLength(2)
  })

  it('splits interleave', () => {
    expect(parseRule('$.a%%$.b').alternatives[0]!.parts).toHaveLength(2)
  })

  it('binds && tighter than ||', () => {
    // `a && b || c` is "a-then-b, or else c" — the way a fallback for a
    // two-part field is written.
    const parsed = parseRule('$.a&&$.b||$.c')
    expect(parsed.alternatives).toHaveLength(2)
    expect(parsed.alternatives[0]!.parts[0]!.atoms).toHaveLength(2)
    expect(parsed.alternatives[1]!.parts[0]!.atoms).toHaveLength(1)
  })

  it('does not tear a regex alternation inside a replacement', () => {
    // `##a|b##` is one pattern. A naive split on `||` would cut `##a||b##`
    // into two rules that are each nonsense.
    const parsed = parseRule('$.title##a||b##x')
    expect(parsed.alternatives, 'the || is inside the replacement').toHaveLength(1)
    expect(parsed.alternatives[0]!.parts[0]!.atoms[0]!.replacements[0]!.pattern).toBe('a||b')
  })
})

describe('replacements', () => {
  it('parses pattern and replacement', () => {
    const [replacement] = atoms('$.duration##$##000')[0]!.replacements
    expect(replacement).toMatchObject({ pattern: '$', replacement: '000', firstOnly: false })
  })

  it('treats a lone pattern as a deletion', () => {
    const [replacement] = atoms('$.title## \\(live\\)')[0]!.replacements
    expect(replacement!.replacement).toBe('')
  })

  it('reads the ### suffix as replace-first', () => {
    const [replacement] = atoms('$.t##a##b###')[0]!.replacements
    expect(replacement).toMatchObject({ replacement: 'b', firstOnly: true })
  })

  it('keeps the selector clear of the replacement', () => {
    expect(atoms('$.duration##$##000')[0]!.selector).toBe('$.duration')
  })
})

describe('variables', () => {
  it('parses @put', () => {
    const atom = atoms('@put:{token:$.tok}$.id')[0]!
    expect(atom.put).toEqual([{ key: 'token', rule: '$.tok' }])
    expect(atom.selector, 'the directive is stripped').toBe('$.id')
  })

  it('parses several @put directives', () => {
    expect(atoms('@put:{a:$.a}@put:{b:$.b}$.id')[0]!.put).toHaveLength(2)
  })

  it('parses @get as a value rather than a selection', () => {
    const atom = atoms('@get:{token}')[0]!
    expect(atom.get).toBe('token')
    expect(atom.selector).toBe('')
  })
})

describe('robustness', () => {
  it('parses an empty rule without throwing', () => {
    expect(() => parseRule('')).not.toThrow()
  })

  it('parses a rule that is only an operator', () => {
    expect(() => parseRule('||')).not.toThrow()
  })

  it('keeps the source text for the tracer', () => {
    expect(parseRule('$.a||$.b').source).toBe('$.a||$.b')
  })

  it('parses a realistic Subsonic rule', () => {
    const atom = atoms('$.subsonic-response.searchResult3.song[*]')[0]!
    expect(atom.engine).toBe('json')
    expect(atom.selector).toBe('$.subsonic-response.searchResult3.song[*]')
  })
})

/**
 * The shapes that used to parse into something wrong.
 *
 * Each of these produced a plausible-looking parse and a silently incorrect
 * result — the worst failure mode for a language people write by hand, because
 * nothing points at the line that is at fault.
 */
describe('ambiguity that used to pass silently', () => {
  it('refuses an unclosed replacement that swallowed an operator', () => {
    // Measured before the fix: one atom, and `&&$.artist` gone without a word,
    // so the field came back with half its value and no error to chase.
    expect(() => parseRule('$.title##\\(live\\)&&$.artist')).toThrow(RuleSyntaxError)
    expect(() => parseRule('$.title##\\(live\\)&&$.artist')).toThrow(/not closed/)
  })

  it('accepts the same rule once the replacement is closed', () => {
    // The advice the error gives has to actually work.
    const parsed = atoms('$.title##\\(live\\)##&&$.artist')
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.replacements[0]!.pattern).toBe('\\(live\\)')
  })

  it('says nothing about an unclosed replacement that swallowed nothing', () => {
    // `## \(live\)` with no closing `##` is the documented deletion form. It
    // is only ambiguous when an operator is inside it.
    expect(() => parseRule('$.title## \\(live\\)')).not.toThrow()
  })

  it('does not mistake an empty atom for a css selector', () => {
    // An even run of pipes leaves nothing between two operators. That used to
    // infer `css` and report "the css engine is not available" — an engine
    // the author never named.
    const engines = parseRule('$.a||||$.b').alternatives.map(
      (a) => a.parts[0]!.atoms[0]!.engine,
    )
    expect(engines).toEqual(['json', 'empty', 'json'])
  })

  it('names the typo when an odd run of pipes leaves one behind', () => {
    // Measured: `$.a|||$.b` split into `$.a` and `|$.b`, and the leftover pipe
    // read as a CSS selector — so the message blamed the css engine.
    expect(() => parseRule('$.a|||$.b')).toThrow(RuleSyntaxError)
    expect(() => parseRule('$.a|||$.b')).toThrow(/mistyped "\|\|" operator/)
    expect(() => parseRule('$.a|||$.b')).not.toThrow(/css engine/)
  })

  it('names it for the other two operators as well', () => {
    expect(() => parseRule('$.a&&&$.b')).toThrow(/mistyped "&&" operator/)
    expect(() => parseRule('$.a%%%$.b')).toThrow(/mistyped "%%" operator/)
  })

  it('lets an explicit prefix through, since inference never sees it', () => {
    // `|div` is a real namespace selector; the escape hatch has to work.
    expect(atoms('@css:|div')[0]!).toMatchObject({ engine: 'css', selector: '|div' })
  })

  it('keeps a @put rule whole, operators and all', () => {
    // docs/06 §3.4 says the stored rule is a rule. Splitting the outer rule
    // first tore `@put:{t:$.a||$.b}$.id` into `@put:{t:$.a` and `$.b}$.id`,
    // both nonsense, and the reported error named neither.
    const parsed = parseRule('@put:{t:$.a||$.b}$.id')
    expect(parsed.alternatives).toHaveLength(1)
    const atom = parsed.alternatives[0]!.parts[0]!.atoms[0]!
    expect(atom.put).toEqual([{ key: 't', rule: '$.a||$.b' }])
    expect(atom.selector).toBe('$.id')
  })

  it('keeps a @put template whose braces nest', () => {
    // `[^}]*` stopped at the first `}` of `{{source.url}}` and handed the
    // evaluator `=pre-{{source.url`, whose "unbalanced {{ }}" complaint came
    // from three layers below the actual mistake.
    expect(atoms('@put:{u:=pre-{{source.url}}}$.id')[0]!.put).toEqual([
      { key: 'u', rule: '=pre-{{source.url}}' },
    ])
  })

  it('keeps a replacement that follows @get', () => {
    // Dropped outright before: `@get:{k}##a##X` returned the stored value
    // untransformed, so the rule appeared to work and produced the wrong text.
    const atom = atoms('@get:{k}##a##X')[0]!
    expect(atom.get).toBe('k')
    expect(atom.replacements).toEqual([{ pattern: 'a', replacement: 'X', firstOnly: false }])
  })

  it('refuses a selector after @get rather than ignoring it', () => {
    // There is no sensible reading — @get is a value, not a document to
    // select from — so the author is asked instead of guessed at.
    expect(() => parseRule('@get:{k}$.title')).toThrow(RuleSyntaxError)
  })

  it('refuses an unclosed directive brace', () => {
    expect(() => parseRule('@put:{t:$.a')).toThrow(RuleSyntaxError)
  })
})

describe('the <js> block form', () => {
  it('refuses content after the closing tag', () => {
    // Anchored at both ends, so trailing text fails to match — and falling
    // through inferred a *CSS selector* out of a script, reporting a markup
    // problem for a mistake that has nothing to do with markup.
    expect(() => parseRule('<js>return 1</js>x')).toThrow(RuleSyntaxError)
    expect(() => parseRule('<js>return 1</js>x')).toThrow(/content after <\/js>/)
  })

  it('refuses a block that is never closed', () => {
    expect(() => parseRule('<js>return 1')).toThrow(/never closed/)
  })

  it('still accepts a well-formed block, newlines and all', () => {
    expect(atoms('<js>\nreturn 1 + 1\n</js>')[0]).toMatchObject({ engine: 'js' })
  })
})
