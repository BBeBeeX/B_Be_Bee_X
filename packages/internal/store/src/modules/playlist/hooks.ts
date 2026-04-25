import { useCallback } from "react"

import { type PlaylistModel, type PlaylistStore, usePlaylistsStore } from "./store"

export const usePlaylist = (playlistId?: string | null) => {
  return usePlaylistsStore(
    useCallback(
      (state: PlaylistStore) => {
        if (!playlistId) {
          return
        }
        return state.playlists[playlistId]
      },
      [playlistId],
    ),
  )
}

export const usePlaylists = () => {
  return usePlaylistsStore((state) =>
    state.playlistIds
      .map((id) => state.playlists[id])
      .filter((playlist): playlist is PlaylistModel => Boolean(playlist)),
  )
}

export const usePlaylistItems = (playlistId?: string | null) => {
  return usePlaylistsStore(
    useCallback(
      (state: PlaylistStore) => {
        if (!playlistId) {
          return []
        }
        return state.playlistItemsByPlaylistId[playlistId] || []
      },
      [playlistId],
    ),
  )
}
