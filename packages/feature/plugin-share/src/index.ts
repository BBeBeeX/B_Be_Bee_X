/**
 * @BBeBee/plugin-share
 *
 * Share service for third-party music sources, songs, playlists, and lyrics,
 * with Base64 JSON metadata and LSB image steganography.
 */

import type { Context } from "cordis"
import { Share, type ShareConfig } from "./service.js"
import { SHARE_COMMANDS } from "./views.js"

export { Share, type ShareConfig }
export * from "./steganography.js"
export * from "./metadata.js"
export * from "./views.js"
export * from "./hooks.js"

export const name = "plugin-share"

/**
 * Main plugin entry point.
 */
export async function apply(ctx: Context, config: ShareConfig = {}) {
  const fiber = await ctx.plugin(Share, config)

  // Register command when ctx.ui is available
  ctx.inject(["ui"], (innerCtx) => {
    return innerCtx.ui.contribute({
      kind: "command",
      id: SHARE_COMMANDS.openImport,
      title: "读取分享卡片",
      run: () => {
        innerCtx.share?.openImport()
      },
    })
  })

  return () => void fiber.dispose()
}

export default { name, apply }
