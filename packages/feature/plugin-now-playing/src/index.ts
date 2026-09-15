/**
 * `plugin-now-playing` — the "what is playing" surfaces.
 *
 * A **surface** plugin: the full-screen player and the persistent bar that
 * opens it. Both were part of `plugin-player`, which made the transport
 * service also the owner of two screens — a plugin whose job is playback
 * should not have to change when a screen does.
 *
 * It claims no service key: transport state and the queue belong to
 * `ctx.player`, and the hooks that read them (`useTransport`, `usePosition`,
 * `useDuration`, `useTransportAvailability`) stay in `plugin-player` beside
 * the service they subscribe to. What lives here is the presentation
 * contract — the route the shells navigate to and the bar's view id — so the
 * two view packages cannot disagree about what the page is called.
 *
 * The queue screen stayed in `plugin-player-ui-*`: up-next is a different
 * question from what is playing now, and the queue model is the player's.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { NOW_PLAYING_ROUTES } from './views.js'

export const name = 'plugin-now-playing'

/**
 * The page's route descriptor.
 *
 * `placement: ['tab-bar']` is unchanged from when the player contributed it:
 * on mobile the full-screen player is a tab, and on desktop it is reached by
 * opening the bar — a tab for a screen the bar already reaches would be a
 * second door to the same room.
 */
export async function apply(ctx: Context) {
  ctx.logger.info('plugin-now-playing: loaded')

  // The `ui` inject is a child fiber, so unloading this plugin unloads the
  // contribution with it. Not awaited: a build without `plugin-ui` is a build
  // with no contribution, not a plugin that never finishes loading.
  const fiber = ctx.inject(['ui'], (scoped) =>
    scoped.effect(function* () {
      yield scoped.ui.contribute({
        kind: 'route',
        id: NOW_PLAYING_ROUTES.nowPlaying,
        path: '/now-playing',
        title: 'Now playing',
        icon: 'play',
        placement: ['tab-bar'],
        order: 10,
      })
    }, 'now-playing-ui-contributions'),
  )

  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
