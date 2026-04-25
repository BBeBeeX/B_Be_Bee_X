import type { TrackSchema } from "@b_be_bee/database/schemas/types"
import { TrackService } from "@b_be_bee/database/services/track"

import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"

export type SongModel = TrackSchema

export type SongStore = {
  songIds: string[]
  songs: Record<string, SongModel>
}

const defaultState: SongStore = {
  songIds: [],
  songs: {},
}

export const useSongsStore = createZustandStore<SongStore>("songs")(() => defaultState)

const set = useSongsStore.setState
const immerSet = createImmerSetter(useSongsStore)

class SongActions implements Hydratable, Resetable {
  async hydrate() {
    const songs = await TrackService.getAll()
    songActions.upsertManyInSession(songs)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => TrackService.reset())
    await tx.run()
  }

  upsertManyInSession(songs: SongModel[]) {
    immerSet((state) => {
      for (const song of songs) {
        if (!state.songs[song.id]) {
          state.songIds.push(song.id)
        }
        state.songs[song.id] = song
      }
    })
  }

  async upsertMany(songs: SongModel[]) {
    const tx = createTransaction()
    tx.store(() => this.upsertManyInSession(songs))
    tx.persist(() => TrackService.upsertMany(songs))
    await tx.run()
  }

  async upsert(song: SongModel) {
    await this.upsertMany([song])
  }

  deleteInSession(trackId: string) {
    immerSet((state) => {
      delete state.songs[trackId]
      state.songIds = state.songIds.filter((id) => id !== trackId)
    })
  }

  async delete(trackId: string) {
    const tx = createTransaction()
    tx.store(() => this.deleteInSession(trackId))
    tx.persist(() => TrackService.delete(trackId))
    await tx.run()
  }
}

export const songActions = new SongActions()
