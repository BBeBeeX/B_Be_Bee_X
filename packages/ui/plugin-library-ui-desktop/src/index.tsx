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

import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  AlbumDetail,
  ArtworkRef,
  Collection,
  DownloadsService,
  PlayerService,
  Playlist,
  Track,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import {
  summariseLibrary,
  useCollectionDetail,
  useCollections,
  usePlaylist,
  usePlaylists,
  useSaved,
  type CollectionMember,
} from '@BBeBee/plugin-library/hooks'
import { useTracksByUrn } from '@BBeBee/plugin-player/hooks'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import type { ArtworkProps, MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { Artwork, Button, ContextMenu, EmptyState, IconButton, List, Text, TextField, TrackRow } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { useAddToCollection, useCollectionMenu, usePlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'

/* ── the library ───────────────────────────────────────────────────────── */

/** `<Artwork>`, with the cover resolved through `ctx.cache` first. */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

interface UnifiedItem {
  id: string
  urn?: string
  kind: 'playlist' | 'album' | 'collection' | 'favorite' | 'local'
  title: string
  subtitle: string
  artwork?: ArtworkRef
  artworkSeed: string
  pinned: boolean
  addedAt: number
  lastPlayedAt?: number
  isDownloaded?: boolean
  onOpen: () => void
  onPlay: () => void
  onDelete?: () => void
  onMore: (anchor?: MenuAnchor) => void
}

function UnifiedLibraryRow({
  ctx,
  item,
}: {
  ctx: Context
  item: UnifiedItem
}): ReactElement {
  const [isHovered, setIsHovered] = useState(false)

  return h(
    'div',
    {
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      onClick: () => item.onOpen(),
      onContextMenu: (event: { preventDefault(): void; clientX?: number; clientY?: number }) => {
        event.preventDefault()
        item.onMore({ x: event.clientX ?? 0, y: event.clientY ?? 0 })
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.sm,
        cursor: 'pointer',
        backgroundColor: isHovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        transition: 'background-color 150ms ease',
      },
    },
    h(
      'div',
      {
        style: {
          position: 'relative',
          width: tokens.size.artworkThumb,
          height: tokens.size.artworkThumb,
          borderRadius: tokens.radius.sm,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
        },
      },
      item.artwork
        ? h(CachedArtwork, {
            ctx,
            artwork: item.artwork,
            seed: item.artworkSeed,
            size: tokens.size.artworkThumb,
            radius: tokens.radius.sm,
          })
        : h(
            'span',
            { style: { fontSize: 18, color: '#A0A0A0' } },
            item.kind === 'favorite' ? '♥' : item.kind === 'local' ? '📁' : item.kind === 'album' ? '💿' : item.kind === 'playlist' ? '♪' : '🗂',
          ),
      isHovered
        ? h(
            'div',
            {
              onClick: (e: { stopPropagation(): void }) => {
                e.stopPropagation()
                item.onPlay()
              },
              title: `播放 ${item.title}`,
              style: {
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              },
            },
            h('span', { style: { color: '#ffffff', fontSize: 14, marginLeft: 2 } }, '▶'),
          )
        : null,
    ),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[1] } },
        item.pinned ? h('span', { title: '已置顶', style: { fontSize: 13, marginRight: 2 } }, '📌') : null,
        h(Text, { numberOfLines: 1 }, item.title),
      ),
      h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, item.subtitle),
    ),
    h(
      'div',
      {
        onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
        style: {
          opacity: isHovered ? 1 : 0,
          pointerEvents: isHovered ? 'auto' : 'none',
          transition: 'opacity 150ms ease',
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[1],
        },
      },
      h(IconButton, {
        icon: '⋯',
        accessibilityLabel: `更多操作 ${item.title}`,
        variant: 'ghost',
        onPress: () => item.onMore(),
      }),
      item.onDelete
        ? h(IconButton, {
            icon: '🗑',
            accessibilityLabel: `Delete ${item.title}`,
            variant: 'ghost',
            onPress: () => item.onDelete?.(),
          })
        : null,
    ),
  )
}

