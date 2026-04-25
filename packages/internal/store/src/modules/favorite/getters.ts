import { type FavoriteModel, useFavoritesStore } from "./store"

const get = useFavoritesStore.getState

export const getFavorite = (audioId: string) => get().favorites[audioId]

export const getIsFavorite = (audioId: string) => Boolean(get().favorites[audioId])

export const getFavorites = () => {
  const state = get()
  return state.favoriteAudioIds
    .map((id) => state.favorites[id])
    .filter((favorite): favorite is FavoriteModel => Boolean(favorite))
}
