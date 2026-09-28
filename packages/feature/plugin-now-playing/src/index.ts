/**
 * `plugin-now-playing` — the "what is playing" surfaces.
 *
 * A **surface** plugin: the full-screen player and the persistent bar that
 * opens it. Both were part of `plugin-player`, which made the transport
 * service also the owner of two screens — a plugin whose job is playback
 * should not have to change when a screen does.
 *
 * It provides the `ctx.nowPlaying` service for layout style preference
 * management (classic, full-cover, vinyl, compact). Transport state and the
 * queue belong to `ctx.player`.
 *
 * The queue screen is its own plugin (`plugin-queue`): up-next is a different
 * question from what is playing now, and the queue model is the player's.
 */

import { Service } from '@BBeBee/kernel'
import type { Context } from 'cordis'
import type { NowPlayingService, NowPlayingStyleId } from '@BBeBee/protocol'
import { DEFAULT_NOW_PLAYING_STYLE, NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { NOW_PLAYING_ROUTES } from './views.js'

const STORE_KEY = 'now-playing.style'

export class NowPlayingPlugin extends Service implements NowPlayingService {
  static override readonly name = 'nowPlaying'
  static readonly inject = []

  private currentStyle: NowPlayingStyleId = DEFAULT_NOW_PLAYING_STYLE
  private readonly validIds = new Set<string>(NOW_PLAYING_STYLES.map((s) => s.id))

  constructor(ctx: Context) {
    super(ctx, 'nowPlaying')

    // Restore persisted preference via store if available.
    this.ctx.inject(['store'], (scoped) => {
      void scoped.store.get<string>(STORE_KEY).then((storedId) => {
        if (storedId && this.validIds.has(storedId)) {
          this.currentStyle = storedId as NowPlayingStyleId
          this.ctx.emit('now-playing/style-changed', this.currentStyle)
        }
      }).catch(() => {})
    })
  }

  getStyle(): NowPlayingStyleId {
    return this.currentStyle
  }

  setStyle(id: NowPlayingStyleId): void {
    if (!this.validIds.has(id)) {
      this.ctx.logger.warn(`now-playing: unknown style "${id}"`)
      return
    }
    if (id === this.currentStyle) return
    this.currentStyle = id
    this.ctx.emit('now-playing/style-changed', id)

    // Persist to store if available
    const store = (this.ctx as unknown as { reflect?: { get(k: string, req: boolean): unknown } })
      .reflect?.get('store', false) as { set(k: string, v: unknown): Promise<void> } | undefined
    if (store) {
      store.set(STORE_KEY, id).catch((err) => {
        this.ctx.logger.warn(`now-playing: failed to persist style: ${err}`)
      })
    }
  }
}

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

  const serviceFiber = await ctx.plugin(NowPlayingPlugin)

  // The `ui` inject is a child fiber, so unloading this plugin unloads the
  // contribution with it. Not awaited: a build without `plugin-ui` is a build
  // with no contribution, not a plugin that never finishes loading.
  const uiFiber = ctx.inject(['ui'], (scoped) =>
    scoped.effect(function* () {
      scoped.logger.debug(`now-playing: contributing route ${NOW_PLAYING_ROUTES.nowPlaying}`)
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
    uiFiber.dispose()
    serviceFiber.dispose()
  }
}

export default { name, apply }
