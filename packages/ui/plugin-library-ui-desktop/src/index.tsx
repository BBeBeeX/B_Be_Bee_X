/**
 * React DOM views for `@BBeBee/plugin-library`.
 *
 * Three screens, all fed by `@BBeBee/plugin-library/hooks`: the playlists
 * screen (with collections beneath it), one playlist's tracks, and the
 * favourites shelf. Layout and event wiring only — every derived value and
 * every reload rule lives in the headless package (docs/08 §1).
 *
 * The one rule worth stating: a **smart** playlist's tracks are read-only, so
 * its screen never draws a remove control. Offering one that throws is worse
 * than offering none, and "the rules own this list" is the sentence the user
 * needs anyway.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Collection, Playlist } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import {
  summariseLibrary,
  useCollections,
  usePlaylist,
  usePlaylists,
  useSaved,
} from '@BBeBee/plugin-library/hooks'
import { useTracksByUrn } from '@BBeBee/plugin-player/hooks'
import { Button, ContextMenu, EmptyState, IconButton, List, Text, TextField, TrackRow } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { useCollectionMenu, usePlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'
import type { MenuAnchor } from '@BBeBee/ui-core'

/* ── playlists ─────────────────────────────────────────────────────────── */

export function PlaylistsScreen({ ctx }: { ctx: Context }): ReactElement {
  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const [draft, setDraft] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const summary = summariseLibrary(playlists.data ?? [], collections.data ?? [], [])
  const playlistMenu = usePlaylistMenu(ctx)
  const collectionMenu = useCollectionMenu(ctx)

  const fail = (what: string) => (cause: unknown) =>
    setError(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)

  const createPlaylist = () => {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    setError(undefined)
    void ctx.library.createPlaylist(name).catch(fail('could not create the playlist'))
  }

  const createCollection = () => {
    const name = collectionDraft.trim()
    if (!name) return
    setCollectionDraft('')
    setError(undefined)
    void ctx.library.createCollection(name).catch(fail('could not create the collection'))
  }

  // The menu's list actions need the playlist's tracks, which the row does not
  // carry — resolve them before opening rather than showing actions that would
  // act on an empty list.
  const openPlaylistMenu = (playlist: Playlist, anchor?: MenuAnchor) => {
    void ctx.library
      .getPlaylist(playlist.urn)
      .then((detail) =>
        playlistMenu.open(playlist, detail?.items.map((item) => item.trackUrn) ?? [], anchor),
      )
      .catch(() => playlistMenu.open(playlist, [], anchor))
  }

  const openCollectionMenu = (collection: Collection, anchor?: MenuAnchor) => {
    void ctx.library
      .listCollectionItems(collection.id)
      .then((page) =>
        collectionMenu.open(
          collection.name,
          page.items
            .map((item) => item.urn)
            .filter((entryUrn) => tryParseUrn(entryUrn)?.kind === 'track'),
          anchor,
        ),
      )
      .catch(() => collectionMenu.open(collection.name, [], anchor))
  }

  return h(
    'section',
    {
      'aria-label': 'Playlists',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[5], padding: tokens.space[4] },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'baseline', gap: tokens.space[3] } },
      h(Text, { variant: 'xl' }, 'Playlists'),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        `${summary.playlists} playlists · ${summary.smart} smart · ${summary.collections} collections`,
      ),
      h(Button, {
        variant: 'secondary',
        onPress: () => ctx.ui.navigate(LIBRARY_VIEWS.favorites),
        children: 'Favourites',
      }),
    ),

    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2], maxWidth: 520 } },
      h(TextField, {
        value: draft,
        onChange: setDraft,
        placeholder: 'New playlist name',
        testID: 'playlists-new-name',
      }),
      h(Button, {
        onPress: createPlaylist,
        disabled: draft.trim().length === 0,
        testID: 'playlists-create',
        children: 'Create',
      }),
    ),
    error
      ? h(Text, { variant: 'sm', tone: 'error', testID: 'playlists-error' }, error)
      : null,

    playlists.status === 'error'
      ? h(Text, { tone: 'error' }, `Could not read playlists: ${playlists.error?.message}`)
      : null,

    playlists.status === 'ready' && playlists.data && playlists.data.length === 0
      ? h(EmptyState, {
          icon: '♪',
          title: 'No playlists yet',
          description: 'A playlist is yours and stays local. Smart playlists fill themselves from rules instead.',
        })
      : h(List<Playlist>, {
          testID: 'playlists-list',
          items: playlists.data ?? [],
          estimatedItemSize: tokens.size.row,
          keyExtractor: (playlist) => playlist.urn,
          empty: h(EmptyState, { title: 'No playlists yet' }),
          renderItem: (playlist) =>
            h(PlaylistRow, {
              playlist,
              onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: playlist.urn }),
              onDelete: () =>
                void ctx.library.deletePlaylist(playlist.urn).catch(fail('could not delete the playlist')),
              onMore: (anchor) => openPlaylistMenu(playlist, anchor),
            }),
        }),

    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2], marginTop: tokens.space[4] } },
      h(Text, { variant: 'lg' }, 'Collections'),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        'A collection is a shelf that can hold anything — tracks, albums, artists, playlists. Collections can nest.',
      ),
      h(
        'div',
        { style: { display: 'flex', gap: tokens.space[2], maxWidth: 520 } },
        h(TextField, {
          value: collectionDraft,
          onChange: setCollectionDraft,
          placeholder: 'New collection name',
          testID: 'collections-new-name',
        }),
        h(Button, {
          variant: 'secondary',
          onPress: createCollection,
          disabled: collectionDraft.trim().length === 0,
          testID: 'collections-create',
          children: 'Create',
        }),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' }, 'aria-label': 'Collections' },
        ...(collections.data ?? []).map((collection) =>
          h(CollectionRow, {
            key: collection.id,
            collection,
            onDelete: () =>
              void ctx.library.deleteCollection(collection.id).catch(fail('could not delete the collection')),
            onMore: (anchor) => openCollectionMenu(collection, anchor),
          }),
        ),
      ),
    ),
    h(ContextMenu, playlistMenu.menuProps),
    h(ContextMenu, collectionMenu.menuProps),
  )
}

