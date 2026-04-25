import type { DB } from "../../src/types"

let currentDb: DB

export function setMockDb(nextDb: DB) {
  currentDb = nextDb
}

export function resetMockDb() {
  currentDb = undefined as unknown as DB
}

export const sqlite = undefined

export const db = new Proxy(
  {},
  {
    get(_target, key) {
      if (!currentDb) {
        throw new Error(`Test database has not been initialized before accessing db.${String(key)}`)
      }

      return Reflect.get(currentDb as object, key)
    },
  },
) as DB

export async function initializeDB(): Promise<void> {
  throw new Error("initializeDB is not available in unit tests")
}

export async function migrateDB(): Promise<void> {
  throw new Error("migrateDB is not available in unit tests")
}

export async function getDBFile(): Promise<Blob> {
  throw new Error("getDBFile is not available in unit tests")
}

export async function exportDB(): Promise<void> {
  throw new Error("exportDB is not available in unit tests")
}

export async function deleteDB(): Promise<void> {
  throw new Error("deleteDB is not available in unit tests")
}
