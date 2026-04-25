import { useCallback } from "react"

import { type LyricModel, type LyricStore, useLyricsStore } from "./store"

export const useLyric = (id?: string | null) => {
  return useLyricsStore(
    useCallback(
      (state: LyricStore) => {
        if (!id) {
          return
        }
        return state.lyrics[id]
      },
      [id],
    ),
  )
}

export const useLyricsByTrackId = (trackId?: string | null) => {
  return useLyricsStore(
    useCallback(
      (state: LyricStore) => {
        if (!trackId) {
          return []
        }
        return (state.lyricIdsByTrackId[trackId] || [])
          .map((id) => state.lyrics[id])
          .filter((lyric): lyric is LyricModel => Boolean(lyric))
      },
      [trackId],
    ),
  )
}

export const useLyricsByAudioId = useLyricsByTrackId
