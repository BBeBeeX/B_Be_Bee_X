/**
 * The view ids `plugin-download` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const DOWNLOADS_VIEWS = {
  /** The download queue and what it has cached. */
  page: 'downloads.page',
} as const
