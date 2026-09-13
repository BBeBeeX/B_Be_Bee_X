/**
 * The view ids `plugin-sources` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 3).
 */

export const SOURCES_VIEWS = {
  /** Tracks and albums. The app's home screen. */
  library: 'sources.library',
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
  album: 'sources.album',
  sourceImport: 'sources.import',
  sourceTest: 'sources.test',
} as const
