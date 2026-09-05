/**
 * The rule language a source document is written in.
 *
 * Pure logic: no Cordis, no platform SDK, and no I/O of any kind. It takes a
 * rule and a scope and returns a value; every fetch belongs to
 * `plugin-source-runtime`. Keeping it pure is what makes a corpus of real
 * source documents runnable against recorded fixtures with no network.
 *
 * See docs/06-music-sources.md §3.
 */

export {
  RuleEngineUnavailableError,
  engineAvailable,
  evaluate,
  evaluateNodes,
  evaluateParsed,
  toText,
  type RuleContext,
  type RuleTrace,
  type RuleTraceEntry,
} from './evaluate.js'
export { parseJsonPath, queryJsonPath } from './jsonpath.js'
export { RuleSyntaxError, type RuleDialect } from './syntax-error.js'
export {
  MAX_REGEX_INPUT,
  MAX_REGEX_MATCHES,
  UnsafeRegexError,
  boundInput,
  compileRuleRegex,
  isUnsafeRegex,
} from './regex-guard.js'
export {
  inferEngine,
  parseRule,
  type Atom,
  type Concat,
  type Engine,
  type Interleave,
  type ParsedRule,
  type Replacement,
} from './parse.js'
export {
  evaluateRule,
  evaluateUrlTemplate,
  isTemplate,
  renderTemplate,
  type JsEvaluator,
  type RuleSite,
  type TemplateScope,
} from './template.js'
