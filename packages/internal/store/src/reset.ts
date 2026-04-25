import type { Resetable } from "./lib/base"
import { favoriteActions } from "./modules/favorite/store"
import { imageActions } from "./modules/image/store"
import { lyricActions } from "./modules/lyric/store"
import { playStatisticsActions } from "./modules/playStatistics/store"
import { playlistActions } from "./modules/playlist/store"
import { pluginCredentialActions } from "./modules/pluginCredential/store"
import { songActions } from "./modules/song/store"

const resets: Resetable[] = [
  imageActions,
  songActions,
  playlistActions,
  favoriteActions,
  lyricActions,
  playStatisticsActions,
  pluginCredentialActions,
]

export const resetStore = async () => {
  await Promise.all(resets.map((h) => h.reset()))
}
