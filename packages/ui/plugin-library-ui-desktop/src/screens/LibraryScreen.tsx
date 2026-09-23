import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  DownloadsService,
  PlayerService,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import {
  useCollections,
  usePlaylists,
  useSaved,
} from '@BBeBee/plugin-library/hooks'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import { ContextMenu, EmptyState, List, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useAddToCollection, useCollectionMenu, usePlaylistMenu } from '@BBeBee/ui-menus'
import { UnifiedLibraryRow, type UnifiedItem } from '../components/UnifiedLibraryRow.js'
import { LibraryCreateButton, LibraryCreateMenu } from '../components/LibraryCreateDropdown.js'
import {
  LibraryToolbar,
  type LibraryFilterKey,
  type LibrarySortMode,
} from '../components/LibraryToolbar.js'
import { LibraryModals } from '../components/LibraryModals.js'
import { CollapsedLibraryView } from '../components/views/CollapsedLibraryView.js'
import { ExpandedLibraryView } from '../components/views/ExpandedLibraryView.js'
import { SidebarFolderView } from '../components/views/SidebarFolderView.js'
import { useLibraryHydration } from '../hooks/useLibraryHydration.js'
import { useLibraryActions } from '../hooks/useLibraryActions.js'

export interface LibraryScreenProps {
  ctx: Context
  mode?: 'collapsed' | 'sidebar' | 'expanded'
  onModeChange?: (mode: 'collapsed' | 'sidebar' | 'expanded') => void
  onOpenAlbum?: (urn: string) => void
  folderId?: string | null
  onFolderChange?: (folderId: string | null) => void
  [key: string]: unknown
}

