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
} as const

export const SOURCES_ROUTES = {
  library: 'sources.library',
  album: 'sources.album',
} as const
