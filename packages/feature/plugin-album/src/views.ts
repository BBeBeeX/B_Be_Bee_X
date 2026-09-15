/**
 * The view ids `plugin-album` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const ALBUM_VIEWS = {
  /** One album, with its tracks and the album-level actions. */
  album: 'album.view',
} as const

/** Routes are the same ids, because a route is what the shells navigate to. */
export const ALBUM_ROUTES = ALBUM_VIEWS
