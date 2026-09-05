/**
 * Bounding a regex written by a stranger.
 *
 * A rule's pattern comes from an imported document, and JavaScript's regex
 * engine is backtracking and **uninterruptible**: `(a+)+b` against a few dozen
 * `a`s takes exponential time, and there is no timer, worker, or signal that
 * can stop it once it starts. Measured before this existed: 24 characters of
 * input took 372ms, 50,000 never returned.
 *
 * docs/06 §8 promises a two-second wall clock per rule. That promise is only
 * fully keepable inside the sandbox realm, where an interrupt handler can
 * stop a running script — which is `ctx.js`, and is not built yet. Until then
 * this is the honest partial: refuse the patterns that can blow up, and cap
 * how much text any pattern is run against.
 *
 * ⚠️ **This is a bound, not a proof.** The detector is conservative and
 * pattern-shaped; a sufficiently inventive pattern may still be slow. What it
 * removes is the whole class of accidental and casually-malicious blowups,
 * and it makes the residual finite rather than unbounded.
 */

/** How much text a single pattern may be run against. */
export const MAX_REGEX_INPUT = 256 * 1024

/** How many matches one rule may produce. A pathological global match, bounded. */
export const MAX_REGEX_MATCHES = 10_000

export class UnsafeRegexError extends Error {
  override readonly name = 'UnsafeRegexError'
  constructor(
    readonly pattern: string,
    reason: string,
  ) {
    super(`refusing regex ${JSON.stringify(pattern)}: ${reason}`)
  }
}

/**
 * Whether a pattern can backtrack catastrophically.
 *
 * The signature of the whole family is **a quantifier applied to a group that
 * itself contains a quantifier** — `(a+)+`, `(a*)*`, `(a|aa)+`, `(\d+)*`. Each
 * gives the engine two ways to split the same input, and the number of splits
 * doubles per character.
 *
 * Scans with a small state machine rather than a regex, because a regex that
 * detects dangerous regexes is a delightful way to be bitten twice.
 */
export function isUnsafeRegex(pattern: string): { unsafe: boolean; reason?: string } {
  let i = 0
  let inClass = false
  // For each open group: whether a quantifier has been seen inside it, and
  // whether it contains a top-level alternation.
  const groups: { quantified: boolean; alternation: boolean }[] = []

  /**
   * Whether a quantifier sits at `index`.
   *
   * ⚠️ `counted` distinguishes the two places this is asked, and the answer
   * genuinely differs between them:
   *
   *  - **On a group** (`counted`): `{n}` with n ≥ 2 multiplies. `(.*a){20}b`
   *    is not "twenty repetitions of a bounded thing" — it is twenty nested
   *    chances to split the input, which is `(.*a)+` with the exponent
   *    written out. Measured: sixty characters, no match, still running after
   *    two minutes.
   *  - **Inline, inside a body**: it does not. `a{2}` is two characters wide
   *    however you look at it, so `(a{2})+` — i.e. `(aa)+` — offers the
   *    engine no second arrangement and is perfectly safe. Counting it would
   *    refuse a shape real documents use.
   *
   * Open-ended forms (`{2,}`, `{2,5}`) multiply in both positions.
   */
  const quantifierAt = (index: number, counted = false): boolean => {
    const ch = pattern[index]
    if (ch === '*' || ch === '+') return true
    if (ch === '?') return false // optional alone does not multiply
    if (ch !== '{') return false
    const close = pattern.indexOf('}', index)
    if (close === -1) return false

    const body = pattern.slice(index + 1, close)
    if (body.includes(',')) return true
    if (!counted) return false
    const exact = Number(body)
    // `{0}` and `{1}` offer no second arrangement, whatever they wrap.
    return Number.isFinite(exact) && exact >= 2
  }

  while (i < pattern.length) {
    const ch = pattern[i]

    if (ch === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
      i++
      continue
    }
    if (ch === '[') {
      inClass = true
      i++
      continue
    }
    if (ch === '(') {
      groups.push({ quantified: false, alternation: false })
      i++
      continue
    }
    if (ch === '|') {
      const top = groups[groups.length - 1]
      if (top) top.alternation = true
      i++
      continue
    }
    if (ch === ')') {
      const closed = groups.pop()
      if (closed && quantifierAt(i + 1, true)) {
        if (closed.quantified) {
          return {
            unsafe: true,
            reason:
              'a repeated group that already repeats inside — the classic ' +
              'exponential shape, e.g. (a+)+',
          }
        }
        if (closed.alternation) {
          return {
            unsafe: true,
            reason: 'a repeated group containing an alternation, e.g. (a|aa)+',
          }
        }
        // The group itself now counts as a quantifier for any enclosing group.
        const parent = groups[groups.length - 1]
        if (parent) parent.quantified = true
      }
      i++
      continue
    }
    if (quantifierAt(i)) {
      const parent = groups[groups.length - 1]
      if (parent) parent.quantified = true
      i++
      continue
    }
    i++
  }
  return { unsafe: false }
}

/**
 * Compile a pattern from a source document, or refuse it.
 *
 * Refusal is deliberate rather than best-effort: a rule that cannot be run
 * safely should say so at the point the author can fix it, not become a frozen
 * app on someone else's phone.
 */
export function compileRuleRegex(pattern: string, flags: string): RegExp {
  const verdict = isUnsafeRegex(pattern)
  if (verdict.unsafe) throw new UnsafeRegexError(pattern, verdict.reason!)
  try {
    return new RegExp(pattern, flags)
  } catch (error) {
    throw new UnsafeRegexError(pattern, String(error))
  }
}

/** Truncate to what a pattern may see, so cost stays bounded by input too. */
export function boundInput(text: string): string {
  return text.length <= MAX_REGEX_INPUT ? text : text.slice(0, MAX_REGEX_INPUT)
}
