import { asc, eq } from "drizzle-orm"

import { db } from "../db"
import { playbackQueueItemsTable, playbackQueuesTable } from "../schemas"
import type { PlaybackQueueItemSchema, PlaybackQueueSchema } from "../schemas/types"
import type { Resetable } from "./internal/base"
import { applyLocalSyncDefaults, conflictUpdateAllExcept } from "./internal/utils"

const ACTIVE_QUEUE_ID = "active"

class PlaybackQueueServiceStatic implements Resetable {
  async reset() {
    await db.delete(playbackQueueItemsTable).execute()
    await db.delete(playbackQueuesTable).execute()
  }

  async saveActiveQueue(queue: PlaybackQueueSchema, items: PlaybackQueueItemSchema[]) {
    const queueRow = applyLocalSyncDefaults({
      ...queue,
      id: ACTIVE_QUEUE_ID,
    })

    await db
      .insert(playbackQueuesTable)
      .values(queueRow)
      .onConflictDoUpdate({
        target: [playbackQueuesTable.id],
        set: conflictUpdateAllExcept(playbackQueuesTable, ["id"]),
      })

    await db.delete(playbackQueueItemsTable).where(eq(playbackQueueItemsTable.queueId, ACTIVE_QUEUE_ID))

    if (items.length === 0) return

    await db
      .insert(playbackQueueItemsTable)
      .values(
        items.map((item) =>
          applyLocalSyncDefaults({
            ...item,
            queueId: ACTIVE_QUEUE_ID,
          }),
        ),
      )
      .onConflictDoUpdate({
        target: [playbackQueueItemsTable.queueId, playbackQueueItemsTable.position],
        set: conflictUpdateAllExcept(playbackQueueItemsTable, ["queueId", "position"]),
      })
  }

  getActiveQueue() {
    return db.query.playbackQueuesTable.findFirst({
      where: eq(playbackQueuesTable.id, ACTIVE_QUEUE_ID),
    })
  }

  getActiveQueueItems() {
    return db.query.playbackQueueItemsTable.findMany({
      where: eq(playbackQueueItemsTable.queueId, ACTIVE_QUEUE_ID),
      orderBy: [asc(playbackQueueItemsTable.position)],
    })
  }
}

export const PlaybackQueueService = new PlaybackQueueServiceStatic()
