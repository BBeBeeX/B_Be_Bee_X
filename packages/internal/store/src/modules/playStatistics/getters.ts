import { type PlayStatisticsDetailModel, usePlayStatisticsStore } from "./store"

const get = usePlayStatisticsStore.getState

export const getPlayStatisticsSummary = (trackId: string) => get().summaries[trackId]

export const getPlayStatisticsDetails = (trackId: string) => {
  const state = get()
  return (state.detailIdsByTrackId[trackId] || [])
    .map((id) => state.details[id])
    .filter((detail): detail is PlayStatisticsDetailModel => Boolean(detail))
}
