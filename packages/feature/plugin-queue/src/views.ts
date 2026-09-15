/**
 * The view ids `plugin-queue` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const QUEUE_VIEWS = {
  /** The up-next list. */
  queue: 'queue.view',
} as const

/** Routes are the same ids, because a route is what the shells navigate to. */
export const QUEUE_ROUTES = QUEUE_VIEWS
