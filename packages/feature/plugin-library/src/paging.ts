/**
 * The paging convention the curation reads share.
 *
 * Same shape as the catalogue's (`plugin-sources/src/catalog.ts`): offsets are
 * the cursor, one row beyond the page answers `hasMore`, and the format is
 * opaque so a caller cannot come to depend on it being a number.
 */

import type { Paged } from '@BBeBee/protocol'
import type { PageRequest } from '@BBeBee/protocol'

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500

export function offsetOf(cursor: string | undefined): number {
  if (!cursor) return 0
  const n = Number.parseInt(cursor, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function limitOf(page: PageRequest | undefined, fallback = DEFAULT_LIMIT): number {
  const requested = page?.limit ?? fallback
  return Math.max(1, Math.min(MAX_LIMIT, requested))
}

export function paged<T>(items: T[], offset: number, limit: number): Paged<T> {
  const hasMore = items.length > limit
  return {
    items: hasMore ? items.slice(0, limit) : items,
    hasMore,
    ...(hasMore ? { cursor: String(offset + limit) } : {}),
  }
}
