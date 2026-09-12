/**
 * Deterministic ordering over a collection.
 *
 * Shuffle in the queue is a seed plus a permutation, not a dice roll per
 * advance (docs/05 §2): the same seed must produce the same order on every
 * device and across a restart, so that `previous()` means something and the
 * UI can show the upcoming queue truthfully. The algorithm is generic; the
 * only requirement is that the PRNG be reproducible.
 */

/** Deterministic PRNG: same seed, same sequence, on every device. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates over a copy, driven by the seeded PRNG. The input is untouched. */
export function permute<T>(values: readonly T[], seed: number): T[] {
  const out = [...values]
  const random = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
