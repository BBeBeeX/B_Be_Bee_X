import { type PlaylistModel, usePlaylistsStore } from "./store"

const get = usePlaylistsStore.getState

export const getPlaylist = (playlistId: string) => get().playlists[playlistId]

export const getPlaylists = () => {
  const state = get()
  return state.playlistIds
    .map((id) => state.playlists[id])
    .filter((playlist): playlist is PlaylistModel => Boolean(playlist))
}

export const getPlaylistItems = (playlistId: string) => {
  return get().playlistItemsByPlaylistId[playlistId] || []
}
