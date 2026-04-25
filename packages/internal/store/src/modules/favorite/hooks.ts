import { useCallback } from "react"

import { type FavoriteModel, type FavoriteStore, useFavoritesStore } from "./store"

export const useFavorite = (audioId?: string | null) => {
  return useFavoritesStore(
    useCallback(
      (state: FavoriteStore) => {
        if (!audioId) {
          return
        }
        return state.favorites[audioId]
      },
      [audioId],
    ),
  )
}

export const useIsFavorite = (audioId?: string | null) => {
  return useFavoritesStore(
    useCallback(
      (state: FavoriteStore) => {
        if (!audioId) {
          return false
        }
        return Boolean(state.favorites[audioId])
      },
      [audioId],
    ),
  )
}

export const useFavorites = () => {
  return useFavoritesStore((state) =>
    state.favoriteAudioIds
      .map((id) => state.favorites[id])
      .filter((favorite): favorite is FavoriteModel => Boolean(favorite)),
  )
}
