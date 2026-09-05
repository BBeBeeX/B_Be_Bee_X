/**
 * The catalogue's collation.
 *
 * One function, in the protocol, because it is a property of the *catalogue*
 * rather than of whoever happens to be writing to it. A library that shows
 * "The Beatles" under T beside "Beatles, The" under B is the visible symptom
 * of two writers disagreeing about this, and the two writers — the local
 * scanner and the source cache — had each grown their own.
 */

/**
 * A sort key that files "The Beatles" under B and ignores leading punctuation.
 *
 * Leading quotes and brackets are stripped first: a title stored as `"Heroes"`
 * (Bowie's, quotes included) otherwise sorts under `"` — above every letter,
 * at the top of the list, for ever.
 */
export function sortKey(value: string | undefined): string | undefined {
  if (!value) return undefined
  const stripped = value.trim().replace(/^["'“”‘’([]+/, '')
  return stripped.replace(/^(the|a|an)\s+/i, '').toLowerCase()
}
