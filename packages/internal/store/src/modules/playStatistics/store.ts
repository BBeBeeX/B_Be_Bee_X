import type {
  PlayStatisticsDetailSchema,
  PlayStatisticsSummarySchema,
} from "@b_be_bee/database/schemas/types"
import { PlayStatisticsService } from "@b_be_bee/database/services/playStatistics"

import type { Hydratable, Resetable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"

export type PlayStatisticsDetailModel = PlayStatisticsDetailSchema
export type PlayStatisticsSummaryModel = PlayStatisticsSummarySchema

export type PlayStatisticsStore = {
  detailIds: string[]
  detailIdsByTrackId: Record<string, string[]>
  details: Record<string, PlayStatisticsDetailModel>
  summaries: Record<string, PlayStatisticsSummaryModel>
}

const defaultState: PlayStatisticsStore = {
  detailIds: [],
  detailIdsByTrackId: {},
  details: {},
  summaries: {},
}

export const usePlayStatisticsStore = createZustandStore<PlayStatisticsStore>(
  "playStatistics",
)(() => defaultState)

const set = usePlayStatisticsStore.setState
const immerSet = createImmerSetter(usePlayStatisticsStore)

class PlayStatisticsActions implements Hydratable, Resetable {
  async hydrate() {
    const [details, summaries] = await Promise.all([
      PlayStatisticsService.getAllDetails(),
      PlayStatisticsService.getAllSummaries(),
    ])
    playStatisticsActions.hydrateInSession(details, summaries)
  }

  async reset() {
    const tx = createTransaction()
    tx.store(() => {
      set(defaultState)
    })
    tx.persist(() => PlayStatisticsService.reset())
    await tx.run()
  }

  hydrateInSession(
    details: PlayStatisticsDetailModel[],
    summaries: PlayStatisticsSummaryModel[],
  ) {
    immerSet((state) => {
      state.detailIds = []
      state.detailIdsByTrackId = {}
      state.details = {}
      state.summaries = {}

      for (const detail of details) {
        state.detailIds.push(detail.id)
        state.details[detail.id] = detail
        const detailIds = state.detailIdsByTrackId[detail.trackId] || []
        detailIds.push(detail.id)
        state.detailIdsByTrackId[detail.trackId] = detailIds
      }

      for (const summary of summaries) {
        state.summaries[summary.trackId] = summary
      }
    })
  }

  recordPlayInSession(detail: PlayStatisticsDetailModel) {
    immerSet((state) => {
      if (!state.details[detail.id]) {
        state.detailIds.push(detail.id)
      }
      state.details[detail.id] = detail
      const detailIds = state.detailIdsByTrackId[detail.trackId] || []
      if (!detailIds.includes(detail.id)) {
        detailIds.unshift(detail.id)
      }
      state.detailIdsByTrackId[detail.trackId] = detailIds

      const summary = state.summaries[detail.trackId]
      state.summaries[detail.trackId] = summary
        ? {
            ...summary,
            lastPlayedAt: detail.playedAt,
            playCount: (summary.playCount || 0) + 1,
            totalPlayedDurationMs: (summary.totalPlayedDurationMs || 0) + detail.playedDurationMs,
          }
        : {
            trackId: detail.trackId,
            id: detail.trackId,
            lastPlayedAt: detail.playedAt,
            playCount: 1,
            totalPlayedDurationMs: detail.playedDurationMs,
          }
    })
  }

  async recordPlay(detail: PlayStatisticsDetailModel) {
    const tx = createTransaction()
    tx.store(() => this.recordPlayInSession(detail))
    tx.persist(() => PlayStatisticsService.recordPlay(detail))
    await tx.run()
  }

  upsertSummaryInSession(summary: PlayStatisticsSummaryModel) {
    immerSet((state) => {
      state.summaries[summary.trackId] = summary
    })
  }

  async upsertSummary(summary: PlayStatisticsSummaryModel) {
    const tx = createTransaction()
    tx.store(() => this.upsertSummaryInSession(summary))
    tx.persist(() => PlayStatisticsService.upsertSummary(summary))
    await tx.run()
  }
}

export const playStatisticsActions = new PlayStatisticsActions()
