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
  evaluateRule,
  isTemplate,
  renderTemplate,
  type RuleSite,
  type TemplateScope,
} from './template.js'
