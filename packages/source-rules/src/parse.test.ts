/**
 * The rule parser.
 *
 * A rule is one line typed into a form field on a phone, so nearly every test
 * here is about a shape someone will actually write — and about the ones where
 * a naive parser produces something that looks parsed and is wrong.
 */

import { describe, expect, it } from 'vitest'
import { inferEngine, parseRule } from './parse.js'

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
