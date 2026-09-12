/**
 * Deterministic placeholder artwork, GitHub-identicon style.
 *
 * A track or album with no cover art would otherwise render as an anonymous
 * grey square — indistinguishable from every other anonymous grey square on
 * the screen, and indistinguishable from "image still loading". A pattern
 * derived from the entity's own identity fixes both: it is stable across
 * sessions and platforms, so a library without a single cover still *looks*
 * organised, and two different albums never look the same by accident.
 *
 * The method is the identicon's: hash the seed, take 15 bits as a 5×5 grid
 * generated in the left three columns and mirrored to the right (vertical
 * symmetry is what makes the shape read as deliberate), and take a hue from
 * what is left of the hash. The colours are adapted to this design language
 * rather than GitHub's light chassis: a dark tint of the same hue behind a
 * vivid one, so the square sits in the luminance stepping of docs/08 §6
 * instead of glowing against it.
 *
 * This is the half of the fallback that must not be written twice — the two
 * kits render the pattern with their own elements, but they must agree on
 * *which* cells and *which* colours, or the same album is green on desktop
 * and blue on the phone.
 */

/** The computed pattern, platform-neutral: the kits supply the pixels. */
export interface IdenticonPattern {
  /** Row-major 5×5. Cell `r*5+c` is painted when true. */
  cells: readonly boolean[]
  /** The painted cells. Vivid, for contrast against the dark background. */
  foreground: string
  /** The unpainted cells and the square behind them. A dark tint of the hue. */
  background: string
}

/** The grid is 5×5, generated for the left three columns and mirrored. */
const GRID = 5
/** 15 pattern bits: three of the five columns. */
const PATTERN_BITS = 15

/**
 * FNV-1a, 32 bit.
 *
 * Not cryptographic and does not need to be: the only adversary here is two
 * albums landing on the same pattern, and a collision there is cosmetic. What
 * it must be is identical everywhere — no `node:crypto`, no `TextEncoder`
 * dependency on the seed path, just UTF-8 code units done by hand, so mobile,
 * desktop and the tests all hash the same URN to the same square.
 */
function fnv1a(seed: string): number {
  let hash = 0x811c9dc5
  // One byte per step: XOR it in, multiply by the FNV prime, keep it unsigned.
  const byte = (unit: number) => {
    hash ^= unit & 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  for (let i = 0; i < seed.length; i++) {
    // `codePointAt` pairs a surrogate pair into one code point; the extra
    // increment skips the low half so it is not hashed again.
    const code = seed.codePointAt(i)!
    if (code > 0xffff) i++
    // UTF-8 encode it, so a title in any script hashes the same bytes on
    // every platform.
    if (code < 0x80) {
      byte(code)
    } else if (code < 0x800) {
      byte(0xc0 | (code >> 6))
      byte(0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      byte(0xe0 | (code >> 12))
      byte(0x80 | ((code >> 6) & 0x3f))
      byte(0x80 | (code & 0x3f))
    } else {
      byte(0xf0 | (code >> 18))
      byte(0x80 | ((code >> 12) & 0x3f))
      byte(0x80 | ((code >> 6) & 0x3f))
      byte(0x80 | (code & 0x3f))
    }
  }
  return hash >>> 0
}

/**
 * The pattern for a seed, or `undefined` when there is nothing to derive it
 * from — an absent or empty seed means "no identity known", and the kits fall
 * back to the plain colour square in that case rather than every artwork-less
 * entity sharing the pattern of the empty string.
 */
export function identicon(seed: string | undefined): IdenticonPattern | undefined {
  if (!seed) return undefined

  const hash = fnv1a(seed)

  // Low 15 bits → cells, column-major within the left half so mirroring is a
  // single index flip.
  const cells: boolean[] = new Array(GRID * GRID).fill(false)
  let painted = 0
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < GRID; row++) {
      const bit = (hash >>> (column * GRID + row)) & 1
      if (bit) {
        cells[row * GRID + column] = true
        // The mirror column, 4 - column, gets the same answer.
        cells[row * GRID + (GRID - 1 - column)] = true
        painted++
      }
    }
  }
  // 1 in 32 768 seeds hashes to an empty grid — a plain square that looks
  // like the fallback it was meant to replace. The centre cell is the
  // smallest answer that cannot happen by accident twice in a row.
  if (painted === 0) cells[12] = true

  // What is left of the hash picks the hue; the saturations are fixed, so the
  // set of squares across a library is varied but consistent in weight.
  const hue = (hash >>> PATTERN_BITS) % 360
  return {
    cells,
    foreground: `hsl(${hue}, 68%, 58%)`,
    background: `hsl(${hue}, 30%, 14%)`,
  }
}
