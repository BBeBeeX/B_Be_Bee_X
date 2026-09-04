/**
 * The `=` template evaluator — the M1 slice of the rule language.
 *
 * A rule is a selector unless it starts with `=`. This module implements the
 * `=` half and nothing else: literal text with `{{ }}` interpolation, which is
 * exactly what a stream URL needs and the smallest useful piece of the
 * language (docs/11 MD-7).
 *
 * The selector engines, combinators, `@put`/`@get` and `@js:` arrive with the
 * rest of the runtime. Until they do, a rule this module cannot understand is
 * **refused, not passed through as a literal** — see `evaluateRule`. Silently
 * treating an unrecognised rule as text is the failure mode that would make
 * every later rule bug harder to find, because the symptom appears three steps
 * downstream as a URL that is not a URL.
 *
 * Deliberately pure: no I/O, no platform, no Cordis. It takes a template and a
 * scope and returns a string, which is what makes the rule corpus runnable
 * without a network.
 *
 * See docs/06-music-sources.md §3.1–§3.2.
 */

import { RuleError } from '@BBeBee/protocol'

/** Where a rule was written, for error attribution. */
export interface RuleSite {
  block: string
  field: string
  sourceId?: string
}

/**
 * What `{{ }}` can see.
 *
 * Deliberately a plain data bag rather than a live object graph: an expression
 * evaluates against a snapshot, so nothing a rule does can reach back into the
 * runtime. The full language adds `item`, `result` and the `src` host object;
 * both arrive with the engines that need them.
 */
export interface TemplateScope {
  source?: { url?: string; var?: string; name?: string }
  track?: Record<string, unknown>
  album?: Record<string, unknown>
  prefs?: Record<string, unknown>
  key?: string
  page?: number
  baseUrl?: string
  /**
   * The current list element, while a `ListRule`'s fields are evaluated.
   *
   * This is what lets a field build a URL out of a sibling field —
   * `{{item.coverArt}}` — which the selector engines cannot do, because a
   * selector reaches *into* the element rather than across it.
   */
  item?: Record<string, unknown>
}

const TEMPLATE_PREFIX = '='
const PLACEHOLDER = /[{]{2}([^{}]*)[}]{2}/g
/** A brace left over after every well-formed placeholder was consumed. */
const STRAY_BRACE = /[{]{2}|[}]{2}/

/** Whether a rule is a `=` template, and so within this module's slice. */
export function isTemplate(rule: string): boolean {
  return rule.startsWith(TEMPLATE_PREFIX)
}

/**
 * Evaluate a rule.
 *
 * Templates are rendered. Anything else is refused with a `RuleError` naming
 * the block and field, because the engine that would handle it does not exist
 * yet and pretending otherwise produces a wrong answer instead of a clear one.
 */
export function evaluateRule(rule: string, scope: TemplateScope, site: RuleSite): string {
  if (!isTemplate(rule)) {
    throw new RuleError(
      `rule ${JSON.stringify(rule)} needs a selector engine, which this build does not have. ` +
        `Literal values must start with "=" (docs/06 §3.1).`,
      { block: site.block, field: site.field },
      site.sourceId,
    )
  }
  return renderTemplate(rule.slice(TEMPLATE_PREFIX.length), scope, site)
}

/**
 * Render `{{ }}` placeholders in a literal string.
 *
 * The expression grammar is deliberately tiny — a dotted path, optionally
 * through array indices — rather than "JavaScript, evaluated". The full
 * language runs expressions inside `ctx.js`; there is no sandbox in this
 * slice, so there is no `eval` either. A path this cannot resolve is a
 * `RuleError`, not an empty string: a stream URL with a silently missing id
 * fails minutes later in a way nobody can diagnose. So is an unbalanced
 * placeholder, for the same reason.
 *
 * ⚠️ Interpolation is **verbatim**, not URL-encoded. A value containing `&`,
 * `#` or a space rewrites the structure of the URL it lands in, which is
 * parameter smuggling within the source's own host. Encoding here would
 * corrupt the many rules that interpolate a whole URL or a query fragment, so
 * the encoding filter belongs in the full language (`{{x|url}}`); until it
 * exists, a document interpolating attacker-influenced text into a URL is
 * relying on its backend to be sane about it.
 */
export function renderTemplate(template: string, scope: TemplateScope, site: RuleSite): string {
  let failure: RuleError | undefined

  const out = template.replace(PLACEHOLDER, (_match, expr: string) => {
    const path = expr.trim()
    if (!path) {
      failure ??= ruleError('empty {{ }} placeholder', site)
      return ''
    }

    const value = resolvePath(scope, path)
    if (value === undefined || value === null) {
      failure ??= ruleError(`{{${path}}} resolved to nothing`, site)
      return ''
    }
    if (typeof value === 'object') {
      failure ??= ruleError(`{{${path}}} is an object; templates interpolate scalars`, site)
      return ''
    }
    return String(value)
  })

  if (failure) throw failure

  // An unbalanced placeholder is a typo, and passing it through as literal
  // text is how it becomes a URL containing "{{track.id" that fails three
  // steps later as an unexplained 404. The module's own promise is to refuse
  // what it does not understand, and that has to include this.
  if (STRAY_BRACE.test(out)) {
    throw ruleError(`unbalanced {{ }} in ${JSON.stringify(template)}`, site)
  }

  return out
}

/**
 * Resolve a dotted path against the scope.
 *
 * Own properties only: a path may not walk the prototype chain, so
 * `{{track.constructor.name}}` resolves to nothing rather than to a foothold.
 */
function resolvePath(scope: TemplateScope, path: string): unknown {
  let current: unknown = scope
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function ruleError(message: string, site: RuleSite): RuleError {
  return new RuleError(message, { block: site.block, field: site.field }, site.sourceId)
}
