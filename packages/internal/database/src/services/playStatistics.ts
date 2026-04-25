import { desc, eq } from "drizzle-orm"

import { db } from "../db"
import { playStatisticsDetailsTable, playStatisticsSummariesTable } from "../schemas"
import type { PlayStatisticsDetailSchema, PlayStatisticsSummarySchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { conflictUpdateAllExcept } from "./internal/utils"

class PlayStatisticsServiceStatic implements Resetable {
  async reset() {
    await db.delete(playStatisticsDetailsTable).execute()
    await db.delete(playStatisticsSummariesTable).execute()
  }

  async recordPlay(detail: PlayStatisticsDetailSchema) {
    await db.insert(playStatisticsDetailsTable).values(detail)

    const existing = await db.query.playStatisticsSummariesTable.findFirst({
      where: eq(playStatisticsSummariesTable.trackId, detail.trackId),
    })

    if (existing) {
      await db
        .update(playStatisticsSummariesTable)
        .set({
          playCount: existing.playCount + 1,
          totalPlayedDurationMs: existing.totalPlayedDurationMs + detail.playedDurationMs,
          lastPlayedAt: detail.playedAt,
        })
        .where(eq(playStatisticsSummariesTable.trackId, detail.trackId))
      return
    }

    await db.insert(playStatisticsSummariesTable).values({
      id: detail.trackId,
      trackId: detail.trackId,
      playCount: 1,
      totalPlayedDurationMs: detail.playedDurationMs,
      lastPlayedAt: detail.playedAt,
    })
  }

  async upsertSummary(summary: PlayStatisticsSummarySchema) {
    await db
      .insert(playStatisticsSummariesTable)
      .values(summary)
      .onConflictDoUpdate({
        target: [playStatisticsSummariesTable.trackId],
        set: conflictUpdateAllExcept(playStatisticsSummariesTable, ["id"]),
      })
  }

  getDetails(trackId: string) {
    return db.query.playStatisticsDetailsTable.findMany({
      where: eq(playStatisticsDetailsTable.trackId, trackId),
      orderBy: [desc(playStatisticsDetailsTable.playedAt)],
    })
  }

  getSummary(trackId: string) {
    return db.query.playStatisticsSummariesTable.findFirst({
      where: eq(playStatisticsSummariesTable.trackId, trackId),
    })
  }

  getAllDetails() {
    return db.query.playStatisticsDetailsTable.findMany({
      orderBy: [desc(playStatisticsDetailsTable.playedAt)],
    })
  }

  getAllSummaries() {
    return db.query.playStatisticsSummariesTable.findMany()
  }
}

export const PlayStatisticsService = new PlayStatisticsServiceStatic()
