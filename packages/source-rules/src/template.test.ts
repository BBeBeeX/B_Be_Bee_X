import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import { evaluateRule, isTemplate, renderTemplate } from './template.js'

const site = { block: 'ruleStream', field: 'url', sourceId: 's1' }

describe('isTemplate', () => {
  it('recognises the `=` prefix and nothing else', () => {
    expect(isTemplate('=https://example.org')).toBe(true)
    expect(isTemplate('$.url')).toBe(false)
    expect(isTemplate('audio/mpeg')).toBe(false)
  })
})

describe('renderTemplate', () => {
  it('interpolates a dotted path', () => {
    expect(
      renderTemplate('{{source.url}}/stream?id={{track.id}}', {
        source: { url: 'https://music.example.org' },
        track: { id: 'abc' },
      }, site),
    ).toBe('https://music.example.org/stream?id=abc')
  })

  it('passes literal text through untouched', () => {
    expect(renderTemplate('audio/mpeg', {}, site)).toBe('audio/mpeg')
  })

  it('stringifies numbers and booleans', () => {
    expect(renderTemplate('{{page}}/{{prefs.saveData}}', { page: 2, prefs: { saveData: false } }, site))
      .toBe('2/false')
  })

  it('fails loudly when a path resolves to nothing', () => {
    // The alternative is a stream URL with a missing id, which fails minutes
    // later as a 404 that names nothing. See docs/06 §3.6.
    expect(() => renderTemplate('{{track.id}}', { track: {} }, site)).toThrow(RuleError)
  })

  it('names the rule that failed', () => {
    try {
      renderTemplate('{{track.id}}', {}, site)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RuleError)
      expect((error as RuleError).rule).toEqual({ block: 'ruleStream', field: 'url' })
      expect((error as RuleError).sourceId).toBe('s1')
    }
  })

  it('rejects an empty placeholder', () => {
    expect(() => renderTemplate('{{ }}', {}, site)).toThrow(RuleError)
  })

  it('rejects interpolating an object', () => {
    expect(() => renderTemplate('{{track}}', { track: { id: 'a' } }, site)).toThrow(RuleError)
  })

  it('does not walk the prototype chain', () => {
    // `{{track.constructor.name}}` must resolve to nothing, not to a foothold.
    expect(() => renderTemplate('{{track.constructor}}', { track: { id: 'a' } }, site)).toThrow(
      RuleError,
    )
  })

  it('reports the first failure, not the last', () => {
    try {
      renderTemplate('{{a.missing}}-{{b.alsoMissing}}', {}, site)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).message).toContain('a.missing')
    }
  })

  it('refuses an unbalanced placeholder rather than emitting it verbatim', () => {
    // Passing `{{track.id` through as literal text is how it becomes a URL
    // containing a brace that fails three steps later as an unexplained 404.
    expect(() => renderTemplate('https://x/{{track.id', { track: { id: '1' } }, site)).toThrow(
      RuleError,
    )
    expect(() => renderTemplate('https://x/track.id}}', {}, site)).toThrow(RuleError)
  })

  it('accepts adjacent placeholders', () => {
    expect(renderTemplate('{{a.b}}{{a.c}}', { a: { b: '1', c: '2' } } as never, site)).toBe('12')
  })

  it('interpolates verbatim, which callers must know', () => {
    // Documented, not accidental: encoding here would corrupt the many rules
    // that interpolate a whole URL or a query fragment. See the module note.
    expect(renderTemplate('?q={{track.id}}', { track: { id: 'a&b=c' } }, site)).toBe('?q=a&b=c')
  })
})

describe('evaluateRule', () => {
  it('renders a `=` rule', () => {
    expect(evaluateRule('=https://x/{{track.id}}', { track: { id: '7' } }, site)).toBe(
      'https://x/7',
    )
  })

  it('refuses a selector rather than treating it as a literal', () => {
    // Passing an unrecognised rule through as text is the failure mode that
    // makes every later rule bug harder to find: the symptom shows up three
    // steps downstream as a URL that is not a URL. See docs/11 §4.10.
    expect(() => evaluateRule('$.url', {}, site)).toThrow(RuleError)
    expect(() => evaluateRule('audio/mpeg', {}, site)).toThrow(/must start with "="/)
  })
})
