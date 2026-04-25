import { useCallback } from "react"

import { type SongModel, type SongStore, useSongsStore } from "./store"

export const useSong = (audioId?: string | null) => {
  return useSongsStore(
    useCallback(
      (state: SongStore) => {
        if (!audioId) {
          return
        }
        return state.songs[audioId]
      },
      [audioId],
    ),
  )
}

export const useSongs = () => {
  return useSongsStore((state) =>
    state.songIds
      .map((id) => state.songs[id])
      .filter((song): song is SongModel => Boolean(song)),
  )
}
