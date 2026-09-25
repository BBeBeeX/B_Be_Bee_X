/**
 * Ids for rows the user creates.
 *
 * A local playlist or collection has no remote id to borrow, and unlike a
 * scanned file it has nothing stable to hash either — two playlists may share
 * a name, and they are different objects. So these are opaque and unique
 * rather than derived, and `@BBeBee/toolkit`'s `stableId` is deliberately not
 * used: a deterministic id would make two same-named playlists one row.
 *
 * `Math.random` is not a security primitive and is not asked to be one. The
 * id only has to not collide with the user's other playlists.
 */

let counter = 0

export function newId(prefix: string): string {
  counter = (counter + 1) % 0xffff
  const random = Math.floor(Math.random() * 0x1_0000_0000).toString(36)
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${random}`
}

/**
 * A RFC-4122 v4 UUID where the platform provides `crypto.randomUUID` (Node,
 * Chromium), and a random fallback where it does not (Hermes). The profile id
 * is the one caller; it only has to be unique per install.
 */
export function randomUuid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}
