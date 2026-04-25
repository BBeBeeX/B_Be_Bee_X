import { useCallback } from "react"

import {
  type PlayStatisticsDetailModel,
  type PlayStatisticsStore,
  usePlayStatisticsStore,
} from "./store"

export const usePlayStatisticsSummary = (trackId?: string | null) => {
  return usePlayStatisticsStore(
    useCallback(
      (state: PlayStatisticsStore) => {
        if (!trackId) {
          return
        }
        return state.summaries[trackId]
      },
      [trackId],
    ),
  )
}

export const usePlayStatisticsDetails = (trackId?: string | null) => {
  return usePlayStatisticsStore(
    useCallback(
      (state: PlayStatisticsStore) => {
        if (!trackId) {
          return []
        }
        return (state.detailIdsByTrackId[trackId] || [])
          .map((id) => state.details[id])
          .filter((detail): detail is PlayStatisticsDetailModel => Boolean(detail))
      },
      [trackId],
    ),
  )
}