export function LibraryScreen({
  ctx,
  mode: propMode,
  onModeChange,
  onOpenAlbum,
  folderId: propFolderId,
  onFolderChange,
}: LibraryScreenProps): ReactElement {
  const [localMode, setLocalMode] = useState<'collapsed' | 'sidebar' | 'expanded'>('sidebar')
  const currentMode = propMode ?? localMode

  const handleModeChange = useCallback(
    (nextMode: 'collapsed' | 'sidebar' | 'expanded') => {
      setLocalMode(nextMode)
      onModeChange?.(nextMode)
    },
    [onModeChange],
  )

  const [isHeaderHovered, setIsHeaderHovered] = useState(false)
  const [localFolderId, setLocalFolderId] = useState<string | null>(propFolderId ?? null)
  useEffect(() => {
    if (propFolderId !== undefined) {
      setLocalFolderId(propFolderId)
    }
  }, [propFolderId])
  const activeFolderId = localFolderId
  const setActiveFolderId = useCallback(
    (id: string | null) => {
      setLocalFolderId(id)
      onFolderChange?.(id)
    },
    [onFolderChange],
  )
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const [folderItemsMap, setFolderItemsMap] = useState<Map<string, UnifiedItem[]>>(new Map())
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [collapsedMenuPos, setCollapsedMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false)
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isCreateMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-testid="create-dropdown-trigger"]')) {
        return
      }
      if (createMenuRef.current && !createMenuRef.current.contains(target as Node)) {
        setIsCreateMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [isCreateMenuOpen])

  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const savedAlbumEntries = useSaved(ctx, 'album')
  const savedArtistEntries = useSaved(ctx, 'artist')
  const savedTrackEntries = useSaved(ctx, 'track')
  const allSaved = useSaved(ctx)

  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')

  const [activeFilter, setActiveFilter] = useState<LibraryFilterKey>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<LibrarySortMode>('creator')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | undefined>(undefined)

  const [draft, setDraft] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  const playlistMenu = usePlaylistMenu(ctx)
  const collectionMenu = useCollectionMenu(ctx)
  const albumMenu = useAddToCollection(ctx)

  const fail = useCallback(
    (what: string) => (cause: unknown) => {
      setError(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)
    },
    [],
  )

  useEffect(() => {
    const offChanged = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    const offCollections = ctx.on('library/collections-changed', () => setGeneration((n) => n + 1))
    return () => {
      offChanged()
      offCollections()
    }
  }, [ctx])

  const {
    historyMap,
    localTracks,
    albumsMap,
    playlistFirstTrackArtworks,
    collectionFirstArtworks,
    containedPlaylistUrns,
    setContainedPlaylistUrns,
    favoriteArtwork,
  } = useLibraryHydration({
    ctx,
    generation,
    savedAlbumEntries: savedAlbumEntries.data,
    savedTrackEntries: savedTrackEntries.data,
    playlists: playlists.data,
    collections: collections.data,
  })

  const pinnedUrns = useMemo(() => {
    return new Set(allSaved.data?.filter((e) => e.pinned).map((e) => e.urn) ?? [])
  }, [allSaved.data])

  const {
    isItemPinned,
    playPlaylist,
    playAlbum,
    playCollection,
    openPlaylistMenu,
    openCollectionMenu,
    openAlbumMenu,
    openBuiltinMenu,
    createPlaylist,
    createCollection,
    simpleMenu,
    setSimpleMenu,
    editingPlaylist,
    setEditingPlaylist,
    renamingCollection,
    setRenamingCollection,
    createInFolderModal,
    setCreateInFolderModal,
    confirmDeleteTarget,
    setConfirmDeleteTarget,
  } = useLibraryActions({
    ctx,
    pinnedUrns,
    collections: collections.data ?? [],
    albumsMap,
    player,
    playlistMenu,
    collectionMenu,
    albumMenu,
    setGeneration,
    setFolderItemsMap,
    setContainedPlaylistUrns,
    setError,
    fail,
  })

  const favoriteUrns = useMemo(() => savedTrackEntries.data?.map((e) => e.urn) ?? [], [savedTrackEntries.data])
  const localUrns = useMemo(() => localTracks.map((t) => t.urn), [localTracks])

  const favoriteItem: UnifiedItem = useMemo(() => {
    const isPinned = isItemPinned({ id: 'builtin:favorite' })
    const lastPlayedAt = favoriteUrns.length > 0 ? Math.max(0, ...favoriteUrns.map((u) => historyMap.get(u) ?? 0)) : 0
    return {
      id: 'builtin:favorite',
      kind: 'favorite',
      title: '已点赞的歌曲',
      subtitle: '歌单 • Revers',
      creator: 'Revers',
      artwork: favoriteArtwork,
      artworkSeed: 'favorite',
      pinned: isPinned,
      addedAt: savedTrackEntries.data?.[0]?.addedAt ?? Date.now() - 7 * 24 * 3600 * 1000,
      lastPlayedAt,
      isDownloaded: false,
      onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.favorites),
      onPlay: () => {
        if (favoriteUrns[0]) void player?.playFromContext(favoriteUrns[0], favoriteUrns)
      },
      onMore: (anchor) =>
        openBuiltinMenu(
          '已点赞的歌曲',
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
    const maxFetched = localTracks.length > 0 ? Math.max(0, ...localTracks.map((t) => t.fetchedAt ?? 0)) : 0
    const localAddedAt = maxFetched > 0 ? maxFetched : (localTracks.length > 0 ? Date.now() : 0)
    return {
      id: 'builtin:local',
      kind: 'local',
      title: '本地音乐',
      subtitle: `${localTracks.length} 首歌曲`,
      creator: '本地文件',
      artwork: localTracks[0]?.artwork,
      artworkSeed: 'local',
      pinned: isPinned,
      addedAt: localAddedAt,
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
    return (playlists.data ?? [])
      .filter((playlist) => !containedPlaylistUrns.has(playlist.urn))
      .map((playlist) => {
        const isPinned = isItemPinned({ id: playlist.urn, urn: playlist.urn })
        const addedAt =
          playlist.createdAt ??
          playlist.updatedAt ??
          allSaved.data?.find((e) => e.urn === playlist.urn)?.addedAt ??
          Date.now()
        return {
          id: playlist.urn,
          urn: playlist.urn,
          kind: 'playlist',
          title: playlist.name,
          subtitle: playlist.isSmart
            ? '智能歌单'
            : '歌单 • Revers',
          creator: 'Revers',
          artwork: playlist.artwork ?? playlistFirstTrackArtworks.get(playlist.urn),
          artworkSeed: playlist.urn,
          pinned: isPinned,
          addedAt,
          lastPlayedAt: 0,
          onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: playlist.urn }),
          onPlay: () => playPlaylist(playlist.urn, playlist.name),
          onDelete: () =>
            void ctx.library.deletePlaylist(playlist.urn).catch(fail('could not delete the playlist')),
          onMore: (anchor) => openPlaylistMenu(playlist, anchor, isPinned),
        }
      })
  }, [allSaved.data, containedPlaylistUrns, ctx, fail, isItemPinned, openPlaylistMenu, playPlaylist, playlistFirstTrackArtworks, playlists.data])

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
        subtitle: `专辑 • ${artists}`,
        creator: artists,
        artwork: detail?.artwork,
        artworkSeed: entry.urn,
        pinned: isPinned,
        addedAt: entry.addedAt,
        lastPlayedAt,
        isDownloaded,
        onOpen: () => {
          if (onOpenAlbum) onOpenAlbum(entry.urn)
          else ctx.ui.navigate(ALBUM_VIEWS.album, { urn: entry.urn })
        },
        onPlay: () => playAlbum(entry.urn, title),
        onDelete: () => void ctx.library.setSaved(entry.urn, false).catch(fail('could not remove the album')),
        onMore: (anchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned),
      }
    })
  }, [albumsMap, ctx, downloads?.tasks, fail, historyMap, isItemPinned, onOpenAlbum, openAlbumMenu, playAlbum, savedAlbumEntries.data])

  const collectionItems: UnifiedItem[] = useMemo(() => {
    return (collections.data ?? []).map((collection) => {
      const isPinned = isItemPinned({ id: collection.id })
      return {
        id: collection.id,
        kind: 'collection',
        title: collection.name,
        subtitle: `文件夹 • ${collection.itemCount ?? 0} 个项目`,
        creator: 'Revers',
        artwork: collectionFirstArtworks.get(collection.id),
        artworkSeed: collection.id,
        pinned: isPinned,
        addedAt: collection.createdAt,
        lastPlayedAt: 0,
        isDownloaded: false,
        onOpen: () => setActiveFolderId(collection.id),
        onPlay: () => playCollection(collection.id),
        onDelete: () =>
          void ctx.library.deleteCollection(collection.id).catch(fail('could not delete the collection')),
        onMore: (anchor) => openCollectionMenu(collection, anchor, isPinned),
      }
    })
  }, [collectionFirstArtworks, collections.data, ctx, fail, isItemPinned, openCollectionMenu, playCollection, setActiveFolderId])

  const artistItems: UnifiedItem[] = useMemo(() => {
    return (savedArtistEntries.data ?? []).map((entry) => {
      const name = entry.urn.replace(/^artist:/, '')
      const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
      return {
        id: entry.urn,
        urn: entry.urn,
        kind: 'artist' as const,
        title: name,
        subtitle: '艺人',
        creator: name,
        artwork: undefined,
        artworkSeed: entry.urn,
        pinned: isPinned,
        addedAt: entry.addedAt,
        lastPlayedAt: 0,
        isDownloaded: false,
        onOpen: () => ctx.ui.navigate('sources.search', { query: name }),
        onPlay: () => {},
        onMore: (anchor) => openBuiltinMenu(name, () => {}, isPinned, { id: entry.urn }, anchor),
      }
    })
  }, [ctx, isItemPinned, openBuiltinMenu, savedArtistEntries.data])

  const allItems = useMemo(() => {
    return [favoriteItem, localItem, ...playlistItems, ...albumItems, ...collectionItems, ...artistItems]
  }, [favoriteItem, localItem, playlistItems, albumItems, collectionItems, artistItems])

  const filteredItems = useMemo(() => {
    let result = allItems
    if (activeFilter === 'playlist') {
      result = result.filter((item) => item.kind === 'playlist' || item.kind === 'favorite')
    } else if (activeFilter === 'album') {
      result = result.filter((item) => item.kind === 'album')
    } else if (activeFilter === 'artist') {
      result = result.filter((item) => item.kind === 'artist')
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
      if (sortMode === 'creator') {
        return (a.creator ?? '').localeCompare(b.creator ?? '', 'zh-Hans-CN')
      }
      return (b.addedAt ?? 0) - (a.addedAt ?? 0)
    })
  }, [allItems, activeFilter, searchQuery, sortMode])

  const loadCollectionUnifiedItems = useCallback(
    async (collectionId: string): Promise<UnifiedItem[]> => {
      try {
        const page = await ctx.library.listCollectionItems(collectionId)
        const entries = page.items ?? []
        const results: UnifiedItem[] = []

        for (const entry of entries) {
          const parsed = tryParseUrn(entry.urn)
          const kind = parsed?.kind

          const matchedPlaylist = (playlists.data ?? []).find((p) => p.urn === entry.urn)
          if (matchedPlaylist) {
            const isPinned = isItemPinned({ id: matchedPlaylist.urn, urn: matchedPlaylist.urn })
            results.push({
              id: matchedPlaylist.urn,
              urn: matchedPlaylist.urn,
              kind: 'playlist',
              title: matchedPlaylist.name,
              subtitle: matchedPlaylist.isSmart ? '智能歌单' : '歌单 • Revers',
              creator: 'Revers',
              artwork: matchedPlaylist.artwork ?? playlistFirstTrackArtworks.get(matchedPlaylist.urn),
              artworkSeed: matchedPlaylist.urn,
              pinned: isPinned,
              addedAt: matchedPlaylist.createdAt ?? Date.now(),
              lastPlayedAt: 0,
              onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: matchedPlaylist.urn }),
              onPlay: () => playPlaylist(matchedPlaylist.urn, matchedPlaylist.name),
              onDelete: () =>
                void ctx.library.deletePlaylist(matchedPlaylist.urn).catch(fail('could not delete the playlist')),
              onMore: (anchor) => openPlaylistMenu(matchedPlaylist, anchor, isPinned, collectionId),
            })
            continue
          }

          const matchedAlbum = albumItems.find((a) => a.urn === entry.urn || a.id === entry.urn)
          if (matchedAlbum) {
            results.push({
              ...matchedAlbum,
              onDelete: () =>
                void ctx.library
                  .removeFromCollection(collectionId, [entry.urn])
                  .catch(fail('could not remove album from folder')),
              onMore: (anchor) =>
                openAlbumMenu({ urn: entry.urn, title: matchedAlbum.title }, anchor, matchedAlbum.pinned, collectionId),
            })
            continue
          }

          if (kind === 'track') {
            const local = localTracks.find((t) => t.urn === entry.urn)
            let trackObj = local
            if (!trackObj && ctx.sources?.getTracks) {
              const fetched = await ctx.sources.getTracks([entry.urn]).catch(() => [])
              trackObj = fetched[0]
            }
            if (trackObj) {
              results.push({
                id: entry.urn,
                urn: entry.urn,
                kind: 'playlist',
                title: trackObj.title,
                subtitle: trackObj.artists?.map((a) => a.name).join(', ') ?? '单曲',
                creator: trackObj.artists?.map((a) => a.name).join(', ') ?? '未知艺人',
                artwork: trackObj.artwork,
                artworkSeed: entry.urn,
                pinned: false,
                addedAt: trackObj.fetchedAt ?? Date.now(),
                lastPlayedAt: historyMap.get(entry.urn) ?? 0,
                onOpen: () => {
                  void player?.playNow([entry.urn])
                },
                onPlay: () => {
                  void player?.playNow([entry.urn])
                },
                onMore: (anchor) =>
                  openBuiltinMenu(
                    trackObj!.title,
                    () => void player?.playNow([entry.urn]),
                    false,
                    { id: entry.urn },
                    anchor,
                  ),
              })
              continue
            }
          }

          if (kind === 'playlist') {
            try {
              const detail = await ctx.library.getPlaylist(entry.urn)
              if (detail) {
                const isPinned = isItemPinned({ id: detail.urn, urn: detail.urn })
                results.push({
                  id: detail.urn,
                  urn: detail.urn,
                  kind: 'playlist',
                  title: detail.name,
                  subtitle: detail.isSmart ? '智能歌单' : '歌单 • Revers',
                  creator: 'Revers',
                  artwork: detail.artwork ?? playlistFirstTrackArtworks.get(detail.urn),
                  artworkSeed: detail.urn,
                  pinned: isPinned,
                  addedAt: detail.createdAt ?? Date.now(),
                  lastPlayedAt: 0,
                  onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: detail.urn }),
                  onPlay: () => playPlaylist(detail.urn, detail.name),
                  onMore: (anchor) =>
                    openPlaylistMenu(
                      {
                        urn: detail.urn,
                        name: detail.name,
                        isSmart: detail.isSmart,
                        createdAt: detail.createdAt,
                        updatedAt: detail.updatedAt,
                      },
                      anchor,
                      isPinned,
                      collectionId,
                    ),
                })
                continue
              }
            } catch {
              // ignore fetch failure and fall back
            }
          }

          if (kind === 'album') {
            try {
              const album = await ctx.sources?.getAlbum(entry.urn)
              if (album) {
                const title = album.title ?? entry.urn
                const artists = album.artists?.map((a) => a.name).join(', ') ?? '专辑'
                const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
                results.push({
                  id: entry.urn,
                  urn: entry.urn,
                  kind: 'album',
                  title,
                  subtitle: `专辑 • ${artists}`,
                  creator: artists,
                  artwork: album.artwork,
                  artworkSeed: entry.urn,
                  pinned: isPinned,
                  addedAt: Date.now(),
                  lastPlayedAt: 0,
                  onOpen: () => {
                    if (onOpenAlbum) onOpenAlbum(entry.urn)
                    else ctx.ui.navigate(ALBUM_VIEWS.album, { urn: entry.urn })
                  },
                  onPlay: () => playAlbum(entry.urn, title),
                  onDelete: () =>
                    void ctx.library
                      .removeFromCollection(collectionId, [entry.urn])
                      .catch(fail('could not remove album from folder')),
                  onMore: (anchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned, collectionId),
                })
                continue
              }
            } catch {
              // ignore fetch failure and fall back
            }
          }

          results.push({
            id: entry.urn,
            urn: entry.urn,
            kind: 'playlist',
            title: entry.urn,
            subtitle: '项目',
            creator: '',
            artwork: undefined,
            artworkSeed: entry.urn,
            pinned: false,
            addedAt: Date.now(),
            lastPlayedAt: 0,
            onOpen: () => {},
            onPlay: () => {},
            onMore: () => {},
          })
        }
        return results
      } catch {
        return []
      }
    },
    [
      albumItems,
      ctx,
      fail,
      historyMap,
      isItemPinned,
      localTracks,
      onOpenAlbum,
      openAlbumMenu,
      openBuiltinMenu,
      openPlaylistMenu,
      playAlbum,
      player,
      playPlaylist,
      playlistFirstTrackArtworks,
      playlists.data,
    ],
  )

  const loadCollectionUnifiedItemsRef = useRef(loadCollectionUnifiedItems)
  useEffect(() => {
    loadCollectionUnifiedItemsRef.current = loadCollectionUnifiedItems
  })

  useEffect(() => {
    const idsToLoad = new Set<string>(expandedFolderIds)
    if (activeFolderId) idsToLoad.add(activeFolderId)
    if (idsToLoad.size === 0) return

    let cancelled = false
    Promise.all(
      Array.from(idsToLoad).map(async (id) => {
        const items = await loadCollectionUnifiedItemsRef.current(id)
        return { id, items }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setFolderItemsMap((prev) => {
          let hasDiff = false
          for (const res of results) {
            const existing = prev.get(res.id)
            if (
              !existing ||
              existing.length !== res.items.length ||
              existing.some((it, idx) => it.id !== res.items[idx]?.id)
            ) {
              hasDiff = true
              break
            }
          }
          if (!hasDiff && prev.size === results.length) return prev
          const next = new Map(prev)
          for (const res of results) {
            next.set(res.id, res.items)
          }
          return next
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [expandedFolderIds, activeFolderId, generation])

  const activeCollection = useMemo(() => {
    if (!activeFolderId) return undefined
    return (collections.data ?? []).find((c) => c.id === activeFolderId)
  }, [collections.data, activeFolderId])

  const activeFolderItems = useMemo(() => {
    if (!activeFolderId) return []
    return folderItemsMap.get(activeFolderId) ?? []
  }, [activeFolderId, folderItemsMap])

  const filteredFolderItems = useMemo(() => {
    let result = activeFolderItems
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
      if (sortMode === 'creator') {
        return (a.creator ?? '').localeCompare(b.creator ?? '', 'zh-Hans-CN')
      }
      return (b.addedAt ?? 0) - (a.addedAt ?? 0)
    })
  }, [activeFolderItems, searchQuery, sortMode])

  const displayItems = useMemo(() => {
    const list: (UnifiedItem & {
      isFolder?: boolean
      isExpanded?: boolean
      onToggleExpand?: () => void
      isChild?: boolean
    })[] = []
    for (const item of filteredItems) {
      const isFolder = item.kind === 'collection'
      const isExpanded = isFolder && expandedFolderIds.has(item.id)
      list.push({
        ...item,
        isFolder,
        isExpanded,
        onToggleExpand: isFolder ? () => toggleFolderExpanded(item.id) : undefined,
      })
      if (isExpanded) {
        const children = folderItemsMap.get(item.id) ?? []
        for (const child of children) {
          list.push({
            ...child,
            isChild: true,
          })
        }
      }
    }
    return list
  }, [filteredItems, expandedFolderIds, folderItemsMap, toggleFolderExpanded])

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'creator',
      label: '创建者',
      icon: sortMode === 'creator' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('creator'),
    },
    {
      id: 'recent-added',
      label: '最近添加',
      icon: sortMode === 'recent-added' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('recent-added'),
    },
    {
      id: 'recent-played',
      label: '最近播放',
      icon: sortMode === 'recent-played' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('recent-played'),
    },
    {
      id: 'alphabetical',
      label: '按字母排序',
      icon: sortMode === 'alphabetical' ? tablerIcon('check', { size: 18 }) : undefined,
      onSelect: () => setSortMode('alphabetical'),
    },
  ]

  const renderCreateButton = () => {
    return h(LibraryCreateButton, {
      isCreateMenuOpen,
      onClick: () => setIsCreateMenuOpen((prev) => !prev),
    })
  }

  const renderCreateMenu = (isCollapsed: boolean) => {
    return h(LibraryCreateMenu, {
      isCreateMenuOpen,
      setIsCreateMenuOpen,
      createMenuRef,
      isCollapsed,
      collapsedMenuPos,
      onOpenCreatePlaylist: () => {
        setIsCreateMenuOpen(false)
        setShowCreatePlaylistModal(true)
      },
      onOpenCreateCollection: () => {
        setIsCreateMenuOpen(false)
        setShowCreateCollectionModal(true)
      },
    })
  }

  const renderModals = () => {
    return h(LibraryModals, {
      ctx,
      showCreatePlaylistModal,
      setShowCreatePlaylistModal,
      draft,
      setDraft,
      onCreatePlaylist: () => {
        createPlaylist(draft, activeFolderId)
        setDraft('')
      },
      showCreateCollectionModal,
      setShowCreateCollectionModal,
      collectionDraft,
      setCollectionDraft,
      onCreateCollection: () => {
        createCollection(collectionDraft, activeFolderId)
        setCollectionDraft('')
      },
      editingPlaylist,
      setEditingPlaylist,
      onUpdatePlaylist: async (patch) => {
        if (!editingPlaylist) return
        await ctx.library.updatePlaylist(editingPlaylist.urn, patch)
        setGeneration((n) => n + 1)
      },
      renamingCollection,
      setRenamingCollection,
      onRenameCollection: async (id, newName) => {
        await ctx.library.renameCollection(id, newName)
        setGeneration((n) => n + 1)
      },
      createInFolderModal,
      setCreateInFolderModal,
      onCreateInFolder: async (name) => {
        if (!createInFolderModal) return
        if (createInFolderModal.type === 'playlist') {
          const created = await ctx.library.createPlaylist(name)
          await ctx.library.addToCollection(createInFolderModal.folderId, [created.urn])
        } else {
          await ctx.library.createCollection(name, { parentId: createInFolderModal.folderId })
        }
        setGeneration((n) => n + 1)
      },
      confirmDeleteTarget,
      setConfirmDeleteTarget,
      onConfirmDelete: async () => {
        if (!confirmDeleteTarget) return
        const target = confirmDeleteTarget
        setConfirmDeleteTarget(null)
        try {
          if (target.type === 'playlist') {
            await ctx.library.deletePlaylist(target.urn)
          } else if (target.type === 'album') {
            await ctx.library.setSaved(target.urn, false)
            if (target.folderId) {
              await ctx.library.removeFromCollection(target.folderId, [target.urn])
            }
          }
          if (target.folderId) {
            setFolderItemsMap((prev) => {
              const existing = prev.get(target.folderId!)
              if (!existing) return prev
              const next = new Map(prev)
              next.set(
                target.folderId!,
                existing.filter((item) => item.urn !== target.urn && item.id !== target.urn),
              )
              return next
            })
          }
          setGeneration((n) => n + 1)
        } catch (e) {
          fail(target.type === 'playlist' ? 'could not delete the playlist' : 'could not remove the album')(e)
        }
      },
    })
  }

  const renderContextMenus = () => {
    return h(
      'div',
      null,
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

  if (currentMode === 'collapsed') {
    return h(CollapsedLibraryView, {
      ctx,
      activeFolderId,
      setActiveFolderId,
      handleModeChange,
      isCreateMenuOpen,
      setIsCreateMenuOpen,
      setCollapsedMenuPos,
      renderCreateMenu,
      items: activeFolderId !== null ? filteredFolderItems : filteredItems,
      modals: renderModals(),
      contextMenus: renderContextMenus(),
    })
  }

  if (currentMode === 'expanded') {
    return h(ExpandedLibraryView, {
      ctx,
      activeFolderId,
      activeCollection,
      setActiveFolderId,
      handleModeChange,
      renderCreateButton,
      renderCreateMenu,
      openCollectionMenu,
      isItemPinned,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMenuAnchor,
      activeFilter,
      setActiveFilter,
      filteredItems,
      filteredFolderItems,
      modals: renderModals(),
      contextMenus: renderContextMenus(),
    })
  }

  if (activeFolderId !== null) {
    return h(SidebarFolderView, {
      ctx,
      activeCollection,
      setActiveFolderId,
      handleModeChange,
      renderCreateButton,
      renderCreateMenu,
      openCollectionMenu,
      isItemPinned,
      searchOpen,
      setSearchOpen,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMenuAnchor,
      filteredFolderItems,
      modals: renderModals(),
      contextMenus: renderContextMenus(),
    })
  }

  return h(
    'section',
    {
      'aria-label': 'Library',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        padding: '12px 16px',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'hidden',
        userSelect: 'none',
      },
    },
    h(
      'header',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 6,
            transition: 'background-color 0.15s ease',
          },
          onMouseEnter: () => setIsHeaderHovered(true),
          onMouseLeave: () => setIsHeaderHovered(false),
          onClick: () => handleModeChange('collapsed'),
          title: '收起音乐库',
        },
        isHeaderHovered
          ? tablerIcon('layout-sidebar-left-collapse', { size: 26, color: '#FFFFFF' })
          : tablerIcon('books', { size: 26, color: '#A0A0AE' }),
        h(
          'span',
          {
            style: {
              fontSize: 16,
              fontWeight: 700,
              color: isHeaderHovered ? '#FFFFFF' : '#F5F5F7',
              transition: 'color 0.15s ease',
            },
          },
          '音乐库',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, position: 'relative' } },
        renderCreateButton(),
        renderCreateMenu(false),
        h(
          'button',
          {
            type: 'button',
            'aria-label': '展开音乐库',
            title: '展开音乐库',
            onClick: () => handleModeChange('expanded'),
            style: {
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: '#A0A0AE',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#FFFFFF'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#A0A0AE'
            },
          },
          tablerIcon('maximize', { size: 20 }),
        ),
      ),
    ),
    h(LibraryToolbar, {
      activeFilter,
      setActiveFilter,
      searchOpen,
      setSearchOpen,
      searchQuery,
      setSearchQuery,
      sortMode,
      setSortMenuAnchor,
    }),
    error ? h(Text, { variant: 'sm', tone: 'error', testID: 'playlists-error' }, error) : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } },
      filteredItems.length === 0
        ? h(EmptyState, {
            icon: 'music',
            title: '没有找到内容',
            description: '导入音乐源、扫描本地文件夹或调整筛选条件。',
          })
        : h(
            List<
              UnifiedItem & {
                isFolder?: boolean
                isExpanded?: boolean
                onToggleExpand?: () => void
                isChild?: boolean
              }
            >,
            {
              testID: 'playlists-list',
              items: displayItems,
              estimatedItemSize: 64,
              keyExtractor: (item) => (item.isChild ? `${item.id}:child` : item.id),
              empty: h(EmptyState, { title: 'No items yet' }),
              renderItem: (item) =>
                h(UnifiedLibraryRow, {
                  key: item.isChild ? `${item.id}:child` : item.id,
                  ctx,
                  item,
                  isFolder: item.isFolder ?? (item.kind === 'collection'),
                  isExpanded: item.isExpanded ?? expandedFolderIds.has(item.id),
                  onToggleExpand: item.onToggleExpand ?? (() => toggleFolderExpanded(item.id)),
                  isChild: item.isChild,
                }),
            },
          ),
    ),
    renderModals(),
    renderContextMenus(),
  )
}
