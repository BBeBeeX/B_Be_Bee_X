/**
 * React Native views for `plugin-player`.
 *
 * The same hooks, the same view ids, the same behaviour — only the elements
 * and the *shape* differ. On mobile "now playing" is a full screen rather
 * than a bar, which is the platform difference ADR-2 accepts paying for.
 *
 * Layout and event wiring only. Anything here that would also be true on
 * desktop belongs in `plugin-player/hooks` (docs/08 1).
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
  Artwork,
  EmptyState,
  IconButton,
  List,
  Slider,
  Text,
  TrackRow,
  nativePrimitives,
} from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/** The full-screen player. */
export function NowPlayingScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)

  return h(
    native.View as never,
    {
      accessibilityLabel: 'Now playing',
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[5],
        padding: tokens.space[5],
        backgroundColor: p().bg.base,
      },
    },
    // Artwork first and large: on a phone this screen is mostly the artwork,
    // which is the one thing a bottom bar cannot do.
    h(Artwork, { size: 280, radius: tokens.radius.lg }),
    h(Text, { variant: 'xl', numberOfLines: 1, children: state.trackUrn ?? 'Nothing playing' }),
    state.status === 'stalled'
      ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' })
      : null,
    h(
      native.View as never,
      { style: { alignSelf: 'stretch', gap: tokens.space[1] } },
      h(Slider, {
        value: duration ? Math.min(position, duration) : position,
        max: duration ?? 0,
        disabled: !can.canSeek,
        accessibilityLabel: 'Seek',
        onCommit: (value: number) => void ctx.player.seek(value),
      }),
      h(
        native.View as never,
        { style: { flexDirection: 'row', justifyContent: 'space-between' } },
        h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(position) }),
        h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(duration) }),
      ),
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[4] } },
      h(IconButton, {
        icon: '⏮',
        accessibilityLabel: 'Previous track',
        disabled: !can.canPrevious,
        onPress: () => void ctx.player.previous(),
      }),
      h(IconButton, {
        // One control with two states, exactly as on desktop.
        icon: can.canPause ? '⏸' : '▶',
        accessibilityLabel: can.canPause ? 'Pause' : 'Play',
        variant: 'primary',
        size: tokens.size.iconLarge,
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
        track: { urn: item.trackUrn, title: item.trackUrn, artists: [] } as Track,
        active: item.id === state.currentItemId,
        // Same narrowing as desktop: there is no "jump to this queue item" on
        // PlayerService yet, and an affordance that quietly does something
        // else is worse than one that does less.
        onPress: () => void ctx.player.playNow([item.trackUrn]),
      }),
  })
}

export const name = 'plugin-player-ui-mobile'
export const inject = ['ui']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(PLAYER_VIEWS.nowPlaying, NowPlayingScreen)
    yield ctx.ui.registerView(PLAYER_VIEWS.queue, QueueScreen)
  }, 'player-ui-mobile')
}

export default { name, inject, apply }
