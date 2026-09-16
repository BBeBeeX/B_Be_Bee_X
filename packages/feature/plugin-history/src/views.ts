/**
 * The view ids `plugin-history` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const HISTORY_VIEWS = {
  /** The playback history screen with stats and heatmap. */
  history: 'history.view',
} as const

/** Routes are the same ids, because a route is what the shells navigate to. */
export const HISTORY_ROUTES = HISTORY_VIEWS
