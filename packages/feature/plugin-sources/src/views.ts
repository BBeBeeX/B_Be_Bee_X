/**
 * The view ids `plugin-sources` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 3).
 */

export const SOURCES_VIEWS = {
  /** Tracks and albums. The app's home screen. */
  library: 'sources.library',
  /**
   * Search across the selected sources, one result section per source.
   *
   * Deliberately *not* merged into one list: a source that fails, is slow or
   * answers nothing has to be visible, or "search is broken" is
   * indistinguishable from "this source has no match" (docs/06 §4.1).
   */
  search: 'sources.search',
  /** One album with its tracks. */
  album: 'sources.album',
  /** The imported sources, in settings. */
  sourceList: 'sources.settings',
  /** Paste a source string. */
  sourceImport: 'sources.import',
  /**
   * One source, exercised by hand.
   *
   * A selector picks which imported source everything below tests; each
   * feature the source implements gets its own test area with user-chosen
   * parameters, and the trace shows the output and every HTTP request whole.
   */
  sourceTest: 'sources.test',
} as const

export const SOURCES_ROUTES = {
  library: 'sources.library',
  search: 'sources.search',
  album: 'sources.album',
  sourceImport: 'sources.import',
  sourceTest: 'sources.test',
} as const
