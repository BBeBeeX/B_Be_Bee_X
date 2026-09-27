/**
 * Drop-position translation for dragging rows inside the queue screen.
 *
 * The screen shows the *play order* (`player.upcoming()`), while
 * `player.moveItem(id, toIndex)` takes an index into the queue's *row order*
 * (docs/05 §2). The two coincide only when shuffle is off, so this module is
 * the single place that maps what the user sees to what the service accepts —
 * and the reason dragging is disabled while shuffle is on.
 */

import type { QueueItem } from '@BBeBee/protocol'

/**
 * Translate a drop position in the visible upcoming list into the
 * `toIndex` `player.moveItem` expects.
 *
 * `dropIndex` is the gap the row was dropped into: `k` means "insert before
 * `upcoming[k]`", and `upcoming.length` means "after the last row". Both
 * lists must come from the same moment — `useQueue` and `useUpcoming` in the
 * same render.
 */
export function upcomingDropToQueueIndex(
  draggedId: string,
  dropIndex: number,
  queue: readonly QueueItem[],
  upcoming: readonly QueueItem[],
): number {
  const rowIndexOf = (id: string): number => {
    const at = queue.findIndex((item) => item.id === id)
    return at < 0 ? queue.length : at
  }

  const draggedRow = rowIndexOf(draggedId)
  const anchor =
    dropIndex < upcoming.length ? upcoming[dropIndex] : upcoming[upcoming.length - 1]
  if (!anchor) return queue.length

  // The service computes the target against the list *without* the dragged
  // row, so an anchor sitting after it shifts one slot up.
  const anchorRow = rowIndexOf(anchor.id)
  const anchorWithoutDragged = anchorRow > draggedRow ? anchorRow - 1 : anchorRow

  return dropIndex < upcoming.length ? anchorWithoutDragged : anchorWithoutDragged + 1
}
