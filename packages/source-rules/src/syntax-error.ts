/**
 * One error for "this rule string is malformed".
 *
 * ⚠️ There were two, identically named — one in `parse.ts`, one in
 * `jsonpath.ts` — and only the JSONPath one was re-exported. So a caller who
 * wrote `catch (e) { if (e instanceof RuleSyntaxError) … }` handled a bad path
 * and silently fell through on a bad rule, which is the more common mistake of
 * the two. Same name, different identity, no compiler complaint.
 *
 * The distinction the two classes were drawing — *which* grammar rejected the
 * string — is real, so it survives as `dialect` rather than as a second class.
 */

/** Which grammar refused the string. */
export type RuleDialect = 'rule' | 'JSONPath'

export class RuleSyntaxError extends Error {
  override readonly name = 'RuleSyntaxError'

  constructor(
    /** The offending text, exactly as the author wrote it. */
    readonly rule: string,
    reason: string,
    readonly dialect: RuleDialect = 'rule',
  ) {
    super(`bad ${dialect} ${JSON.stringify(rule)}: ${reason}`)
  }
}