export function LibraryScreen({ ctx }: { ctx: Context }): ReactElement {
  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const savedAlbumEntries = useSaved(ctx, 'album')
  const savedTrackEntries = useSaved(ctx, 'track')
  const allSaved = useSaved(ctx)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')

  const [historyRecords, setHistoryRecords] = useState<readonly { trackUrn: string; playedAt: number }[]>([])
  const [localTracks, setLocalTracks] = useState<readonly Track[]>([])
  const [albumsMap, setAlbumsMap] = useState<Map<string, AlbumDetail>>(new Map())
  const [playlistFirstTrackArtworks, setPlaylistFirstTrackArtworks] = useState<Map<string, ArtworkRef>>(new Map())
  const [collectionFirstArtworks, setCollectionFirstArtworks] = useState<Map<string, ArtworkRef>>(new Map())
  const [favoriteArtwork, setFavoriteArtwork] = useState<ArtworkRef | undefined>(undefined)
  const [pinnedExtraIds, setPinnedExtraIds] = useState<Set<string>>(new Set())

  const [activeFilter, setActiveFilter] = useState<'all' | 'playlist' | 'album' | 'collection' | 'downloaded'>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<'recent-added' | 'recent-played' | 'alphabetical'>('recent-added')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | undefined>(undefined)

  const [draft, setDraft] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  const [simpleMenu, setSimpleMenu] = useState<{
    title: string
    items: MenuItemSpec[]
    anchor: MenuAnchor
  } | undefined>(undefined)

  const playlistMenu = usePlaylistMenu(ctx)
  const collectionMenu = useCollectionMenu(ctx)
  const albumMenu = useAddToCollection(ctx)

  const fail = (what: string) => (cause: unknown) =>
    setError(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)

  useEffect(() => {
    const offChanged = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    const offCollections = ctx.on('library/collections-changed', () => setGeneration((n) => n + 1))
    return () => {
      offChanged()
      offCollections()
    }
  }, [ctx])

  // Load history records if supported
  useEffect(() => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    if (!p?.getHistory) return
    let cancelled = false
    p.getHistory({ limit: 100 })
      .then((records) => {
        if (!cancelled) {
          setHistoryRecords(
            records.map((r) => ({
              trackUrn: r.trackUrn,
              playedAt: r.endedAt ?? r.startedAt,
            })),
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  // Load local tracks
  useEffect(() => {
    let cancelled = false
    if (!ctx.sources?.listTracks) return
    ctx.sources
      .listTracks({ sourceIds: ['local'] })
      .then((res) => {
        if (!cancelled) setLocalTracks(res.items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  // Hydrate saved albums
  useEffect(() => {
    const urns = savedAlbumEntries.data?.map((e) => e.urn) ?? []
    if (urns.length === 0) {
      setAlbumsMap((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    let cancelled = false
    Promise.all(urns.map((urn) => ctx.sources?.getAlbum(urn).catch(() => undefined)))
      .then((results) => {
        if (cancelled) return
        const map = new Map<string, AlbumDetail>()
        for (const res of results) {
          if (res) map.set(res.urn, res)
        }
        setAlbumsMap(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, savedAlbumEntries.data, generation])

  // Load first track cover for playlists
  useEffect(() => {
    const list = playlists.data ?? []
    let cancelled = false
    const toFetch = list.filter((p) => !p.artwork)
    if (toFetch.length === 0) return
    Promise.all(
      toFetch.map(async (p) => {
        try {
          const detail = await ctx.library.getPlaylist(p.urn)
          const firstUrn = detail?.items[0]?.trackUrn
          if (!firstUrn) return null
          const tracks = await ctx.sources.getTracks([firstUrn])
          if (tracks[0]?.artwork) return { urn: p.urn, artwork: tracks[0].artwork }
          return null
        } catch {
          return null
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setPlaylistFirstTrackArtworks((prev) => {
          let hasChange = false
          for (const res of results) {
            if (res && (!prev.has(res.urn) || prev.get(res.urn) !== res.artwork)) {
              hasChange = true
              break
            }
          }
          if (!hasChange) return prev
          const next = new Map(prev)
          for (const res of results) {
            if (res) next.set(res.urn, res.artwork)
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, playlists.data, generation])

  // Load first track cover for collections
  useEffect(() => {
    const list = collections.data ?? []
    let cancelled = false
    if (list.length === 0) return
    Promise.all(
      list.map(async (c) => {
        try {
          const items = await ctx.library.listCollectionItems(c.id)
          const firstTrack = items.items.find((it) => tryParseUrn(it.urn)?.kind === 'track')
          if (!firstTrack) {
            const firstAlbum = items.items.find((it) => tryParseUrn(it.urn)?.kind === 'album')
            if (firstAlbum) {
              const album = await ctx.sources.getAlbum(firstAlbum.urn)
              if (album?.artwork) return { id: c.id, artwork: album.artwork }
            }
            return null
          }
          const tracks = await ctx.sources.getTracks([firstTrack.urn])
          if (tracks[0]?.artwork) return { id: c.id, artwork: tracks[0].artwork }
          return null
        } catch {
          return null
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setCollectionFirstArtworks((prev) => {
          let hasChange = false
          for (const res of results) {
            if (res && (!prev.has(res.id) || prev.get(res.id) !== res.artwork)) {
              hasChange = true
              break
            }
          }
          if (!hasChange) return prev
          const next = new Map(prev)
          for (const res of results) {
            if (res) next.set(res.id, res.artwork)
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, collections.data, generation])

  // First favorite track cover
  useEffect(() => {
    const firstUrn = savedTrackEntries.data?.[0]?.urn
    if (!firstUrn) {
      setFavoriteArtwork(undefined)
      return
    }
    let cancelled = false
    ctx.sources
      ?.getTracks([firstUrn])
      .then((tracks) => {
        if (!cancelled && tracks[0]?.artwork) setFavoriteArtwork(tracks[0].artwork)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, savedTrackEntries.data])

  const pinnedUrns = useMemo(() => {
    return new Set(allSaved.data?.filter((e) => e.pinned).map((e) => e.urn) ?? [])
  }, [allSaved.data])

  const isItemPinned = useCallback(
    (item: { id?: string; urn?: string }) => {
      if (item.urn) return pinnedUrns.has(item.urn)
      return item.id ? pinnedExtraIds.has(item.id) : false
    },
    [pinnedUrns, pinnedExtraIds],
  )

  const togglePin = useCallback(
    async (item: { id?: string; urn?: string }) => {
      try {
        if (item.urn) {
          const currentlyPinned = pinnedUrns.has(item.urn)
          if (!currentlyPinned) {
            const isSaved = await ctx.library.isSaved(item.urn)
            if (!isSaved) await ctx.library.setSaved(item.urn, true)
            await ctx.library.setPinned(item.urn, true)
          } else {
            await ctx.library.setPinned(item.urn, false)
          }
        } else if (item.id) {
          setPinnedExtraIds((prev) => {
            const next = new Set(prev)
            if (next.has(item.id!)) next.delete(item.id!)
            else next.add(item.id!)
            return next
          })
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [ctx, pinnedUrns],
  )

  const playPlaylist = useCallback(
    (urn: string, name: string) => {
      void ctx.library
        .getPlaylist(urn)
        .then((detail) => {
          const urns = detail?.items.map((i) => i.trackUrn) ?? []
          if (urns[0]) {
            void ctx.player.playFromContext(urns[0], urns, {
              context: { kind: 'playlist', urn, label: name },
            })
          }
        })
        .catch(fail('could not play playlist'))
    },
    [ctx],
  )

  const playAlbum = useCallback(
    (urn: string, title: string) => {
      const album = albumsMap.get(urn)
      const urns = album?.tracks?.map((t) => t.urn) ?? []
      if (urns[0]) {
        void ctx.player.playFromContext(urns[0], urns, {
          context: { kind: 'album', urn, label: title },
        })
      } else {
        void ctx.sources
          .getAlbum(urn)
          .then((detail) => {
            const trackUrns = detail?.tracks?.map((t) => t.urn) ?? []
            if (trackUrns[0]) {
              void ctx.player.playFromContext(trackUrns[0], trackUrns, {
                context: { kind: 'album', urn, label: title },
              })
            }
          })
          .catch(fail('could not play album'))
      }
    },
    [ctx, albumsMap],
  )

  const playCollection = useCallback(
    (id: string) => {
      void ctx.library
        .listCollectionItems(id)
        .then((page) => {
          const trackUrns = page.items
            .filter((i) => tryParseUrn(i.urn)?.kind === 'track')
            .map((i) => i.urn)
          if (trackUrns[0]) void player?.playNow(trackUrns)
        })
        .catch(fail('could not play collection'))
    },
    [ctx, player],
  )

  const openPlaylistMenu = useCallback(
    (playlist: Playlist, anchor?: MenuAnchor, isPinned?: boolean) => {
      void ctx.library
        .getPlaylist(playlist.urn)
        .then((detail) =>
          playlistMenu.open(
            playlist,
            detail?.items.map((item) => item.trackUrn) ?? [],
            anchor,
            { pinned: isPinned, onTogglePin: () => void togglePin(playlist) },
          ),
        )
        .catch(() =>
          playlistMenu.open(playlist, [], anchor, {
            pinned: isPinned,
            onTogglePin: () => void togglePin(playlist),
          }),
        )
    },
    [ctx, playlistMenu, togglePin],
  )

  const openCollectionMenu = useCallback(
    (collection: Collection, anchor?: MenuAnchor, isPinned?: boolean) => {
      void ctx.library
        .listCollectionItems(collection.id)
        .then((page) =>
          collectionMenu.open(
            collection.name,
            page.items
              .map((item) => item.urn)
              .filter((entryUrn) => tryParseUrn(entryUrn)?.kind === 'track'),
            anchor,
            { pinned: isPinned, onTogglePin: () => void togglePin({ id: collection.id }) },
          ),
        )
        .catch(() =>
          collectionMenu.open(collection.name, [], anchor, {
            pinned: isPinned,
            onTogglePin: () => void togglePin({ id: collection.id }),
          }),
        )
    },
    [ctx, collectionMenu, togglePin],
  )

  const openAlbumMenu = useCallback(
    (album: { urn: string; title: string }, anchor?: MenuAnchor, isPinned?: boolean) => {
      albumMenu.open(album.title, [album.urn], anchor, {
        pinned: isPinned,
        onTogglePin: () => void togglePin({ id: album.urn, urn: album.urn }),
      })
    },
    [albumMenu, togglePin],
  )

  const openBuiltinMenu = useCallback(
    (
      title: string,
      onPlay: () => void,
      isPinned: boolean,
      item: { id: string },
      anchor?: MenuAnchor,
    ) => {
      setSimpleMenu({
        title,
        anchor: anchor ?? { x: 300, y: 300 },
        items: [
          {
            id: 'play-all',
            label: '播放全部',
            icon: '▶',
            onSelect: onPlay,
          },
          {
            id: 'toggle-pin',
            label: isPinned ? '取消置顶歌单' : '置顶歌单',
            icon: '📌',
            onSelect: () => void togglePin(item),
          },
        ],
      })
    },
    [togglePin],
  )

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

  const historyMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const rec of historyRecords) {
      if (!map.has(rec.trackUrn) || rec.playedAt > map.get(rec.trackUrn)!) {
        map.set(rec.trackUrn, rec.playedAt)
      }
    }
    return map
  }, [historyRecords])

  const favoriteUrns = useMemo(() => savedTrackEntries.data?.map((e) => e.urn) ?? [], [savedTrackEntries.data])
  const localUrns = useMemo(() => localTracks.map((t) => t.urn), [localTracks])

  const favoriteItem: UnifiedItem = useMemo(() => {
    const isPinned = isItemPinned({ id: 'builtin:favorite' })
    const lastPlayedAt = favoriteUrns.length > 0 ? Math.max(0, ...favoriteUrns.map((u) => historyMap.get(u) ?? 0)) : 0
    return {
      id: 'builtin:favorite',
      kind: 'favorite',
      title: '最喜欢的音乐',
      subtitle: `${favoriteUrns.length} 首歌曲`,
      artwork: favoriteArtwork,
      artworkSeed: 'favorite',
      pinned: isPinned,
      addedAt: savedTrackEntries.data?.[0]?.addedAt ?? 0,
      lastPlayedAt,
      isDownloaded: false,
      onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.favorites),
      onPlay: () => {
        if (favoriteUrns[0]) void player?.playFromContext(favoriteUrns[0], favoriteUrns)
      },
      onMore: (anchor) =>
        openBuiltinMenu(
          '最喜欢的音乐',
          () => {
            if (favoriteUrns[0]) void player?.playFromContext(favoriteUrns[0], favoriteUrns)
          },
          isPinned,
          { id: 'builtin:favorite' },
          anchor,
        ),
    }
  }, [ctx, favoriteArtwork, favoriteUrns, historyMap, isItemPinned, openBuiltinMenu, player, savedTrackEntries.data])

  const localItem: UnifiedItem = useMemo(() => {
    const isPinned = isItemPinned({ id: 'builtin:local' })
    const lastPlayedAt = localUrns.length > 0 ? Math.max(0, ...localUrns.map((u) => historyMap.get(u) ?? 0)) : 0
    return {
      id: 'builtin:local',
      kind: 'local',
      title: '本地音乐',
      subtitle: `${localTracks.length} 首歌曲`,
      artwork: localTracks[0]?.artwork,
      artworkSeed: 'local',
      pinned: isPinned,
      addedAt: 0,
      lastPlayedAt,
      isDownloaded: true,
      onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.local),
      onPlay: () => {
        if (localUrns[0]) void player?.playNow(localUrns)
      },
      onMore: (anchor) =>
        openBuiltinMenu(
          '本地音乐',
          () => {
            if (localUrns[0]) void player?.playNow(localUrns)
          },
          isPinned,
          { id: 'builtin:local' },
          anchor,
        ),
    }
  }, [ctx, isItemPinned, localTracks, localUrns, historyMap, openBuiltinMenu, player])

  const playlistItems: UnifiedItem[] = useMemo(() => {
    return (playlists.data ?? []).map((playlist) => {
      const isPinned = isItemPinned({ id: playlist.urn, urn: playlist.urn })
      return {
        id: playlist.urn,
        urn: playlist.urn,
        kind: 'playlist',
        title: playlist.name,
        subtitle: playlist.isSmart
          ? '智能歌单'
          : `${playlist.trackCount ?? 0} tracks${playlist.description ? ` · ${playlist.description}` : ''}`,
        artwork: playlist.artwork ?? playlistFirstTrackArtworks.get(playlist.urn),
        artworkSeed: playlist.urn,
        pinned: isPinned,
        addedAt: allSaved.data?.find((e) => e.urn === playlist.urn)?.addedAt ?? 0,
        lastPlayedAt: 0,
        onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: playlist.urn }),
        onPlay: () => playPlaylist(playlist.urn, playlist.name),
        onDelete: () =>
          void ctx.library.deletePlaylist(playlist.urn).catch(fail('could not delete the playlist')),
        onMore: (anchor) => openPlaylistMenu(playlist, anchor, isPinned),
      }
    })
  }, [allSaved.data, ctx, isItemPinned, openPlaylistMenu, playPlaylist, playlistFirstTrackArtworks, playlists.data])

  const albumItems: UnifiedItem[] = useMemo(() => {
    return (savedAlbumEntries.data ?? []).map((entry) => {
      const detail = albumsMap.get(entry.urn)
      const title = detail?.title ?? entry.urn
      const artists = detail?.artists?.map((a) => a.name).join(', ') ?? '专辑'
      const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
      const trackUrns = detail?.tracks?.map((t) => t.urn) ?? []
      const lastPlayedAt = trackUrns.length > 0 ? Math.max(0, ...trackUrns.map((u) => historyMap.get(u) ?? 0)) : 0
      const isDownloaded =
        trackUrns.length > 0 &&
        trackUrns.every((u) => downloads?.tasks.some((t) => t.trackUrn === u && t.state === 'done'))
      return {
        id: entry.urn,
        urn: entry.urn,
        kind: 'album' as const,
        title,
        subtitle: artists,
        artwork: detail?.artwork,
        artworkSeed: entry.urn,
        pinned: isPinned,
        addedAt: entry.addedAt,
        lastPlayedAt,
        isDownloaded,
        onOpen: () => ctx.ui.navigate(ALBUM_VIEWS.album, { urn: entry.urn }),
        onPlay: () => playAlbum(entry.urn, title),
        onMore: (anchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned),
      }
    })
  }, [albumsMap, ctx, downloads?.tasks, historyMap, isItemPinned, openAlbumMenu, playAlbum, savedAlbumEntries.data])

  const collectionItems: UnifiedItem[] = useMemo(() => {
    return (collections.data ?? []).map((collection) => {
      const isPinned = isItemPinned({ id: collection.id })
      return {
        id: collection.id,
        kind: 'collection',
        title: collection.name,
        subtitle: `${collection.itemCount ?? 0} 个项目`,
        artwork: collectionFirstArtworks.get(collection.id),
        artworkSeed: collection.id,
        pinned: isPinned,
        addedAt: collection.createdAt,
        lastPlayedAt: 0,
        isDownloaded: false,
        onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.collection, { id: collection.id }),
        onPlay: () => playCollection(collection.id),
        onDelete: () =>
          void ctx.library.deleteCollection(collection.id).catch(fail('could not delete the collection')),
        onMore: (anchor) => openCollectionMenu(collection, anchor, isPinned),
      }
    })
  }, [collectionFirstArtworks, collections.data, ctx, isItemPinned, openCollectionMenu, playCollection])

  const allItems = useMemo(() => {
    return [favoriteItem, localItem, ...playlistItems, ...albumItems, ...collectionItems]
  }, [favoriteItem, localItem, playlistItems, albumItems, collectionItems])

  const filteredItems = useMemo(() => {
    let result = allItems
    if (activeFilter === 'playlist') {
      result = result.filter((item) => item.kind === 'playlist' || item.kind === 'favorite')
    } else if (activeFilter === 'album') {
      result = result.filter((item) => item.kind === 'album')
    } else if (activeFilter === 'collection') {
      result = result.filter((item) => item.kind === 'collection')
    } else if (activeFilter === 'downloaded') {
      result = result.filter((item) => item.kind === 'local' || item.isDownloaded)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q),
      )
    }

    return [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sortMode === 'alphabetical') {
        return a.title.localeCompare(b.title, 'zh-Hans-CN')
      }
      if (sortMode === 'recent-played') {
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
      }
      return (b.addedAt ?? 0) - (a.addedAt ?? 0)
    })
  }, [allItems, activeFilter, searchQuery, sortMode])

  const sortLabels: Record<'recent-added' | 'recent-played' | 'alphabetical', string> = {
    'recent-played': '最近播放',
    'recent-added': '最近添加的内容',
    'alphabetical': '按字母排序',
  }

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'recent-played',
      label: '最近播放',
      onSelect: () => setSortMode('recent-played'),
    },
    {
      id: 'recent-added',
      label: '最近添加的内容',
      onSelect: () => setSortMode('recent-added'),
    },
    {
      id: 'alphabetical',
      label: '按字母排序',
      onSelect: () => setSortMode('alphabetical'),
    },
  ]

  const summary = summariseLibrary(playlists.data ?? [], collections.data ?? [], [])

  return h(
    'section',
    {
      'aria-label': 'Library',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'baseline', gap: tokens.space[3] } },
      h(Text, { variant: 'xl' }, 'Library'),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        `${summary.playlists} 歌单 · ${savedAlbumEntries.data?.length ?? 0} 专辑 · ${summary.collections} 目录`,
      ),
      h(Button, {
        variant: 'secondary',
        onPress: () => ctx.ui.navigate(LIBRARY_VIEWS.favorites),
        children: 'Favourites',
      }),
    ),

    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: tokens.space[3] } },
      h(
        'div',
        { style: { display: 'flex', gap: tokens.space[2], flex: 1, minWidth: 260 } },
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
      h(
        'div',
        { style: { display: 'flex', gap: tokens.space[2], flex: 1, minWidth: 260 } },
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
    ),
    error ? h(Text, { variant: 'sm', tone: 'error', testID: 'playlists-error' }, error) : null,

    // Filter toggle buttons (Requirement 6)
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
      ([
        { key: 'playlist', label: '歌单' },
        { key: 'album', label: '专辑' },
        { key: 'collection', label: '目录' },
        { key: 'downloaded', label: '已下载' },
      ] as const).map(({ key, label }) => {
        const active = activeFilter === key
        return h(Button, {
          key,
          variant: active ? 'primary' : 'secondary',
          onPress: () => setActiveFilter(active ? 'all' : key),
          children: label,
        })
      }),
    ),

    // Search bar and Sort selector (Requirement 7)
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space[3],
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
        h(IconButton, {
          icon: '🔍',
          accessibilityLabel: '搜索',
          variant: searchOpen ? 'secondary' : 'ghost',
          onPress: () => setSearchOpen((prev) => !prev),
        }),
        searchOpen
          ? h(TextField, {
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: '搜索音乐库内容...',
              testID: 'library-search-input',
            })
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
        h(Text, { variant: 'sm', tone: 'muted' }, '排序:'),
        h(Button, {
          variant: 'ghost',
          onPress: () => setSortMenuAnchor({ x: 400, y: 200 }),
          children: `${sortLabels[sortMode]} ▾`,
        }),
      ),
    ),

    // Unified List (Requirement 2, 3, 4, 5)
    filteredItems.length === 0
      ? h(EmptyState, {
          icon: '♪',
          title: '没有找到内容',
          description: '导入音乐源、扫描本地文件夹或调整筛选条件。',
        })
      : h(List<UnifiedItem>, {
          testID: 'playlists-list',
          items: filteredItems,
          estimatedItemSize: tokens.size.row,
          keyExtractor: (item) => item.id,
          empty: h(EmptyState, { title: 'No items yet' }),
          renderItem: (item) => h(UnifiedLibraryRow, { key: item.id, ctx, item }),
        }),

    h(ContextMenu, playlistMenu.menuProps),
    h(ContextMenu, collectionMenu.menuProps),
    h(ContextMenu, albumMenu.menuProps),
    h(ContextMenu, {
      open: simpleMenu !== undefined,
      onClose: () => setSimpleMenu(undefined),
      x: simpleMenu?.anchor.x ?? 0,
      y: simpleMenu?.anchor.y ?? 0,
      items: simpleMenu?.items ?? [],
      ...(simpleMenu ? { title: simpleMenu.title } : {}),
    }),
    h(ContextMenu, {
      open: sortMenuAnchor !== undefined,
      onClose: () => setSortMenuAnchor(undefined),
      x: sortMenuAnchor?.x ?? 0,
      y: sortMenuAnchor?.y ?? 0,
      items: sortMenuItems,
      title: '排序方式',
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

/* ── local music ──────────────────────────────────────────────────────── */

export function LocalMusicScreen({ ctx }: { ctx: Context }): ReactElement {
  const [tracks, setTracks] = useState<readonly Track[]>([])
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const menu = useTrackMenu(ctx)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    if (!ctx.sources?.listTracks) {
      setLoading(false)
      return
    }
    ctx.sources
      .listTracks({ sourceIds: ['local'] })
      .then((paged) => {
        if (!cancelled) {
          setTracks(paged.items)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  useEffect(() => {
    const off = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    return () => void off()
  }, [ctx])

  const trackUrns = tracks.map((t) => t.urn)

  return h(
    'section',
    {
      'aria-label': '本地音乐',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, '本地音乐'),
        h(Text, { variant: 'sm', tone: 'muted' }, `${tracks.length} 首歌曲`),
      ),
      h(Button, {
        variant: 'secondary',
        onPress: () => trackUrns[0] && player?.playNow(trackUrns),
        disabled: trackUrns.length === 0,
        testID: 'local-music-play',
        children: '播放全部',
      }),
      h(Button, {
        variant: 'ghost',
        onPress: () => ctx.ui.navigate('scanner.settings'),
        children: '扫描目录',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    loading
      ? h(EmptyState, { title: '加载中…' })
      : tracks.length === 0
      ? h(EmptyState, {
          icon: '📁',
          title: '暂无本地音乐',
          description: '添加音乐文件夹后，扫描的歌曲将在此显示。',
        })
      : h(
          'div',
          { style: { flex: 1, minHeight: 0 } },
          h(List<Track>, {
            testID: 'local-tracks-list',
            items: tracks,
            estimatedItemSize: tokens.size.row,
            keyExtractor: (t) => t.urn,
            renderItem: (t) =>
              h(TrackRow, {
                track: t,
                onPress: () => player?.playFromContext(t.urn, trackUrns),
                onMore: (anchor) => menu.open({ track: t }, anchor),
              }),
          }),
        ),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── one collection ────────────────────────────────────────────────────── */

/**
 * A collection is a folder, so its rows are whatever its members are: tracks
 * play, albums open the album page, playlists open the playlist page. A
 * member the catalogue cannot answer for still shows — titled by its URN —
 * because hiding it would silently lose something the user put there.
 */
export function CollectionScreen({ ctx, id }: { ctx: Context; id?: string }): ReactElement {
  const state = useCollectionDetail(ctx, id)
  const detail = state.data
  const tracks = detail?.members ?? []
  const trackUrns = tracks
    .filter((member) => member.kind === 'track' && member.track)
    .map((member) => member.urn)
  const menu = useTrackMenu(ctx)

  if (!id) return h(EmptyState, { title: 'No collection chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the collection', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  const players = serviceOf<{ playNow(urns: string[]): Promise<void> }>(ctx, 'player')

  return h(
    'section',
    {
      'aria-label': detail.collection?.name ?? 'Collection',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.collection?.name ?? 'Collection'),
        h(Text, { variant: 'sm', tone: 'muted' }, `${detail.members.length} items`),
      ),
      h(Button, {
        onPress: () => trackUrns[0] && void players?.playNow(trackUrns),
        disabled: trackUrns.length === 0,
        testID: 'collection-play',
        children: 'Play',
      }),
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<CollectionMember>, {
        testID: 'collection-members',
        items: [...(detail.members ?? [])],
        estimatedItemSize: tokens.size.row,
        keyExtractor: (member) => member.urn,
        empty: h(EmptyState, {
          icon: '🗂',
          title: 'Nothing in this collection yet',
          description: 'Add albums or playlists from the library, or tracks from any list.',
        }),
        renderItem: (member) => {
          if (member.kind === 'track' && member.track) {
            return h(
              'div',
              { style: { display: 'flex', alignItems: 'center' } },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(TrackRow, {
                  track: member.track,
                  onPress: () =>
                    void players?.playNow(trackUrns).then(() => {
                      /* playNow starts at the first track; the context is the collection */
                    }),
                  onMore: (anchor) => menu.open({ track: member.track! }, anchor),
                }),
              ),
            )
          }
          return h(MemberRow, {
            member,
            onOpen: () => {
              if (member.kind === 'album') ctx.ui.navigate(ALBUM_VIEWS.album, { urn: member.urn })
              else if (member.kind === 'playlist') ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: member.urn })
            },
          })
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/** An album/playlist/unknown member: a labelled row that opens where it can. */
function MemberRow({ member, onOpen }: { member: CollectionMember; onOpen: () => void }): ReactElement {
  const openable = member.kind === 'album' || member.kind === 'playlist'
  return h(
    'button',
    {
      type: 'button',
      disabled: !openable,
      onClick: openable ? onOpen : undefined,
      'aria-label': member.title,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        width: '100%',
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        border: 'none',
        borderRadius: tokens.radius.sm,
        background: 'transparent',
        cursor: openable ? 'pointer' : 'default',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
      },
    },
    h(Text, { variant: 'md' }, member.kind === 'album' ? '💿' : member.kind === 'playlist' ? '≡' : '•'),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, member.title),
      member.subtitle ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, member.subtitle) : null,
    ),
    openable ? h(Text, { tone: 'muted', children: '›' }) : null,
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-library-ui-desktop'

export const inject = ['ui', 'library', 'player', 'sources']

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
  ctx.logger.info('plugin-library-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LIBRARY_VIEWS.home, bound(ctx, LibraryScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.playlist, bound(ctx, PlaylistDetailScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.collection, bound(ctx, CollectionScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.favorites, bound(ctx, FavoritesScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.local, bound(ctx, LocalMusicScreen))
  }, 'library-ui-desktop')
}

export default { name, inject, apply }
