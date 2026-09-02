/**
 * Fractional indexing — ordering rows without renumbering them.
 *
 * A queue or playlist row's `position` is a string key, and moving one item
 * writes exactly one row: a key strictly between its new neighbours. Integer
 * positions would rewrite every row after the insertion point, which is
 * visibly slow on a phone with a 5,000-track queue and generates an enormous
 * sync delta for a one-item move.
 *
 * Keys sort with plain lexicographic `ORDER BY`, so SQLite does the work.
 *
 * The midpoint algorithm is the standard one (Greenspan's "Implementing
 * Fractional Indexing"): drop the common prefix, then pick a digit strictly
 * between the two, descending a level when the digits are adjacent.
 *
 * See docs/07-data-model.md §4.6 and docs/05-audio-playback.md §2.
 */

/** Base-36, so keys stay legible in a database browser and sort as bytes. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const ZERO = DIGITS[0]!
const LAST = DIGITS[DIGITS.length - 1]!

export class FracIndexError extends Error {
  override readonly name = 'FracIndexError'
}

function assertKey(key: string, label: string): void {
  if (key === '') return
  for (const ch of key) {
    if (!DIGITS.includes(ch)) {
      throw new FracIndexError(`${label} key ${JSON.stringify(key)} is not a fractional index`)
    }
  }
  if (key.endsWith(ZERO)) {
    // A trailing zero has no midpoint below it, so the invariant is that keys
    // never carry one. Generated keys never do; a hand-edited row might.
    throw new FracIndexError(`${label} key ${JSON.stringify(key)} has a trailing zero`)
  }
}

function midpoint(a: string, b: string | undefined): string {
  if (b !== undefined && a >= b) {
    throw new FracIndexError(`keys out of order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`)
  }

  if (b !== undefined) {
    // Everything the two share is carried through untouched.
    let n = 0
    while ((a[n] ?? ZERO) === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }

  const digitA = a ? DIGITS.indexOf(a[0]!) : 0
  const digitB = b !== undefined && b !== '' ? DIGITS.indexOf(b[0]!) : DIGITS.length

  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!
  }
  // The digits are adjacent, so the midpoint is one level deeper.
  if (b !== undefined && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA]! + midpoint(a.slice(1), undefined)
}

/**
 * A key strictly between `before` and `after`.
 *
 * Pass `undefined` for either end: `between(undefined, first)` prepends,
 * `between(last, undefined)` appends, and `between()` is the first key in an
 * empty list.
 */
export function between(before?: string, after?: string): string {
  if (before !== undefined) assertKey(before, 'before')
  if (after !== undefined) assertKey(after, 'after')
  return midpoint(before ?? '', after)
}

/** `n` ascending keys, for seeding a list in one pass. */
export function sequence(n: number, before?: string, after?: string): string[] {
  const keys: string[] = []
  let low = before
  for (let i = 0; i < n; i++) {
    const key = between(low, after)
    keys.push(key)
    low = key
  }
  return keys
}

/**
 * Whether a key is long enough to be worth rebalancing.
 *
 * Repeatedly inserting between the same two neighbours grows keys one
 * character at a time; a rare rebalance pass rewrites the list with short keys
 * again. Nothing in M1 rebalances — this exists so the check has one home.
 */
export function needsRebalance(key: string, threshold = 32): boolean {
  return key.length >= threshold
}

/** The alphabet, exported for tests and for a future rebalance pass. */
export const FRAC_DIGITS = DIGITS
export const FRAC_LAST_DIGIT = LAST
