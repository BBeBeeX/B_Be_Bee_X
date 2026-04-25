import type { CollectionItemSchema, CollectionSchema } from "@b_be_bee/database/schemas/types"
import { CollectionService } from "@b_be_bee/database/services/collection"

import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"

export type PlaylistModel = CollectionSchema
export type PlaylistItemModel = CollectionItemSchema

export type PlaylistStore = {
  playlistIds: string[]
  playlistItemsByPlaylistId: Record<string, PlaylistItemModel[]>
  playlists: Record<string, PlaylistModel>
}

const defaultState: PlaylistStore = {
  playlistIds: [],
  playlistItemsByPlaylistId: {},
  playlists: {},
}

export const usePlaylistsStore = createZustandStore<PlaylistStore>("playlists")(() => defaultState)

const set = usePlaylistsStore.setState
const immerSet = createImmerSetter(usePlaylistsStore)

const sortPlaylistItems = (items: PlaylistItemModel[]) => {
  return [...items].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

class PlaylistActions implements Hydratable, Resetable {
  async hydrate() {
    const [playlists, items] = await Promise.all([
      CollectionService.getAllCollections(),
      CollectionService.getAllCollectionItems(),
    ])
    playlistActions.hydrateInSession(playlists, items)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => CollectionService.reset())
    await tx.run()
  }

  hydrateInSession(playlists: PlaylistModel[], items: PlaylistItemModel[]) {
    immerSet((state) => {
      state.playlistIds = []
      state.playlists = {}
      state.playlistItemsByPlaylistId = {}

      for (const playlist of playlists) {
        state.playlistIds.push(playlist.id)
        state.playlists[playlist.id] = playlist
      }

      for (const item of items) {
        const playlistItems = state.playlistItemsByPlaylistId[item.collectionId] || []
        playlistItems.push(item)
        state.playlistItemsByPlaylistId[item.collectionId] = playlistItems
      }

      for (const playlistId of Object.keys(state.playlistItemsByPlaylistId)) {
        const playlistItems = state.playlistItemsByPlaylistId[playlistId] || []
        state.playlistItemsByPlaylistId[playlistId] = sortPlaylistItems(playlistItems)
      }
    })
  }

  savePlaylistWithItemsInSession(playlist: PlaylistModel, items: PlaylistItemModel[]) {
    immerSet((state) => {
      if (!state.playlists[playlist.id]) {
        state.playlistIds.push(playlist.id)
      }
      state.playlists[playlist.id] = playlist
      state.playlistItemsByPlaylistId[playlist.id] = sortPlaylistItems(items)
    })
  }

  async savePlaylistWithItems(playlist: PlaylistModel, items: PlaylistItemModel[]) {
    const tx = createTransaction()
    tx.store(() => this.savePlaylistWithItemsInSession(playlist, items))
    tx.persist(() => CollectionService.saveCollectionWithItems(playlist, items))
    await tx.run()
  }

  deletePlaylistInSession(playlistId: string) {
    immerSet((state) => {
      delete state.playlists[playlistId]
      delete state.playlistItemsByPlaylistId[playlistId]
      state.playlistIds = state.playlistIds.filter((id) => id !== playlistId)
    })
  }

  async deletePlaylist(playlistId: string) {
    const tx = createTransaction()
    tx.store(() => this.deletePlaylistInSession(playlistId))
    tx.persist(() => CollectionService.deleteCollection(playlistId))
    await tx.run()
  }

  removeItemInSession(playlistId: string, itemId: string) {
    immerSet((state) => {
      const items = state.playlistItemsByPlaylistId[playlistId] || []
      state.playlistItemsByPlaylistId[playlistId] = items.filter((item) => item.itemId !== itemId)
    })
  }

  async removeItem(playlistId: string, itemId: string) {
    const tx = createTransaction()
    tx.store(() => this.removeItemInSession(playlistId, itemId))
    tx.persist(() => CollectionService.removeItem(playlistId, itemId))
    await tx.run()
  }
}

export const playlistActions = new PlaylistActions()