function PlaylistRow({
  playlist,
  onOpen,
  onDelete,
  onMore,
}: {
  playlist: Playlist
  onOpen: () => void
  onDelete: () => void
  onMore: (anchor?: MenuAnchor) => void
}): ReactElement {
  return h(
    'div',
    {
      onContextMenu: (event: { preventDefault(): void; clientX?: number; clientY?: number }) => {
        event.preventDefault()
        onMore({ x: event.clientX ?? 0, y: event.clientY ?? 0 })
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.sm,
      },
    },
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, playlist.name),
      h(
        Text,
        { variant: 'sm', tone: 'muted', numberOfLines: 1 },
        playlist.isSmart
          ? 'Smart playlist'
          : `${playlist.trackCount ?? 0} tracks${playlist.description ? ` · ${playlist.description}` : ''}`,
      ),
    ),
    h(Button, { variant: 'ghost', onPress: onOpen, children: 'Open' }),
    h(IconButton, {
      icon: '⋯',
      accessibilityLabel: `More actions for ${playlist.name}`,
      variant: 'ghost',
      onPress: () => onMore(),
    }),
    h(IconButton, {
      icon: '🗑',
      accessibilityLabel: `Delete ${playlist.name}`,
      variant: 'ghost',
      onPress: onDelete,
    }),
  )
}

function CollectionRow({
  collection,
  onDelete,
  onMore,
}: {
  collection: Collection
  onDelete: () => void
  onMore: (anchor?: MenuAnchor) => void
}): ReactElement {
  return h(
    'div',
    {
      onContextMenu: (event: { preventDefault(): void; clientX?: number; clientY?: number }) => {
        event.preventDefault()
        onMore({ x: event.clientX ?? 0, y: event.clientY ?? 0 })
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
      },
    },
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, collection.name),
      h(Text, { variant: 'sm', tone: 'muted' }, `${collection.itemCount ?? 0} items`),
    ),
    h(IconButton, {
      icon: '⋯',
      accessibilityLabel: `More actions for ${collection.name}`,
      variant: 'ghost',
      onPress: () => onMore(),
    }),
    h(IconButton, {
      icon: '🗑',
      accessibilityLabel: `Delete ${collection.name}`,
      variant: 'ghost',
      onPress: onDelete,
    }),
  )
}

/* ── one playlist ──────────────────────────────────────────────────────── */

