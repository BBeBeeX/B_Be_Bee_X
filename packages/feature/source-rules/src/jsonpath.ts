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

import { RuleSyntaxError } from './syntax-error.js'

/** A malformed path. Same class as a malformed rule — see syntax-error.ts. */
function pathError(path: string, reason: string): RuleSyntaxError {
  return new RuleSyntaxError(path, reason, 'JSONPath')
}

type Step =
  | { kind: 'property'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'descend'; name: string }

/** Tokenise a path once, so evaluation is a walk rather than a re-parse. */
export function parseJsonPath(path: string): Step[] {
  const trimmed = path.trim()
  if (!trimmed.startsWith('$')) throw pathError(path, 'must start with $')

  const steps: Step[] = []
  let i = 1

  while (i < trimmed.length) {
    const ch = trimmed[i]

    if (ch === '.') {
      // `..name` descends; `.name` is one level.
      if (trimmed[i + 1] === '.') {
        // `..*` is a shape people write and this does not implement; saying so
        // beats returning nothing, which reads as "the field is missing".
        if (trimmed[i + 2] === '*') {
          throw pathError(path, '..* is not supported; name the field you want')
        }
        const name = readName(trimmed, path, i + 2)
        if (!name.value) throw pathError(path, 'expected a name after ..')
        steps.push({ kind: 'descend', name: name.value })
        i = name.next
        continue
      }
      if (trimmed[i + 1] === '*') {
        steps.push({ kind: 'wildcard' })
        i += 2
        continue
      }
      const name = readName(trimmed, path, i + 1)
      if (!name.value) throw pathError(path, `expected a name at ${i}`)
      steps.push({ kind: 'property', name: name.value })
      i = name.next
      continue
    }

    if (ch === '[') {
      const close = trimmed.indexOf(']', i)
      if (close === -1) throw pathError(path, 'unclosed [')
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
        throw pathError(path, `[${inner}] is not an index, a name, or *`)
      }
      // RFC 9535 forbids leading zeros, and `[01]` is far likelier a typo
      // than an intent.
      if (/^-?0\d/.test(inner)) {
        throw pathError(path, `[${inner}] has a leading zero`)
      }
      steps.push({ kind: 'index', index: Number(inner) })
      continue
    }

    throw pathError(path, `unexpected ${JSON.stringify(ch)} at ${i}`)
  }
  return steps
}

/**
 * Characters a property name may contain.
 *
 * Deliberately an allowlist. Accepting "anything but `.[]`" meant `$.a|b` — a
 * mistyped `||` — parsed as a property literally named `a|b`, matched nothing,
 * and looked exactly like a field the backend had removed. The tracer would
 * then send the author hunting the wrong thing.
 *
 * Hyphens and `@` are in, because `subsonic-response` and `@attributes` are in
 * real documents. `|`, `&`, `#`, `$`, `{`, `}` are out: each is an operator or
 * directive character, and a name containing one is a typo.
 */
const NAME_CHAR = /[A-Za-z0-9_\-@:+~]/

function readName(input: string, path: string, from: number): { value: string; next: number } {
  let i = from
  while (i < input.length && NAME_CHAR.test(input[i]!)) i++
  if (i < input.length && !'.[]'.includes(input[i]!)) {
    throw pathError(path, `unexpected ${JSON.stringify(input[i])} in a property name`)
  }
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
          // Pushed in a loop, not spread: `push(...huge)` passes every element
          // as an argument and blows the stack somewhere north of 100k, which
          // a backend returning a large list reaches without trying.
          if (Array.isArray(value)) for (const item of value) next.push(item)
          else if (isRecord(value)) for (const item of Object.values(value)) next.push(item)
          break
        case 'descend':
          collectDescendants(value, step.name, next, 0)
          break
      }
    }
    current = next
    // Nothing left to walk: stop rather than iterating empty arrays.
    if (current.length === 0) break
  }
  return current
}

/**
 * Depth a `..name` descent will walk.
 *
 * Recursion over a document from a stranger's backend is unbounded otherwise:
 * a few thousand levels of nesting overflowed the stack, and the resulting
 * `RangeError` carried no rule, block or source — a crash where an
 * attributable "this source needs updating" belonged.
 */
const MAX_DESCENT_DEPTH = 512

function collectDescendants(
  value: unknown,
  name: string,
  out: unknown[],
  depth: number,
): void {
  if (depth > MAX_DESCENT_DEPTH) return
  if (Array.isArray(value)) {
    for (const item of value) collectDescendants(item, name, out, depth + 1)
    return
  }
  if (!isRecord(value)) return
  // `Object.entries` is own-enumerable only, so `..constructor` finds nothing
  // — the same guarantee the property step makes explicitly.
  for (const [key, child] of Object.entries(value)) {
    if (key === name) out.push(child)
    collectDescendants(child, name, out, depth + 1)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
