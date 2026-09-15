/**
 * The view ids `plugin-library` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const LIBRARY_VIEWS = {
  /** Every playlist, and the way in to creating one. */
  playlists: 'library.playlists',
  /** One playlist's tracks. */
  playlist: 'library.playlist',
  /** Saved tracks, albums, artists and playlists. */
  favorites: 'library.favorites',
} as const

/** Routes are the same ids, because a route is what the shells navigate to. */
export const LIBRARY_ROUTES = LIBRARY_VIEWS
