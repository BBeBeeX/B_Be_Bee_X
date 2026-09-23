import { useCallback, useState } from 'react'
import type { Context } from 'cordis'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type {
  ArtworkRef,
  Collection,
  LibraryService,
  Playlist,
} from '@BBeBee/protocol'
import { anchorOf } from '../types.js'

export interface SaveToPlaylistTrack {
  urn: string
  title: string
  loved?: boolean
  artists?: readonly { name: string }[]
  artwork?: ArtworkRef | string
}

export interface SaveToPlaylistOption {
  urn: string
  name: string
  trackCount?: number
  pinned?: boolean
  artwork?: ArtworkRef
  isSmart?: boolean
  containsTrack?: boolean
}

export interface SaveToCollectionOption {
  id: string
  name: string
  playlistCount?: number
  playlists: readonly SaveToPlaylistOption[]
}

export interface SaveToPlaylistMenuController {
  open(track: SaveToPlaylistTrack, anchor?: MenuAnchor): void
  close(): void
  menuProps: {
    open: boolean
    onClose: () => void
    x: number
    y: number
    title: string
    liked: boolean
    likedCount: number
    onToggleLiked: () => Promise<void>
    playlists: readonly SaveToPlaylistOption[]
    collections: readonly SaveToCollectionOption[]
    onCreatePlaylist: (name: string, folderId?: string) => Promise<void>
    onTogglePlaylist: (playlistUrn: string, currentlyContains: boolean) => Promise<void>
  }
}

/**
 * Controller for the dedicated "Save to playlist" popover menu triggered by clicking the heart icon.
 */
