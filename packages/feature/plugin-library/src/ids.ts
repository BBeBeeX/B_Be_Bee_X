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
