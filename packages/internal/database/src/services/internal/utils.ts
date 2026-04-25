import { sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm/sql"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { getTableColumns } from "drizzle-orm/utils"

import { SyncStateEnum, type SyncState } from "../../schemas"

export function conflictUpdateAllExcept<
  T extends SQLiteTable,
  E extends (keyof T["$inferInsert"])[],
>(table: T, except: E) {
  const columns = getTableColumns(table)
  const updateColumns = Object.entries(columns).filter(
    ([col]) => !except.includes(col as keyof typeof table.$inferInsert),
  )

  return Object.fromEntries(
    updateColumns.map(([colName, table]) => [colName, sql.raw(`excluded.${table.name}`)]),
  ) as Omit<Record<keyof typeof table.$inferInsert, SQL>, E[number]>
}

export function applyLocalSyncDefaults<
  T extends {
    dirty?: boolean | null
    lastSyncedAt?: number | null
    syncState?: SyncState | null
  },
>(input: T): T {
  if (input.syncState === SyncStateEnum.localOnly) {
    return {
      ...input,
      dirty: false,
    }
  }

  if (input.syncState) {
    return input
  }

  return {
    ...input,
    dirty: true,
    syncState: SyncStateEnum.pending,
  }
}

export function markSyncSucceeded<
  T extends {
    dirty?: boolean | null
    lastSyncedAt?: number | null
    syncState?: SyncState | null
  },
>(input: T): T {
  return {
    ...input,
    dirty: false,
    syncState: SyncStateEnum.synced,
    lastSyncedAt: Date.now(),
  }
}

export function markSyncFailed<
  T extends {
    dirty?: boolean | null
    syncState?: SyncState | null
  },
>(input: T): T {
  return {
    ...input,
    dirty: true,
    syncState: SyncStateEnum.failed,
  }
}

export function markSyncConflict<
  T extends {
    dirty?: boolean | null
    syncState?: SyncState | null
  },
>(input: T): T {
  return {
    ...input,
    dirty: true,
    syncState: SyncStateEnum.conflict,
  }
}

export function escapeSqlString(value: string) {
  return value.replaceAll("'", "''")
}