export function PlaylistDetailScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const state = usePlaylist(ctx, urn)
  const detail = state.data
  const urns = detail?.items.map((item) => item.trackUrn) ?? []
  const tracks = useTracksByUrn(ctx, urns)
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })

  const play = (trackUrn: string) => {
    if (!detail) return
    void ctx.player.playFromContext(trackUrn, urns, {
      context: { kind: 'playlist', urn: detail.urn, label: detail.name },
    })
  }

  if (!urn) return h(EmptyState, { title: 'No playlist chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the playlist', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  return h(
    'section',
    {
      'aria-label': detail.name,
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.name),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          detail.isSmart
            ? 'Smart playlist — its tracks come from its rules'
            : `${detail.trackCount ?? urns.length} tracks`,
        ),
      ),
      h(Button, {
        onPress: () => urns[0] && play(urns[0]),
        disabled: urns.length === 0,
        testID: 'playlist-play',
        children: 'Play',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'playlist-tracks',
        items: urns,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (trackUrn, index) => `${trackUrn}:${index}`,
        empty: h(EmptyState, {
          icon: '♪',
          title: 'Nothing here yet',
          description: detail.isSmart
            ? 'No track in the catalogue matches this playlist\'s rules right now.'
            : 'Add tracks from the library to fill this playlist.',
        }),
        renderItem: (trackUrn, index) => {
          const track = tracks.get(trackUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, trackUrn)
          const item = detail.items[index]!
          return h(
            'div',
            { style: { display: 'flex', alignItems: 'center' } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () => play(trackUrn),
                onMore: (anchor) => menu.open({ track, playlistItemId: item.id }, anchor),
              }),
            ),
            detail.isSmart
              ? null
              : h(IconButton, {
                  icon: '×',
                  accessibilityLabel: `Remove ${track.title} from ${detail.name}`,
                  variant: 'ghost',
                  onPress: () => {
                    setError(undefined)
                    void ctx.library.removeItems(detail.urn, [item.id]).catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    )
                  },
                }),
          )
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── favourites ────────────────────────────────────────────────────────── */

export function FavoritesScreen({ ctx }: { ctx: Context }): ReactElement {
  const saved = useSaved(ctx, 'track')
  const entries = saved.data ?? []
  const urns = entries.map((entry) => entry.urn)
  const tracks = useTracksByUrn(ctx, urns)
  const player = serviceOf<{ playFromContext(urn: string, contextUrns?: readonly string[]): Promise<void> }>(
    ctx,
    'player',
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx)

  return h(
    'section',
    {
      'aria-label': 'Favourites',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'baseline', gap: tokens.space[3] } },
      h(Text, { variant: 'xl' }, 'Favourites'),
      h(Text, { variant: 'sm', tone: 'muted' }, `${urns.length} saved`),
      h(Button, {
        variant: 'secondary',
        onPress: () => urns[0] && player?.playFromContext(urns[0], urns),
        disabled: urns.length === 0,
        children: 'Play all',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    saved.status === 'error'
      ? h(Text, { tone: 'error' }, `Could not read favourites: ${saved.error?.message}`)
      : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'favorites-list',
        items: urns,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (entryUrn) => entryUrn,
        empty: h(EmptyState, {
          icon: '♡',
          title: 'Nothing saved yet',
          description: 'Save a track from the library and it lands here.',
        }),
        renderItem: (entryUrn) => {
          const track = tracks.get(entryUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, entryUrn)
          return h(
            'div',
            { style: { display: 'flex', alignItems: 'center' } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () => player?.playFromContext(entryUrn, urns),
                onMore: (anchor) => menu.open({ track }, anchor),
              }),
            ),
            h(IconButton, {
              icon: '♥',
              accessibilityLabel: `Remove ${track.title} from favourites`,
              variant: 'primary',
              onPress: () => {
                setError(undefined)
                void ctx.library.setSaved(entryUrn, false).catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
              },
            }),
          )
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-library-ui-desktop'

export const inject = ['ui', 'library', 'player']

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
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LIBRARY_VIEWS.playlists, bound(ctx, PlaylistsScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.playlist, bound(ctx, PlaylistDetailScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.favorites, bound(ctx, FavoritesScreen))
  }, 'library-ui-desktop')
}

export default { name, inject, apply }
