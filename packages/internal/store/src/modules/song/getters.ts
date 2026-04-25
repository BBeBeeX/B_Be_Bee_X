import { type SongModel, useSongsStore } from "./store"

const get = useSongsStore.getState

export const getSong = (audioId: string) => get().songs[audioId]

export const getSongs = () => {
  const state = get()
  return state.songIds
    .map((id) => state.songs[id])
    .filter((song): song is SongModel => Boolean(song))
}
