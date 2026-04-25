import type { FavoriteSchema } from "@b_be_bee/database/schemas/types"
import { FavoriteService } from "@b_be_bee/database/services/favorite"

import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"

export type FavoriteModel = FavoriteSchema

export type FavoriteStore = {
  favoriteAudioIds: string[]
  favorites: Record<string, FavoriteModel>
}

const defaultState: FavoriteStore = {
  favoriteAudioIds: [],
  favorites: {},
}

export const useFavoritesStore = createZustandStore<FavoriteStore>("favorites")(() => defaultState)

const set = useFavoritesStore.setState
const immerSet = createImmerSetter(useFavoritesStore)

class FavoriteActions implements Hydratable, Resetable {
  async hydrate() {
    const favorites = await FavoriteService.getAll()
    favoriteActions.upsertManyInSession(favorites)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => FavoriteService.reset())
    await tx.run()
  }

  upsertManyInSession(favorites: FavoriteModel[]) {
    immerSet((state) => {
      for (const favorite of favorites) {
        if (!state.favorites[favorite.audioId]) {
          state.favoriteAudioIds.push(favorite.audioId)
        }
        state.favorites[favorite.audioId] = favorite
      }
    })
  }

  async add(favorite: FavoriteModel) {
    const tx = createTransaction()
    tx.store(() => this.upsertManyInSession([favorite]))
    tx.persist(() => FavoriteService.add(favorite))
    await tx.run()
  }

  removeInSession(audioId: string) {
    immerSet((state) => {
      delete state.favorites[audioId]
      state.favoriteAudioIds = state.favoriteAudioIds.filter((id) => id !== audioId)
    })
  }

  async remove(audioId: string) {
    const tx = createTransaction()
    tx.store(() => this.removeInSession(audioId))
    tx.persist(() => FavoriteService.remove(audioId))
    await tx.run()
  }
}

export const favoriteActions = new FavoriteActions()
