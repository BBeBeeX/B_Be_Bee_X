/**
 * React Native views for `plugin-sources`.
 *
 * Same hooks, same view ids, same three-state handling as the desktop twin —
 * only the elements differ. A tab bar of two buttons rather than a tablist,
 * a single-column list rather than a grid, because a phone has one column.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, Track } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import { useAlbum, useAlbums, useTracks } from '@BBeBee/plugin-sources/hooks'
import {
  Artwork,
  Button,
  EmptyState,
  List,
  Text,
  TrackRow,
  nativePrimitives,
} from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

/** A failed read, said out loud — never a silently empty library. */
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
  const native = nativePrimitives()
  const [tab, setTab] = useState<'tracks' | 'albums'>('tracks')
  const tracks = useTracks(ctx, { sort: 'title' })
  const albums = useAlbums(ctx, { sort: 'title' })
  const active = tab === 'tracks' ? tracks : albums

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      {
        accessibilityRole: 'tablist',
        style: { flexDirection: 'row', gap: tokens.space[2], padding: tokens.space[3] },
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
          ? h(List<Track>, {
              items: tracks.items,
              accessibilityLabel: 'Tracks',
              estimatedItemSize: tokens.size.row,
              keyExtractor: (track) => track.urn,
              onEndReached: tracks.loadMore,
              empty: h(EmptyState, {
                icon: '📁',
                title: 'No music yet',
                description: 'Add a folder in Settings and it will appear here as it is scanned.',
              }),
              renderItem: (track) =>
                h(TrackRow, {
                  track,
                  showAlbum: true,
                  onPress: () => void ctx.player?.playNow([track.urn]),
                }),
            })
          : h(List<Album>, {
              items: albums.items,
              accessibilityLabel: 'Albums',
              estimatedItemSize: tokens.size.row,
              keyExtractor: (album) => album.urn,
              onEndReached: albums.loadMore,
              empty: h(EmptyState, { icon: '💿', title: 'No albums yet' }),
              renderItem: (album) =>
                h(
                  native.Pressable as never,
                  {
                    accessibilityRole: 'button',
                    accessibilityLabel: album.title,
                    onPress: () => onOpenAlbum?.(album.urn),
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: tokens.space[3],
                      padding: tokens.space[2],
                    },
                  },
                  h(Artwork, { artwork: album.artwork, size: tokens.size.artworkThumb }),
                  h(
                    native.View as never,
                    { style: { flex: 1, minWidth: 0 } },
                    h(Text, { numberOfLines: 1, children: album.title }),
                    album.year
                      ? h(Text, { variant: 'sm', tone: 'muted', children: String(album.year) })
                      : null,
                  ),
                ),
            }),
  )
}

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const native = nativePrimitives()
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
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      { style: { alignItems: 'center', gap: tokens.space[2], padding: tokens.space[4] } },
      h(Artwork, { artwork: detail.artwork, size: 200, radius: tokens.radius.md }),
      h(Text, { variant: 'xl', numberOfLines: 2, children: detail.title }),
      h(Text, {
        tone: 'muted',
        children: detail.artists?.map((a) => a.name).join(', ') ?? '',
      }),
      h(Button, {
        onPress: () => void ctx.player?.playNow(detail.tracks.map((t) => t.urn)),
        children: 'Play album',
        disabled: detail.tracks.length === 0,
      }),
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
          // Playing from an album plays the album from that point.
          onPress: () =>
            void ctx.player?.playNow(
              detail.tracks.map((t) => t.urn),
              { startIndex: index },
            ),
        }),
    }),
  )
}

export const name = 'plugin-sources-ui-mobile'
export const inject = ['ui']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.library, LibraryScreen)
    yield ctx.ui.registerView(SOURCES_VIEWS.album, AlbumScreen)
  }, 'sources-ui-mobile')
}

export default { name, inject, apply }
