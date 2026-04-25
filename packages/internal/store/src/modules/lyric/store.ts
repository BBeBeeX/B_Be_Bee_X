import type { LyricSchema } from "@b_be_bee/database/schemas/types"
import { LyricService } from "@b_be_bee/database/services/lyric"

import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"

export type LyricModel = LyricSchema

export type LyricStore = {
  lyricIds: string[]
  lyricIdsByTrackId: Record<string, string[]>
  lyrics: Record<string, LyricModel>
}

const defaultState: LyricStore = {
  lyricIds: [],
  lyricIdsByTrackId: {},
  lyrics: {},
}

export const useLyricsStore = createZustandStore<LyricStore>("lyrics")(() => defaultState)

const set = useLyricsStore.setState
const immerSet = createImmerSetter(useLyricsStore)

class LyricActions implements Hydratable, Resetable {
  async hydrate() {
    const lyrics = await LyricService.getAll()
    lyricActions.upsertManyInSession(lyrics)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => LyricService.reset())
    await tx.run()
  }

  upsertManyInSession(lyrics: LyricModel[]) {
    immerSet((state) => {
      for (const lyric of lyrics) {
        if (!state.lyrics[lyric.id]) {
          state.lyricIds.push(lyric.id)
        }
        state.lyrics[lyric.id] = lyric
      }

      state.lyricIdsByTrackId = {}
      for (const lyricId of state.lyricIds) {
        const lyric = state.lyrics[lyricId]
        if (!lyric) continue
        const lyricIds = state.lyricIdsByTrackId[lyric.trackId] || []
        lyricIds.push(lyric.id)
        state.lyricIdsByTrackId[lyric.trackId] = lyricIds
      }
    })
  }

  async upsert(lyric: LyricModel) {
    const tx = createTransaction()
    tx.store(() => this.upsertManyInSession([lyric]))
    tx.persist(() => LyricService.upsert(lyric))
    await tx.run()
  }

  deleteInSession(id: string) {
    immerSet((state) => {
      const lyric = state.lyrics[id]
      delete state.lyrics[id]
      state.lyricIds = state.lyricIds.filter((lyricId) => lyricId !== id)
      if (lyric) {
        state.lyricIdsByTrackId[lyric.trackId] = (state.lyricIdsByTrackId[lyric.trackId] || [])
          .filter((lyricId) => lyricId !== id)
      }
    })
  }

  async delete(id: string) {
    const tx = createTransaction()
    tx.store(() => this.deleteInSession(id))
    tx.persist(() => LyricService.delete(id))
    await tx.run()
  }
}

export const lyricActions = new LyricActions()
