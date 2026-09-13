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
   * One source, traced and edited in the same place.
   *
   * Deliberately one view rather than two: docs/06 §10 makes the debug screen
   * *be* the editor, because the loop that repairs a rotted source is run a
   * step, see which rule failed, change it, run it again. Two screens make
   * that a navigation exercise.
   */
  sourceDebug: 'sources.debug',
  /**
   * One source, exercised by hand: a raw request through its scoped HTTP, or
   * a script run in its sandbox with custom arguments. Where `sourceDebug`
   * answers "which rule failed", this answers "what does this backend
   * actually say, and what does my code return".
   */
  sourceTest: 'sources.test',
} as const

export const SOURCES_ROUTES = {
  library: 'sources.library',
  album: 'sources.album',
  sourceImport: 'sources.import',
  sourceDebug: 'sources.debug',
  sourceTest: 'sources.test',
} as const
