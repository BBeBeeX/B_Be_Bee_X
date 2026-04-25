import { initializeDB, migrateDB } from "@b_be_bee/database/db"

import type { Hydratable } from "./lib/base"
import { favoriteActions } from "./modules/favorite/store"
import { imageActions } from "./modules/image/store"
import { lyricActions } from "./modules/lyric/store"
import { playStatisticsActions } from "./modules/playStatistics/store"
import { playlistActions } from "./modules/playlist/store"
import { pluginCredentialActions } from "./modules/pluginCredential/store"
import { songActions } from "./modules/song/store"

const hydrates: Hydratable[] = [
  imageActions,
  songActions,
  playlistActions,
  favoriteActions,
  lyricActions,
  playStatisticsActions,
  pluginCredentialActions,
]

export const hydrateDatabaseToStore = async (options?: { migrateDatabase?: boolean }) => {
  if (options?.migrateDatabase) {
    await initializeDB()
    await migrateDB()
  }
  await Promise.all(hydrates.map((h) => h.hydrate()))
}
