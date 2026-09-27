import { describe, expect, it } from 'vitest'
import { upcomingDropToQueueIndex } from './reorder.js'
import type { QueueItem } from '@BBeBee/protocol'

const item = (id: string): QueueItem => ({ id, trackUrn: `BBeBee:local:track:${id}`, addedBy: 'user' })

/** Row order [a, b, c, d]; with shuffle off the screen shows upcoming [b, c, d]. */
const queue = ['a', 'b', 'c', 'd'].map(item)
const upcoming = ['b', 'c', 'd'].map(item)

describe('upcomingDropToQueueIndex', () => {
  it('is a no-op when the row lands where it already is', () => {
    // Dropping b into the gap above or below itself must not shift it.
    expect(upcomingDropToQueueIndex('b', 0, queue, upcoming)).toBe(1)
    expect(upcomingDropToQueueIndex('b', 1, queue, upcoming)).toBe(1)
  })

  it('compensates for the dragged row when the anchor sits after it', () => {
    // b dropped before d (i.e. after c) → row order [a, c, b, d]. The service
    // indexes the list *without* the dragged row, so the anchor's index loses
    // one slot.
    expect(upcomingDropToQueueIndex('b', 2, queue, upcoming)).toBe(2)
  })

  it('leaves the anchor alone when it sits before the dragged row', () => {
    // c dropped before b → row order [a, c, b, d].
    expect(upcomingDropToQueueIndex('c', 0, queue, upcoming)).toBe(1)
  })

  it('translates a drop after the last row to the end of the queue', () => {
    // b dragged past d → row order [a, c, d, b].
    expect(upcomingDropToQueueIndex('b', 3, queue, upcoming)).toBe(3)
  })

  it('moves a row up across its upper neighbour', () => {
    // d dropped before c → row order [a, b, d, c].
    expect(upcomingDropToQueueIndex('d', 1, queue, upcoming)).toBe(2)
  })

  it('indexes the full queue even though upcoming hides played rows', () => {
    // Row order [a, b, c, d] with b playing: the screen shows only [c, d],
    // yet d dropped before c must land at row index 2, not at 0.
    expect(upcomingDropToQueueIndex('d', 0, queue, ['c', 'd'].map(item))).toBe(2)
  })

  it('falls through to the end of the queue for unknown ids or an empty list', () => {
    expect(upcomingDropToQueueIndex('x', 0, queue, ['b'].map(item))).toBe(1)
    expect(upcomingDropToQueueIndex('a', 0, queue, [])).toBe(4)
  })
})
