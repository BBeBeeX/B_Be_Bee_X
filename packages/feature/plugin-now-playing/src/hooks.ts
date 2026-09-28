/**
 * React hooks for `@BBeBee/plugin-now-playing`.
 *
 * `useNowPlayingStyle` subscribes to the `now-playing/style-changed` event and
 * returns the current style id together with a setter. Both the desktop and
 * mobile view packages import this single hook so the preference is shared.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { NowPlayingStyleId } from '@BBeBee/protocol'
import { DEFAULT_NOW_PLAYING_STYLE } from '@BBeBee/protocol'

/**
 * Read and write the now-playing layout style preference.
 *
 * The style id is managed by `ctx.nowPlaying` and broadcast via `now-playing/style-changed`.
 */
export function useNowPlayingStyle(ctx: Context): {
  styleId: NowPlayingStyleId
  setStyle: (id: NowPlayingStyleId) => void
} {
  const [styleId, setLocalStyle] = useState<NowPlayingStyleId>(() => {
    return ctx.nowPlaying ? ctx.nowPlaying.getStyle() : DEFAULT_NOW_PLAYING_STYLE
  })

  useEffect(() => {
    if (ctx.nowPlaying) {
      setLocalStyle(ctx.nowPlaying.getStyle())
    }

    const off = ctx.on('now-playing/style-changed', (id: NowPlayingStyleId) => {
      setLocalStyle(id)
    })
    return () => void off()
  }, [ctx])

  const setStyle = useCallback(
    (id: NowPlayingStyleId) => {
      if (ctx.nowPlaying) {
        ctx.nowPlaying.setStyle(id)
      }
    },
    [ctx],
  )

  return { styleId, setStyle }
}
