/**
 * React DOM views for `plugin-player`.
 *
 * Layout, gestures and event wiring — nothing else. Every value comes from a
 * hook in the headless package, and if an `if` here also belongs in the mobile
 * view, it belongs in `plugin-player/hooks` instead (docs/08 1).
 *
 * On desktop the "now playing" surface is a persistent bottom bar rather than
 * a screen: that difference is genuinely platform-shaped, which is why ADR-2
 * accepts writing the view twice.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { QueueItem, Track } from '@BBeBee/protocol'
import { PLAYER_VIEWS } from '@BBeBee/plugin-player/views'
import {
  formatDuration,
  usePosition,
  useDuration,
  useQueue,
  useTransport,
  useTransportAvailability,
} from '@BBeBee/plugin-player/hooks'
import {
  EmptyState,
  IconButton,
  List,
  Slider,
  Text,
  TrackRow,
} from '@BBeBee/ui-kit-desktop'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/** The persistent transport bar. Desktop's answer to "now playing". */
export function NowPlayingBar({ ctx }: { ctx: Context }): ReactElement {
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)

  return h(
    'div',
    {
      role: 'region',
      'aria-label': 'Now playing',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[4],
        padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
        borderTop: `1px solid ${p().border.subtle}`,
        background: p().bg.raised,
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
      h(IconButton, {
        icon: '⏮',
        accessibilityLabel: 'Previous track',
        disabled: !can.canPrevious,
        onPress: () => void ctx.player.previous(),
      }),
      h(IconButton, {
        // One control, two states: a play button that is sometimes a pause
        // button is what every player has, and two controls would be wrong.
        icon: can.canPause ? '⏸' : '▶',
        accessibilityLabel: can.canPause ? 'Pause' : 'Play',
        variant: 'primary',
        disabled: !can.canPlay && !can.canPause,
        onPress: () => ctx.player.togglePlay(),
      }),
      h(IconButton, {
        icon: '⏭',
        accessibilityLabel: 'Next track',
        disabled: !can.canNext,
        onPress: () => void ctx.player.next(),
      }),
    ),
    h(
      'div',
      { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      // `stalled` is not `paused`: the UI says buffering and the lock screen
      // keeps reporting playing, so neither flickers on an underrun.
      state.status === 'stalled'
        ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' })
        : null,
      h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(position) }),
      h(Slider, {
        value: duration ? Math.min(position, duration) : position,
        max: duration ?? 0,
        disabled: !can.canSeek,
        accessibilityLabel: 'Seek',
        onCommit: (value: number) => void ctx.player.seek(value),
      }),
      h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(duration) }),
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
      h(IconButton, {
        icon: state.muted ? '🔇' : '🔊',
        accessibilityLabel: state.muted ? 'Unmute' : 'Mute',
        onPress: () => ctx.player.setMuted(!state.muted),
      }),
      h(Slider, {
        value: Math.round(state.volume * 100),
        max: 100,
        accessibilityLabel: 'Volume',
        onCommit: (value: number) => ctx.player.setVolume(value / 100),
      }),
    ),
  )
}

/** The up-next list. */
export function QueueScreen({ ctx }: { ctx: Context }): ReactElement {
  const queue = useQueue(ctx)
  const state = useTransport(ctx)

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
      h(TrackRow, {
        // The queue holds URNs, not tracks; the title arrives with the
        // catalogue read the row does for itself in a later milestone.
        track: { urn: item.trackUrn, title: item.trackUrn, artists: [] } as Track,
        active: item.id === state.currentItemId,
        // `PlayerService` has no "jump to this queue item" today, so the row
        // plays its track rather than pretending to reposition the queue —
        // an affordance that silently does the wrong thing is worse than a
        // narrower one that does the right thing.
        onPress: () => void ctx.player.playNow([item.trackUrn]),
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
 * Registering a closure over the context this plugin was applied with is what
 * `plugin-hello-ui-mobile` has always done, and it is the fix: the screen runs
 * on a context with exactly what this package's `inject` declares. The shell's
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

export const inject = ['ui', 'player']

export async function apply(ctx: Context) {
  // Bind components to the ids the headless package contributed. A view
  // registered for an id nobody contributed is dead; a contribution with no
  // view renders a placeholder — both are normal, neither is an error.
  return ctx.effect(function* () {
    yield ctx.ui.registerView(PLAYER_VIEWS.nowPlaying, bound(ctx, NowPlayingBar))
    yield ctx.ui.registerView(PLAYER_VIEWS.queue, bound(ctx, QueueScreen))
  }, 'player-ui-desktop')
}

export default { name, inject, apply }
