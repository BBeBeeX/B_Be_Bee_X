/**
 * Normalising the strings metadata sources write.
 *
 * Taggers and backends disagree on how to spell "several people made this
 * track", and a catalogue that keeps `A; B` and `A;B` apart splits one
 * artist's library in two. Splitting and folding belong to one function so
 * that every source of names gets the same treatment.
 */

/**
 * Split a tag that names several artists, which most taggers write inline.
 *
 * The separators fall into two shapes: punctuation, which needs no
 * surrounding space, and words, which do — `\bfeat\.?\b` does not match
 * "feat. " because the boundary after `.` is not a word boundary, and the
 * leftover "." then rides along on the next name.
 */
export function splitArtists(value: string | undefined): string[] {
  if (!value) return []
  return value
    // `/` only counts as a separator with whitespace around it: AC/DC is one
    // band, "Simon / Garfunkel" is two.
    .split(/\s*[;,]\s*|\s+\/\s+|\s+(?:feat\.?|ft\.?|with)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
}
