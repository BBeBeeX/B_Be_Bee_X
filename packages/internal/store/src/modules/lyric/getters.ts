import { type LyricModel, useLyricsStore } from "./store"

const get = useLyricsStore.getState

export const getLyric = (id: string) => get().lyrics[id]

export const getLyricsByTrackId = (trackId: string) => {
  const state = get()
  return (state.lyricIdsByTrackId[trackId] || [])
    .map((id) => state.lyrics[id])
    .filter((lyric): lyric is LyricModel => Boolean(lyric))
}

export const getLyricsByAudioId = getLyricsByTrackId
