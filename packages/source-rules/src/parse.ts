/**
 * Parsing a rule into the pipeline that evaluates it.
 *
 * A rule is one line in a form field on a phone, so the syntax is dense and
 * the parse has to be forgiving about what people actually type. It is also
 * the layer where a source author's mistake either becomes a clear message or
 * a silent wrong answer three steps later — so everything here fails loudly.
 *
 * Grammar, in the order it is applied:
 *
 *     rule       := alternative ( '||' alternative )*      first non-empty wins
 *     alternative:= concat ( '%%' concat )*                interleave
 *     concat     := atom ( '&&' atom )*                    concatenate
 *     atom       := ( '@put:{…}' | '@get:{…}' )* engine-selector replacement*
 *     replacement:= '##' pattern ( '##' replacement )? '###'?
 *
 * ⚠️ Precedence is `||` loosest, then `%%`, then `&&`. That is legado's, and
 * it is the useful one: `a && b || c` means "a-then-b, or else c", which is
 * how a fallback for a two-part field is written.
 *
 * See docs/06-music-sources.md §3.
 */

/** Which engine evaluates a selector. */
export type Engine = 'template' | 'json' | 'regex' | 'css' | 'xpath' | 'js'

/** A regex post-processor: `##pattern##replacement`. */
export interface Replacement {
  pattern: string
  replacement: string
  /** `###` suffix: replace the first match only, rather than all of them. */
  firstOnly: boolean
}

/** One selector, with everything attached to it. */
export interface Atom {
  engine: Engine
  /** The selector itself, prefix and replacements stripped. */
  selector: string
  replacements: Replacement[]
  /** `@put:{key:rule}` — capture the result under these names. */
  put: { key: string; rule: string }[]
  /** `@get:{key}` — this atom *is* a stored value rather than a selection. */
  get?: string
}

export interface Concat {
  atoms: Atom[]
}

export interface Interleave {
  parts: Concat[]
}

export interface ParsedRule {
  /** First non-empty wins. */
  alternatives: Interleave[]
  /** The rule as written, for error messages and the tracer. */
  source: string
}

const PREFIXES: { prefix: string; engine: Engine }[] = [
  { prefix: '@css:', engine: 'css' },
  { prefix: '@json:', engine: 'json' },
  { prefix: '@xpath:', engine: 'xpath' },
  { prefix: '@js:', engine: 'js' },
]

/**
 * Split on a top-level operator.
 *
 * "Top-level" matters: `##a||b##` is a regex alternation inside a
 * replacement, not two alternatives, and a naive `split` would tear it in
 * half and produce two rules that are each nonsense.
 */
function splitTop(input: string, operator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0

  while (i < input.length) {
    // `##…##` is opaque: the operator characters inside it are regex syntax.
    if (input.startsWith('##', i)) {
      depth = depth === 0 ? 1 : 0
      i += 2
      continue
    }
    if (depth === 0 && input.startsWith(operator, i)) {
      parts.push(input.slice(start, i))
      i += operator.length
      start = i
      continue
    }
    i++
  }
  parts.push(input.slice(start))
  return parts
}

/** `@put:{a:rule}` / `@get:{key}`, stripped off the front of an atom. */
function takeDirectives(input: string): {
  rest: string
  put: { key: string; rule: string }[]
  get?: string
} {
  let rest = input.trim()
  const put: { key: string; rule: string }[] = []
  let get: string | undefined

  for (;;) {
    const putMatch = /^@put:\{([^:}]+):([^}]*)\}\s*/.exec(rest)
    if (putMatch) {
      put.push({ key: putMatch[1]!.trim(), rule: putMatch[2]!.trim() })
      rest = rest.slice(putMatch[0].length)
      continue
    }
    const getMatch = /^@get:\{([^}]+)\}\s*/.exec(rest)
    if (getMatch) {
      get = getMatch[1]!.trim()
      rest = rest.slice(getMatch[0].length)
      continue
    }
    break
  }
  return get === undefined ? { rest, put } : { rest, put, get }
}

