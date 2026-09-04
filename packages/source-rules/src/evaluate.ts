/**
 * Running a parsed rule against a document.
 *
 * The pipeline, in order: alternatives (first non-empty wins), interleave,
 * concatenation, then per-atom — `@get`, engine selection, replacements, and
 * `@put` capture.
 *
 * Two rules govern everything here, and both exist because a source author is
 * debugging a rule on a phone against a backend that changed yesterday:
 *
 *  - **Absent and empty are different.** A selector matching nothing yields no
 *    values; a selector matching an empty string yields `''`. The caller
 *    decides which is a failure, because only it knows whether the field was
 *    optional (docs/06 §3.6).
 *  - **A broken rule fails loudly.** An unparseable selector is an error
 *    naming the rule, never a silent empty result — those are exactly what a
 *    valid-but-outdated rule produces, and telling them apart afterwards is
 *    impossible.
 */

import { RuleError } from '@BBeBee/protocol'
import { parseRule, type Atom, type Engine, type ParsedRule } from './parse.js'
import { RuleSyntaxError, queryJsonPath } from './jsonpath.js'
import { renderTemplate, type RuleSite, type TemplateScope } from './template.js'

/** What a rule is evaluated against. */
export interface RuleContext {
  /** The parsed document — JSON today; a DOM when the markup engines land. */
  document: unknown
  scope: TemplateScope
  site: RuleSite
  /** `@put` writes here and `@get` reads it. Lives for one evaluation. */
  vars?: Map<string, string>
}

/** An engine this build cannot run. Distinct from "the rule was wrong". */
export class RuleEngineUnavailableError extends Error {
  override readonly name = 'RuleEngineUnavailableError'
  constructor(readonly engine: Engine) {
    super(
      `the "${engine}" engine is not available in this build — ` +
        'it needs ctx.js (docs/04 §19) or a markup parser',
    )
  }
}

/** Engines this build can actually run. */
const AVAILABLE: ReadonlySet<Engine> = new Set<Engine>(['template', 'json', 'regex'])

export function engineAvailable(engine: Engine): boolean {
  return AVAILABLE.has(engine)
}

/**
 * Evaluate a rule to every value it selects.
 *
 * Returns strings, because that is what a rule block's fields are. A caller
 * wanting the underlying objects — a list rule selecting elements — uses
 * `evaluateNodes`.
 */
export function evaluate(rule: string, context: RuleContext): string[] {
  return evaluateNodes(rule, context).map(toText)
}

/** As `evaluate`, but keeping the selected values rather than stringifying. */
export function evaluateNodes(rule: string, context: RuleContext): unknown[] {
  return runParsed(parseRule(rule), context)
}

/** Evaluate an already-parsed rule. Saves a re-parse in a list of N items. */
export function evaluateParsed(parsed: ParsedRule, context: RuleContext): string[] {
  return runParsed(parsed, context).map(toText)
}

function runParsed(parsed: ParsedRule, context: RuleContext): unknown[] {
  for (const alternative of parsed.alternatives) {
    const results = runInterleave(alternative.parts, context)
    // First *non-empty* wins: this is what lets a document carry a rule for
    // the field a backend renamed and the one it renamed it to, and keep
    // working through the change.
    if (results.length > 0) return results
  }
  return []
}

function runInterleave(
  parts: { atoms: Atom[] }[],
  context: RuleContext,
): unknown[] {
  if (parts.length === 1) return runConcat(parts[0]!.atoms, context)

  const lists = parts.map((part) => runConcat(part.atoms, context))
  const longest = Math.max(...lists.map((l) => l.length))
  const out: unknown[] = []
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i])
    }
  }
  return out
}

function runConcat(atoms: Atom[], context: RuleContext): unknown[] {
  const out: unknown[] = []
  for (const atom of atoms) out.push(...runAtom(atom, context))
  return out
}

function runAtom(atom: Atom, context: RuleContext): unknown[] {
  // `@put` runs first: a later atom in the same rule can `@get` what it
  // stored, which is how a token lifted out of one field reaches another.
  for (const { key, rule } of atom.put) {
    const captured = evaluate(rule, context)
    if (captured.length > 0) context.vars?.set(key, captured[0]!)
  }

  if (atom.get !== undefined) {
    const value = context.vars?.get(atom.get)
    return value === undefined ? [] : [value]
  }

  const selected = select(atom, context)
  if (atom.replacements.length === 0) return selected
  return selected.map((value) => applyReplacements(toText(value), atom, context))
}

function select(atom: Atom, context: RuleContext): unknown[] {
  if (!engineAvailable(atom.engine)) throw new RuleEngineUnavailableError(atom.engine)

  switch (atom.engine) {
    case 'template':
      // A template always produces exactly one value, even an empty one: it
      // is text, not a selection, and "no match" is not a thing it can mean.
      return [renderTemplate(atom.selector, context.scope, context.site)]

    case 'json':
      try {
        return queryJsonPath(context.document, atom.selector)
      } catch (error) {
        if (error instanceof RuleSyntaxError) throw asRuleError(error.message, context)
        throw error
      }

    case 'regex':
      return runRegex(atom.selector, context)

    default:
      throw new RuleEngineUnavailableError(atom.engine)
  }
}

/**
 * A regex over the document as text.
 *
 * Capture group 1 where there is one, group 0 otherwise — the documented
 * behaviour, and the one that makes `:(\d+)kbps` mean "the number" rather
 * than "the number and the word".
 */
function runRegex(pattern: string, context: RuleContext): string[] {
  const text = toText(context.document)
  let expression: RegExp
  try {
    expression = new RegExp(pattern, 'g')
  } catch (error) {
    throw asRuleError(`bad regex ${JSON.stringify(pattern)}: ${String(error)}`, context)
  }

  const out: string[] = []
  for (const match of text.matchAll(expression)) {
    out.push(match[1] ?? match[0])
    // A zero-length match would loop forever against `matchAll`'s cursor.
    if (match[0] === '') break
  }
  return out
}

function applyReplacements(value: string, atom: Atom, context: RuleContext): string {
  let out = value
  for (const { pattern, replacement, firstOnly } of atom.replacements) {
    let expression: RegExp
    try {
      expression = new RegExp(pattern, firstOnly ? '' : 'g')
    } catch (error) {
      throw asRuleError(`bad replacement ${JSON.stringify(pattern)}: ${String(error)}`, context)
    }
    out = out.replace(expression, replacement)
  }
  return out
}

/**
 * A selected value as text.
 *
 * An object is JSON rather than `[object Object]`: a rule that selected a
 * subtree by mistake should show what it selected, because that is the fastest
 * route to seeing the mistake.
 */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function asRuleError(message: string, context: RuleContext): RuleError {
  return new RuleError(
    message,
    { block: context.site.block, field: context.site.field },
    context.site.sourceId,
  )
}
