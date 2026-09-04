/**
 * React DOM views for `plugin-sources`.
 *
 * Library and album detail. Every value comes from a hook in the headless
 * package — `useTracks`, `useAlbums`, `useAlbum` — and this file is layout,
 * gestures and event wiring only (docs/08 1).
 *
 * The one thing worth doing carefully here is the *three* states a catalogue
 * read has. A screen that treats loading, empty and failed the same shows a
 * blank pane and tells the user nothing about which one they are looking at.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, Track } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import { useAlbum, useAlbums, useTracks } from '@BBeBee/plugin-sources/hooks'
import { Artwork, Button, EmptyState, List, Text, TrackRow } from '@BBeBee/ui-kit-desktop'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/** What a screen shows while it does not yet have an answer. */
function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

/**
 * A failed read, said out loud.
 *
 * Never silently empty: "your library is empty" and "the catalogue could not
 * be read" look identical to a user, and only one of them is their problem.
 */
function Failed({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  return h(EmptyState, {
    icon: '⚠',
    title: 'Could not read the library',
    description: error.message,
    action: h(Button, { onPress: onRetry, variant: 'secondary', children: 'Try again' }),
  })
}

export function LibraryScreen({
  ctx,
  onOpenAlbum,
}: {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const [tab, setTab] = useState<'tracks' | 'albums'>('tracks')
  const tracks = useTracks(ctx, { sort: 'title' })
  const albums = useAlbums(ctx, { sort: 'title' })
  const active = tab === 'tracks' ? tracks : albums

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h(
      'div',
      {
        role: 'tablist',
        'aria-label': 'Library',
        style: { display: 'flex', gap: tokens.space[2], padding: tokens.space[3] },
      },
      (['tracks', 'albums'] as const).map((id) =>
        h(Button, {
          key: id,
          variant: tab === id ? 'primary' : 'ghost',
          onPress: () => setTab(id),
          accessibilityLabel: `Show ${id}`,
          children: id === 'tracks' ? 'Tracks' : 'Albums',
        }),
      ),
    ),
    active.status === 'error' && active.error
      ? h(Failed, { error: active.error, onRetry: active.reload })
      : active.status === 'loading' && active.items.length === 0
        ? h(Pending, { label: 'Loading your library…' })
        : tab === 'tracks'
          ? h(TrackList, { ctx, tracks: tracks.items, onEndReached: tracks.loadMore })
          : h(AlbumGrid, { albums: albums.items, onOpenAlbum, onEndReached: albums.loadMore }),
  )
}

function TrackList({
  ctx,
  tracks,
  onEndReached,
}: {
  ctx: Context
  tracks: readonly Track[]
  onEndReached: () => void
}): ReactElement {
  return h(List<Track>, {
    items: tracks,
    accessibilityLabel: 'Tracks',
    estimatedItemSize: tokens.size.row,
    keyExtractor: (track) => track.urn,
    onEndReached,
    empty: h(EmptyState, {
      icon: '📁',
      title: 'No music yet',
      description: 'Add a folder in Settings and it will appear here as it is scanned.',
    }),
    renderItem: (track) =>
      h(TrackRow, {
        track,
        showAlbum: true,
        // Playing one track queues just that track; queueing the whole list
        // is a decision for the album screen, where "the rest" has a meaning.
        onPress: () => void ctx.player?.playNow([track.urn]),
      }),
  })
}

function AlbumGrid({
  albums,
  onOpenAlbum,
  onEndReached,
}: {
  albums: readonly Album[]
  onOpenAlbum?: (urn: string) => void
  onEndReached: () => void
}): ReactElement {
  return h(List<Album>, {
    items: albums,
    accessibilityLabel: 'Albums',
    estimatedItemSize: 220,
    keyExtractor: (album) => album.urn,
    onEndReached,
    empty: h(EmptyState, { icon: '💿', title: 'No albums yet' }),
    renderItem: (album) =>
      h(
        'button',
        {
          type: 'button',
          onClick: () => onOpenAlbum?.(album.urn),
          'aria-label': album.title,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
            width: '100%',
            padding: tokens.space[2],
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: p().text.primary,
          },
        },
        h(Artwork, { artwork: album.artwork, size: tokens.size.artworkThumb }),
        h(
          'span',
          { style: { textAlign: 'left', minWidth: 0 } },
          h(Text, { numberOfLines: 1, children: album.title }),
          album.year
            ? h(Text, { variant: 'sm', tone: 'muted', children: String(album.year) })
            : null,
        ),
      ),
  })
}

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const album = useAlbum(ctx, urn)

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
      h(Artwork, { artwork: detail.artwork, size: 160, radius: tokens.radius.md }),
      h(
        'div',
        null,
        h(Text, { variant: 'xl', children: detail.title }),
        h(Text, {
          tone: 'muted',
          children: detail.artists?.map((a) => a.name).join(', ') ?? '',
        }),
        h(Button, {
          onPress: () => void ctx.player?.playNow(detail.tracks.map((t) => t.urn)),
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
      renderItem: (track, index) =>
        h(TrackRow, {
          track,
          showArtwork: false,
          // Playing from an album plays the album from that point, which is
          // what "play this track" means in an album context.
          onPress: () =>
            void ctx.player?.playNow(
              detail.tracks.map((t) => t.urn),
              { startIndex: index },
            ),
        }),
    }),
  )
}

export const name = 'plugin-sources-ui-desktop'
export const inject = ['ui']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.library, LibraryScreen)
    yield ctx.ui.registerView(SOURCES_VIEWS.album, AlbumScreen)
  }, 'sources-ui-desktop')
}

export default { name, inject, apply }
