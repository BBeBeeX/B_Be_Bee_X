import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import * as schema from "../../src/schemas"
import { resetMockDb, setMockDb } from "./db.mock"

const migrationFiles = [
  "../../src/drizzle/0000_secret_charles_xavier.sql",
  "../../src/drizzle/0001_network_proxy_settings.sql",
  "../../src/drizzle/0002_plugin_registry.sql",
  "../../src/drizzle/0003_align_database_with_models.sql",
  "../../src/drizzle/0004_add_database_sync_metadata.sql",
] as const

function applyMigrations(sqlite: Database.Database) {
  for (const relativePath of migrationFiles) {
    const content = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    const statements = content
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)

    for (const statement of statements) {
      sqlite.exec(statement)
    }
  }

  // The production schema uses an FTS virtual table, but these unit tests only
  // need a writable search side table to verify service-layer behavior.
  sqlite.exec("DROP TABLE IF EXISTS music_tracks_fts")
  sqlite.exec(`
    CREATE TABLE music_tracks_fts (
      track_id text PRIMARY KEY NOT NULL,
      title text,
      artists text,
      album text,
      creator text,
      tags text
    )
  `)
}

export interface TestDatabaseContext {
  db: ReturnType<typeof drizzle>
  sqlite: Database.Database
}

export function createTestDatabase(): TestDatabaseContext {
  const sqlite = new Database(":memory:")
  applyMigrations(sqlite)

  const db = drizzle(sqlite, {
    logger: false,
    schema,
  })

  setMockDb(db)

  return {
    db,
    sqlite,
  }
}

export function destroyTestDatabase(context: TestDatabaseContext | undefined) {
  resetMockDb()
  context?.sqlite.close()
}
