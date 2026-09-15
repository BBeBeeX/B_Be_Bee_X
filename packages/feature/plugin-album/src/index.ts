/**
 * `plugin-album` — the album page.
 *
 * A **surface** plugin, and deliberately thin. It owns the album route and the
 * view id; the detail itself is read through `ctx.sources.getAlbum`, because
 * catalogue reads belong beside the writes that produce them (MD-3, docs/11
 * §1.3). It claims no service key: the album has no state of its own — the
 * detail is a read, and playing it is `ctx.player`'s job. Extracting this from
 * `plugin-sources` is what lets the catalogue plugin stop carrying a screen,
 * and what gives album-only work — links, enrichment, an album editor — a home
 * that is not the source registry.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { ALBUM_ROUTES } from './views.js'

export const name = 'plugin-album'

/**
 * The route descriptor.
 *
 * No placement, deliberately: the album is reached from a listing (the library
 * grid, a search result), never from the chrome — a tab for one album is a tab
 * for every album. The empty array is not the same as omitting the field on
 * desktop; the sidebar treats an absent placement as `sidebar`, so `[]` is how
 * a screen says "navigation only" (docs/08 §3).
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-album: loaded')

  // The `ui` inject is a child fiber, so unloading this plugin unloads the
  // contribution with it. Not awaited: a build without `plugin-ui` is a build
  // with no contribution, not a plugin that never finishes loading.
  const fiber = ctx.inject(['ui'], (scoped) =>
    scoped.effect(function* () {
      yield scoped.ui.contribute({
        kind: 'route',
        id: ALBUM_ROUTES.album,
        path: '/album/:urn',
        title: 'Album',
        placement: [],
        order: 0,
      })
    }, 'album-ui-contributions'),
  )

  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
