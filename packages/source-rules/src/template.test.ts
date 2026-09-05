import { describe, expect, it } from 'vitest'
import { RuleError } from '@BBeBee/protocol'
import { evaluateRule, isTemplate, renderTemplate } from './template.js'

const site = { block: 'ruleStream', field: 'url', sourceId: 's1' }

describe('isTemplate', () => {
  it('recognises the `=` prefix and nothing else', async () => {
    expect(isTemplate('=https://example.org')).toBe(true)
    expect(isTemplate('$.url')).toBe(false)
    expect(isTemplate('audio/mpeg')).toBe(false)
  })
})

describe('renderTemplate', () => {
  it('interpolates a dotted path', async () => {
    expect(
      await renderTemplate('{{source.url}}/stream?id={{track.id}}', {
        source: { url: 'https://music.example.org' },
        track: { id: 'abc' },
      }, site),
    ).toBe('https://music.example.org/stream?id=abc')
  })

  it('passes literal text through untouched', async () => {
    expect(await renderTemplate('audio/mpeg', {}, site)).toBe('audio/mpeg')
  })

  it('stringifies numbers and booleans', async () => {
    expect(await renderTemplate('{{page}}/{{prefs.saveData}}', { page: 2, prefs: { saveData: false } }, site))
      .toBe('2/false')
  })

  it('fails loudly when a path resolves to nothing', async () => {
    // The alternative is a stream URL with a missing id, which fails minutes
    // later as a 404 that names nothing. See docs/06 §3.6.
    await expect(renderTemplate('{{track.id}}', { track: {} }, site)).rejects.toThrow(RuleError)
  })

  it('names the rule that failed', async () => {
    try {
      await renderTemplate('{{track.id}}', {}, site)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RuleError)
      expect((error as RuleError).rule).toEqual({ block: 'ruleStream', field: 'url' })
      expect((error as RuleError).sourceId).toBe('s1')
    }
  })

  it('rejects an empty placeholder', async () => {
    await expect(renderTemplate('{{ }}', {}, site)).rejects.toThrow(RuleError)
  })

  it('rejects interpolating an object', async () => {
    await expect(renderTemplate('{{track}}', { track: { id: 'a' } }, site)).rejects.toThrow(RuleError)
  })

  it('does not walk the prototype chain', async () => {
    // `{{track.constructor.name}}` must resolve to nothing, not to a foothold.
    await expect(renderTemplate('{{track.constructor}}', { track: { id: 'a' } }, site)).rejects.toThrow(
      RuleError,
    )
  })

  it('reports the first failure, not the last', async () => {
    try {
      await renderTemplate('{{a.missing}}-{{b.alsoMissing}}', {}, site)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as RuleError).message).toContain('a.missing')
    }
  })

  it('refuses an unbalanced placeholder rather than emitting it verbatim', async () => {
    // Passing `{{track.id` through as literal text is how it becomes a URL
    // containing a brace that fails three steps later as an unexplained 404.
    await expect(renderTemplate('https://x/{{track.id', { track: { id: '1' } }, site)).rejects.toThrow(
      RuleError,
    )
    await expect(renderTemplate('https://x/track.id}}', {}, site)).rejects.toThrow(RuleError)
  })

  it('accepts adjacent placeholders', async () => {
    expect(await renderTemplate('{{a.b}}{{a.c}}', { a: { b: '1', c: '2' } } as never, site)).toBe('12')
  })

  it('interpolates verbatim, which callers must know', async () => {
    // Documented, not accidental: encoding here would corrupt the many rules
    // that interpolate a whole URL or a query fragment. See the module note.
    expect(await renderTemplate('?q={{track.id}}', { track: { id: 'a&b=c' } }, site)).toBe('?q=a&b=c')
  })
})

describe('evaluateRule', () => {
  it('renders a `=` rule', async () => {
    expect(await evaluateRule('=https://x/{{track.id}}', { track: { id: '7' } }, site)).toBe(
      'https://x/7',
    )
  })

  it('refuses a selector rather than treating it as a literal', async () => {
    // Passing an unrecognised rule through as text is the failure mode that
    // makes every later rule bug harder to find: the symptom shows up three
    // steps downstream as a URL that is not a URL. See docs/11 §4.10.
    await expect(evaluateRule('$.url', {}, site)).rejects.toThrow(RuleError)
    await expect(evaluateRule('audio/mpeg', {}, site)).rejects.toThrow(/must start with "="/)
  })
})

describe('braces in the data, rather than in the template', () => {
  it('renders a value that itself contains {{ }}', async () => {
    // The check used to run on the output, so a remote server could invalidate
    // a correct rule by returning a title with braces in it — and the message
    // quoted the template, which had nothing wrong with it.
    expect(
      await renderTemplate('{{track.title}} - {{track.artist}}', {
        track: { title: 'Live {{2019}}', artist: 'A' },
      }, site),
    ).toBe('Live {{2019}} - A')
  })

  it('renders a value containing a single stray brace pair', async () => {
    expect(await renderTemplate('{{key}}', { key: 'a}}b' }, site)).toBe('a}}b')
  })

  it('still refuses an unbalanced placeholder in the template itself', async () => {
    await expect(renderTemplate('{{track.id', { track: { id: '1' } }, site)).rejects.toThrow(/unbalanced/)
    await expect(renderTemplate('{{track.id}}}}', { track: { id: '1' } }, site)).rejects.toThrow(/unbalanced/)
  })
})
