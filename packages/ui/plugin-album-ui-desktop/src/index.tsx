/**
 * React DOM views for `@BBeBee/plugin-album`.
 *
 * One screen: the album header with its cover and "Play album", then the
 * track list. Every value comes from `@BBeBee/plugin-album/hooks` and
 * `ctx.sources`; this file is layout, gestures and event wiring only
 * (docs/08 §1).
 *
 * Playback semantics, which are the part worth stating:
 *
 *  - **"Play album"** is `playNow(urns)` — the explicit from-the-top gesture,
 *    and it replaces the queue outright. Disabled, not hidden, when the album
 *    has no playable tracks: an empty album is a real state, and hiding the
 *    control hides the reason.
 *  - **Tapping a row** is `playFromContext(track, albumUrns)`: jump if the
 *    queue already holds it, otherwise the whole album becomes the queue
 *    starting here. Playback never navigates; the transport bar announces it.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DownloadsService, PlayerService, Track } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { useAlbum } from '@BBeBee/plugin-album/hooks'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { Artwork, Button, ContextMenu, EmptyState, List, Text, TrackRow } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import type { ArtworkProps, TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 *
 * A component rather than a bare hook call at the call site because the album
 * header is not a list row: the hook suppresses the remote URL while the cache
 * fetches, so the fallback paints instead of a second request.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

/** What a screen shows while it does not yet have an answer. */
function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const album = useAlbum(ctx, urn)
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const menu = useTrackMenu(ctx)

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: 'Loading album…' })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: '⚠',
      title: 'Album unavailable',
      description: album.error?.message,
    })
  }

  const detail = album.data
  const urns = detail.tracks.map((track) => track.urn)
  const player = serviceOf<PlayerService>(ctx, 'player')

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h(
      'header',
      {
        style: {
          display: 'flex',
          gap: tokens.space[4],
          padding: tokens.space[4],
          alignItems: 'flex-end',
        },
      },
      h(CachedArtwork, { ctx, artwork: detail.artwork, seed: detail.urn, size: 160, radius: tokens.radius.md }),
      h(
        'div',
        null,
        h(Text, { variant: 'xl', children: detail.title }),
        h(Text, {
          tone: 'muted',
          children: detail.artists?.map((a) => a.name).join(', ') ?? '',
        }),
        h(Button, {
          // Playback announces itself in the transport bar; no navigation.
          onPress: () => void player?.playNow(urns),
          children: 'Play album',
          // Disabled rather than absent: an album with no playable tracks is
          // a real state, and hiding the control hides the reason.
          disabled: detail.tracks.length === 0,
        }),
      ),
    ),
    h(List<Track>, {
      items: detail.tracks,
      accessibilityLabel: `Tracks on ${detail.title}`,
      estimatedItemSize: tokens.size.row,
      keyExtractor: (track) => track.urn,
      empty: h(EmptyState, { title: 'This album has no tracks' }),
      renderItem: (track) =>
        h(CachedTrackRow, {
          ctx,
          track,
          showArtwork: false,
          // A tap plays the track in the list it was tapped in: jump if the
          // queue already holds it, otherwise the whole album becomes the
          // queue, starting here.
          onPress: () => {
            void player?.playFromContext(track.urn, urns, {
              context: { kind: 'album', urn: detail.urn, label: detail.title },
            })
          },
          onDownload: downloads ? () => void downloads.enqueue([track.urn]) : undefined,
          onMore: (anchor) => menu.open({ track }, anchor),
        }),
    }),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-album-ui-desktop'

/**
 * `sources` is required (the album read goes through it); `player` and
 * `downloads` are read with `serviceOf`, so a build without either draws the
 * screen without the control that would call it.
 */
export const inject = ['ui', 'sources']

/**
 * Register a component bound to **this** context, not the shell's.
 *
 * The shell renders views with the context it was mounted on, and a Cordis
 * context throws for any property outside its inject list; every view package
 * closes over its own plugin context for exactly this reason (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-album-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(ALBUM_VIEWS.album, bound(ctx, AlbumScreen))
  }, 'album-ui-desktop')
}

export default { name, inject, apply }
