import { useCallback, useMemo, useState } from 'react'
import type { Context } from 'cordis'
import type { LibraryService, SourcesService, Track } from '@BBeBee/protocol'
import { usePlaylists, useSaved } from '@BBeBee/plugin-library/hooks'
import type { MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import { useSaveToPlaylistMenu } from '@BBeBee/ui-menus'

export function useTrackLibraryInfo(ctx: Context) {
  const library = serviceOf<LibraryService>(ctx, 'library')
  const sources = serviceOf<SourcesService>(ctx, 'sources')
  const savedTracks = useSaved(ctx, 'track')
  const playlists = usePlaylists(ctx)
  const saveToPlaylistMenu = useSaveToPlaylistMenu(ctx)
  const [activeTrack, setActiveTrack] = useState<Track | null>(null)

  const savedTrackUrns = useMemo(() => {
    return new Set(savedTracks.data?.map((e) => e.urn) ?? [])
  }, [savedTracks.data])

  const isTrackInLibrary = useCallback(
    (track: Track, alwaysInLibrary = false): boolean => {
      if (alwaysInLibrary) return true
      if (track.loved) return true
      if (savedTrackUrns.has(track.urn)) return true
      return false
    },
    [savedTrackUrns],
  )

  const handleAddToFavorites = useCallback(
    async (track: Track) => {
      if (!library) return
      await library.setSaved(track.urn, true)
      if (sources?.setLoved) {
        await sources.setLoved(track.urn, true).catch(() => {})
      }
    },
    [library, sources],
  )

  const openAddToPlaylistMenu = useCallback((track: Track, anchor: MenuAnchor) => {
    setActiveTrack(track)
    saveToPlaylistMenu.open(track, anchor)
  }, [saveToPlaylistMenu])

  const closeAddToPlaylistMenu = useCallback(() => {
    setActiveTrack(null)
    saveToPlaylistMenu.close()
  }, [saveToPlaylistMenu])

  const addToPlaylistMenuItems = useMemo((): MenuItemSpec[] => {
    if (!saveToPlaylistMenu.menuProps.open || !activeTrack || !library) return []
    const track = activeTrack
    const list = playlists.data ?? []
    const items: MenuItemSpec[] = [
      {
        id: 'create-new-playlist',
        label: '新建歌单',
        icon: '＋',
        onSelect: async () => {
          const name = window.prompt('歌单名称：')
          if (name && name.trim()) {
            const p = await library.createPlaylist(name.trim())
            if (p) await library.addTracks(p.urn, [track.urn])
          }
        },
        divider: list.length > 0,
      },
      ...list.map((playlist) => ({
        id: playlist.urn,
        label: playlist.name,
        icon: '♪',
        disabled: playlist.isSmart,
        onSelect: async () => {
          await library.addTracks(playlist.urn, [track.urn])
        },
      })),
    ]
    return items
  }, [saveToPlaylistMenu.menuProps.open, activeTrack, library, playlists.data])

  return {
    isTrackInLibrary,
    handleAddToFavorites,
    openAddToPlaylistMenu,
    closeAddToPlaylistMenu,
    addToPlaylistMenuState: saveToPlaylistMenu.menuProps.open && activeTrack
      ? { track: activeTrack, anchor: { x: saveToPlaylistMenu.menuProps.x, y: saveToPlaylistMenu.menuProps.y } }
      : null,
    addToPlaylistMenuItems,
    saveToPlaylistMenuProps: saveToPlaylistMenu.menuProps,
  }
}

