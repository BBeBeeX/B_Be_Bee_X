/**
 * React DOM views for `plugin-player`.
 *
 * One screen: the up-next queue. The "what is playing" surfaces — the
 * persistent bar and the full-pane player — live in
 * `plugin-now-playing-ui-desktop`, because a transport service should not
 * have to change when a screen does (docs/08 §1).
 *
 * Layout, gestures and event wiring — nothing else. Every value comes from a
 * hook in the headless package, and if an `if` here also belongs in the mobile
 * view, it belongs in `plugin-player/hooks` instead.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { QueueItem } from '@BBeBee/protocol'
import { PLAYER_VIEWS } from '@BBeBee/plugin-player/views'
import { queueTrackFallback, useQueue, useTracksByUrn, useTransport } from '@BBeBee/plugin-player/hooks'
import { EmptyState, List, TrackRow } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'


/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

/** The up-next list. */
export function QueueScreen({ ctx }: { ctx: Context }): ReactElement {
  const queue = useQueue(ctx)
  const state = useTransport(ctx)
  // Cover, title and artist come from the catalogue read the list does for
  // itself. A row the read has not answered for yet — a write in flight, a
  // removed source — never shows the URN: the playing item borrows the
  // transport's metadata, the rest say they are loading.
  const tracks = useTracksByUrn(ctx, queue.map((item) => item.trackUrn))

  if (queue.length === 0) {
    return h(EmptyState, {
      icon: '🎵',
      title: 'Nothing queued',
      description: 'Play something from your library and it will show up here.',
    })
  }

  return h(List<QueueItem>, {
    items: queue,
    accessibilityLabel: 'Queue',
    estimatedItemSize: tokens.size.row,
    keyExtractor: (item) => item.id,
    renderItem: (item) =>
      h(CachedTrackRow, { ctx,
        track:
          tracks.get(item.trackUrn) ??
          queueTrackFallback(item, state.nowPlaying, item.id === state.currentItemId),
        active: item.id === state.currentItemId,
        // A row tap means "play that one", and the track is in the queue by
        // definition — so playFromContext jumps to it without touching the
        // queue the user already has.
        onPress: () => void ctx.player.playFromContext(item.trackUrn),
      }),
  })
}


export const name = 'plugin-player-ui-desktop'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.player` through its hooks threw
 * `cannot get property "player" without inject` on a device while every
 * test passed, because tests built a root context where that read answers
 * `undefined` instead.
 *
 * Registering a closure over the context this plugin was applied with is the
 * fix, and it is what every view package here does: the screen runs on a
 * context with exactly what this package's `inject` declares. The shell's
 * props are still forwarded, so a view that takes more than `ctx` keeps
 * working.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  // `h(Screen, …)`, not `Screen(…)`: calling a component as a function splices
  // its hooks into this one's list, which works right up until someone renders
  // it conditionally. An element keeps them separate.
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export const inject = ['ui', 'player', 'sources']

export async function apply(ctx: Context) {
  // Bind components to the ids the headless package contributed. A view
  // registered for an id nobody contributed is dead; a contribution with no
  // view renders a placeholder — both are normal, neither is an error.
  return ctx.effect(function* () {
    yield ctx.ui.registerView(PLAYER_VIEWS.queue, bound(ctx, QueueScreen))
  }, 'player-ui-desktop')
}

export default { name, inject, apply }
