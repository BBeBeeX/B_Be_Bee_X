/**
 * JSONPath, the subset a source document actually uses.
 *
 * Deliberately not a general implementation. Real documents use a handful of
 * shapes — `$.a.b`, `$.list[*]`, `$.list[0]`, `$..deep` — and a full JSONPath
 * brings filter expressions, which are a scripting surface inside what is
 * supposed to be the *declarative* half of the language. The `@js:` engine is
 * where computation belongs, behind the sandbox.
 *
 * Supported:
 *
 *     $                 the root
 *     .name  ['name']   a property
 *     [0] [-1]          an index, negative counting from the end
 *     [*]  .*           every element or value
 *     ..name            every descendant with that name
 *
 * Anything else is a `RuleSyntaxError` at parse time rather than an empty
 * result at run time, because "no results" is exactly what a valid-but-wrong
 * path returns and there is no way to tell them apart afterwards.
 */

export class RuleSyntaxError extends Error {
  override readonly name = 'RuleSyntaxError'
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`bad JSONPath ${JSON.stringify(path)}: ${reason}`)
  }
}

type Step =
  | { kind: 'property'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'descend'; name: string }

/** Tokenise a path once, so evaluation is a walk rather than a re-parse. */
export function parseJsonPath(path: string): Step[] {
  const trimmed = path.trim()
  if (!trimmed.startsWith('$')) throw new RuleSyntaxError(path, 'must start with $')

  const steps: Step[] = []
  let i = 1

  while (i < trimmed.length) {
    const ch = trimmed[i]

    if (ch === '.') {
      // `..name` descends; `.name` is one level.
      if (trimmed[i + 1] === '.') {
        const name = readName(trimmed, i + 2)
        if (!name.value) throw new RuleSyntaxError(path, 'expected a name after ..')
        steps.push({ kind: 'descend', name: name.value })
        i = name.next
        continue
      }
      if (trimmed[i + 1] === '*') {
        steps.push({ kind: 'wildcard' })
        i += 2
        continue
      }
      const name = readName(trimmed, i + 1)
      if (!name.value) throw new RuleSyntaxError(path, `expected a name at ${i}`)
      steps.push({ kind: 'property', name: name.value })
      i = name.next
      continue
    }

    if (ch === '[') {
      const close = trimmed.indexOf(']', i)
      if (close === -1) throw new RuleSyntaxError(path, 'unclosed [')
      const inner = trimmed.slice(i + 1, close).trim()
      i = close + 1

      if (inner === '*') {
        steps.push({ kind: 'wildcard' })
        continue
      }
      const quoted = /^'([^']*)'$|^"([^"]*)"$/.exec(inner)
      if (quoted) {
        steps.push({ kind: 'property', name: quoted[1] ?? quoted[2] ?? '' })
        continue
      }
      if (!/^-?\d+$/.test(inner)) {
        throw new RuleSyntaxError(path, `[${inner}] is not an index, a name, or *`)
      }
      steps.push({ kind: 'index', index: Number(inner) })
      continue
    }

    throw new RuleSyntaxError(path, `unexpected ${JSON.stringify(ch)} at ${i}`)
  }
  return steps
}

function readName(input: string, from: number): { value: string; next: number } {
  let i = from
  // A property name runs to the next structural character. Source documents
  // use hyphens routinely (`subsonic-response`), so those are name characters.
  while (i < input.length && !'.[]'.includes(input[i]!)) i++
  return { value: input.slice(from, i), next: i }
}

/** Everything the path selects, in document order. */
export function queryJsonPath(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root]

  for (const step of parseJsonPath(path)) {
    const next: unknown[] = []
    for (const value of current) {
      switch (step.kind) {
        case 'property':
          // `in` walks the prototype chain, so `$.constructor` on a parsed
          // JSON object yields `Object` — a rule reaching out of its document
          // and into the runtime. Own properties only.
          if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, step.name)) {
            next.push(value[step.name])
          }
          break
        case 'index': {
          if (!Array.isArray(value)) break
          // A negative index counts from the end, which is how a document
          // reaches "the last one" without knowing the length.
          const index = step.index < 0 ? value.length + step.index : step.index
          if (index >= 0 && index < value.length) next.push(value[index])
          break
        }
        case 'wildcard':
          if (Array.isArray(value)) next.push(...value)
          else if (isRecord(value)) next.push(...Object.values(value))
          break
        case 'descend':
          collectDescendants(value, step.name, next)
          break
      }
    }
    current = next
    // Nothing left to walk: stop rather than iterating empty arrays.
    if (current.length === 0) break
  }
  return current
}

function collectDescendants(value: unknown, name: string, out: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDescendants(item, name, out)
    return
  }
  if (!isRecord(value)) return
  // `Object.entries` is own-enumerable only, so `..constructor` finds nothing
  // — the same guarantee the property step makes explicitly.
  for (const [key, child] of Object.entries(value)) {
    if (key === name) out.push(child)
    collectDescendants(child, name, out)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