/**
 * `sel##a##b###` → the selector plus its replacements, in order.
 *
 * Segments are separated by `##` and paired up: pattern, replacement, pattern,
 * replacement. A trailing odd segment is a pattern with an empty replacement,
 * which is how a deletion is written.
 *
 * The `###` suffix is stripped *first*, before splitting: it is a marker on
 * the whole expression, and splitting on `##` turns it into a stray `#`
 * segment that then reads as another empty pattern.
 *
 * ⚠️ A pattern that genuinely ends in `#` cannot be written without the
 * suffix being read instead. Rare enough to accept and say so, rather than
 * inventing an escape nobody would remember.
 */
function takeReplacements(input: string): { selector: string; replacements: Replacement[] } {
  const first = input.indexOf('##')
  if (first === -1) return { selector: input, replacements: [] }

  const selector = input.slice(0, first)
  let body = input.slice(first + 2)

  const firstOnly = body.endsWith('###')
  if (firstOnly) body = body.slice(0, -3)

  const segments = body.split('##')
  const replacements: Replacement[] = []
  for (let i = 0; i < segments.length; i += 2) {
    const pattern = segments[i]
    if (pattern === undefined) break
    replacements.push({
      pattern,
      replacement: segments[i + 1] ?? '',
      firstOnly: false,
    })
  }
  // The marker applies to the expression, so it lands on the last pair.
  const last = replacements[replacements.length - 1]
  if (last && firstOnly) last.firstOnly = true

  return { selector, replacements }
}

/**
 * Infer the engine when no prefix says.
 *
 * Inference is the one place the language can surprise you, so it is narrow
 * and written down: `$.` is JSONPath, `//` is XPath, a leading `:` is a
 * regex, `=` is a template, and everything else is a CSS selector. A bare
 * constant is therefore a *selector* — the interpreter says so rather than
 * quietly returning the text (docs/06 §3.1).
 */
export function inferEngine(selector: string): { engine: Engine; selector: string } {
  if (selector.startsWith('=')) return { engine: 'template', selector: selector.slice(1) }
  if (selector.startsWith('$.') || selector.startsWith('$[')) {
    return { engine: 'json', selector }
  }
  if (selector.startsWith('//')) return { engine: 'xpath', selector }
  if (selector.startsWith(':')) return { engine: 'regex', selector: selector.slice(1) }
  return { engine: 'css', selector }
}

function parseAtom(input: string): Atom {
  const { rest, put, get } = takeDirectives(input)

  if (get !== undefined) {
    // `@get:{k}` is a value, not a selection; anything after it would be a
    // selector applied to a string, which the engines do not do.
    return { engine: 'template', selector: '', replacements: [], put, get }
  }

  // `<js>…</js>` is the block form of `@js:`; both reach the same engine.
  const block = /^<js>([\s\S]*)<\/js>$/.exec(rest.trim())
  if (block) {
    return { engine: 'js', selector: block[1]!, replacements: [], put }
  }

  for (const { prefix, engine } of PREFIXES) {
    if (!rest.startsWith(prefix)) continue
    const { selector, replacements } = takeReplacements(rest.slice(prefix.length))
    return { engine, selector, replacements, put }
  }

  const { selector, replacements } = takeReplacements(rest)
  const inferred = inferEngine(selector)
  return { engine: inferred.engine, selector: inferred.selector, replacements, put }
}

/** Parse a rule. Pure and total: an unparseable rule is still a rule that fails. */
export function parseRule(rule: string): ParsedRule {
  const alternatives = splitTop(rule, '||').map((alternative) => ({
    parts: splitTop(alternative, '%%').map((part) => ({
      atoms: splitTop(part, '&&').map(parseAtom),
    })),
  }))
  return { alternatives, source: rule }
}