export function useSaveToPlaylistMenu(ctx: Context): SaveToPlaylistMenuController {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const [active, setActive] = useState<{ track: SaveToPlaylistTrack; anchor: MenuAnchor } | undefined>(undefined)
  const [liked, setLiked] = useState(false)
  const [likedCount, setLikedCount] = useState(0)
  const [playlists, setPlaylists] = useState<readonly SaveToPlaylistOption[]>([])
  const [collections, setCollections] = useState<readonly SaveToCollectionOption[]>([])

  const open = useCallback(
    (track: SaveToPlaylistTrack, anchor?: MenuAnchor) => {
      setActive({ track, anchor: anchorOf(anchor) })
      setLiked(track.loved ?? false)

      if (!library) return

      if (typeof library.isSaved === 'function') {
        void library
          .isSaved(track.urn)
          .then((saved) => setLiked(saved || track.loved === true))
          .catch(() => {})
      }

      if (typeof library.listSaved === 'function') {
        void library
          .listSaved('track')
          .then((res) => setLikedCount(res?.total ?? res?.items?.length ?? 0))
          .catch(() => {})
      }

      void (async () => {
        try {
          const [playlistsRes, collectionsRes] = await Promise.all([
            typeof library.listPlaylists === 'function'
              ? library.listPlaylists().catch(() => ({ items: [] as Playlist[] }))
              : Promise.resolve({ items: [] as Playlist[] }),
            typeof library.listCollections === 'function'
              ? library.listCollections().catch(() => [] as Collection[])
              : Promise.resolve([] as Collection[]),
          ])

          const rawPlaylists = playlistsRes?.items ?? []
          const rawCollections = collectionsRes ?? []

          const initialOptions: SaveToPlaylistOption[] = rawPlaylists.map((p) => ({
            urn: p.urn,
            name: p.name,
            trackCount: p.trackCount,
            pinned: (p as { pinned?: boolean }).pinned,
            artwork: p.artwork,
            isSmart: p.isSmart,
            containsTrack: false,
          }))
          setPlaylists(initialOptions)

          if (rawCollections.length > 0) {
            setCollections(
              rawCollections.map((c) => ({
                id: c.id,
                name: c.name,
                playlistCount: 0,
                playlists: [],
              })),
            )
          }

          // If getPlaylist exists, check containment
          let updatedOptions = initialOptions
          if (typeof library.getPlaylist === 'function') {
            const containment = await Promise.all(
              rawPlaylists.map(async (p) => {
                try {
                  const detail = await library.getPlaylist!(p.urn)
                  const contains = detail?.items?.some((i) => i.trackUrn === track.urn) ?? false
                  return { urn: p.urn, contains }
                } catch {
                  return { urn: p.urn, contains: false }
                }
              }),
            )
            const map = new Map(containment.map((c) => [c.urn, c.contains]))
            updatedOptions = initialOptions.map((p) => ({
              ...p,
              containsTrack: map.get(p.urn) ?? p.containsTrack,
            }))
            setPlaylists(updatedOptions)
          }

          // If collections exist and listCollectionItems exists
          if (rawCollections.length > 0 && typeof library.listCollectionItems === 'function') {
            const itemsList = await Promise.all(
              rawCollections.map(async (c) => {
                try {
                  const res = await library.listCollectionItems!(c.id)
                  return { id: c.id, urns: new Set(res.items.map((i) => i.urn)) }
                } catch {
                  return { id: c.id, urns: new Set<string>() }
                }
              }),
            )
            const colMap = new Map(itemsList.map((i) => [i.id, i.urns]))
            const allColUrns = new Set(itemsList.flatMap((i) => [...i.urns]))

            setPlaylists(updatedOptions.filter((p) => !allColUrns.has(p.urn)))
            setCollections(
              rawCollections.map((c) => {
                const urns = colMap.get(c.id)
                const contained = updatedOptions.filter((p) => urns?.has(p.urn))
                return {
                  id: c.id,
                  name: c.name,
                  playlistCount: contained.length,
                  playlists: contained,
                }
              }),
            )
          }
        } catch {
          // ignore
        }
      })()
    },
    [library],
  )

  const onToggleLiked = useCallback(async () => {
    if (!active || !library) return
    const next = !liked
    setLiked(next)
    setLikedCount((prev) => (next ? prev + 1 : Math.max(0, prev - 1)))
    await library.setSaved(active.track.urn, next).catch(() => {})
  }, [active, library, liked])

  const onTogglePlaylist = useCallback(
    async (playlistUrn: string, currentlyContains: boolean) => {
      if (!active || !library) return
      const next = !currentlyContains

      setPlaylists((prev) =>
        prev.map((p) =>
          p.urn === playlistUrn
            ? { ...p, containsTrack: next, trackCount: (p.trackCount ?? 0) + (next ? 1 : -1) }
            : p,
        ),
      )
      setCollections((prev) =>
        prev.map((c) => ({
          ...c,
          playlists: c.playlists.map((p) =>
            p.urn === playlistUrn
              ? { ...p, containsTrack: next, trackCount: (p.trackCount ?? 0) + (next ? 1 : -1) }
              : p,
          ),
        })),
      )

      try {
        if (currentlyContains) {
          if (typeof library.getPlaylist === 'function') {
            const detail = await library.getPlaylist(playlistUrn)
            const itemIds = detail?.items?.filter((i) => i.trackUrn === active.track.urn).map((i) => i.id) ?? []
            if (itemIds.length && typeof library.removeItems === 'function') {
              await library.removeItems(playlistUrn, itemIds)
            }
          }
        } else {
          if (typeof library.addTracks === 'function') {
            await library.addTracks(playlistUrn, [active.track.urn])
          }
        }
      } catch {
        // ignore error
      }
    },
    [active, library],
  )

  const onCreatePlaylist = useCallback(
    async (name: string, folderId?: string) => {
      if (!active || !library || !name.trim()) return
      const trimmed = name.trim()
      try {
        const playlist = await library.createPlaylist(trimmed)
        if (folderId && typeof library.addToCollection === 'function') {
          await library.addToCollection(folderId, [playlist.urn]).catch(() => {})
        }
        if (typeof library.addTracks === 'function') {
          await library.addTracks(playlist.urn, [active.track.urn]).catch(() => {})
        }

        const newOption: SaveToPlaylistOption = {
          urn: playlist.urn,
          name: playlist.name,
          trackCount: 1,
          containsTrack: true,
          pinned: false,
          isSmart: false,
        }

        if (folderId) {
          setCollections((prev) =>
            prev.map((c) =>
              c.id === folderId
                ? {
                    ...c,
                    playlistCount: (c.playlistCount ?? 0) + 1,
                    playlists: [...c.playlists, newOption],
                  }
                : c,
            ),
          )
        } else {
          setPlaylists((prev) => [...prev, newOption])
        }
      } catch {
        // ignore error
      }
    },
    [active, library],
  )

  const close = useCallback(() => setActive(undefined), [])

  return {
    open,
    close,
    menuProps: {
      open: active !== undefined,
      onClose: close,
      x: active?.anchor.x ?? 0,
      y: active?.anchor.y ?? 0,
      title: '添加到歌单',
      liked,
      likedCount,
      onToggleLiked,
      playlists,
      collections,
      onCreatePlaylist,
      onTogglePlaylist,
    },
  }
}
