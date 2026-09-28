/**
 * React hooks for `@BBeBee/plugin-now-playing`.
 *
 * `useNowPlayingStyle` subscribes to the `now-playing/style-changed` event and
 * returns the current style id together with a setter. Both the desktop and
 * mobile view packages import this single hook so the preference is shared.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { NowPlayingService, NowPlayingStyleId } from '@BBeBee/protocol'
import { DEFAULT_NOW_PLAYING_STYLE } from '@BBeBee/protocol'

/**
 * Safely resolves the `nowPlaying` service from context without throwing
 * if called from a scoped context that has not declared `nowPlaying` in inject.
 */
function getNowPlayingService(ctx: Context): NowPlayingService | undefined {
  try {
    const reflect = (ctx as unknown as { reflect?: { get(key: string, required: boolean): unknown } })
      .reflect
    if (reflect && typeof reflect.get === 'function') {
      return reflect.get('nowPlaying', false) as NowPlayingService | undefined
    }
    return (ctx as unknown as { nowPlaying?: NowPlayingService }).nowPlaying
  } catch {
    return undefined
  }
}

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
    const service = getNowPlayingService(ctx)
    return service ? service.getStyle() : DEFAULT_NOW_PLAYING_STYLE
  })

  useEffect(() => {
    const service = getNowPlayingService(ctx)
    if (service) {
      setLocalStyle(service.getStyle())
    }

    const off = ctx.on('now-playing/style-changed', (id: NowPlayingStyleId) => {
      setLocalStyle(id)
    })
    return () => void off()
  }, [ctx])

  const setStyle = useCallback(
    (id: NowPlayingStyleId) => {
      const service = getNowPlayingService(ctx)
      if (service) {
        service.setStyle(id)
      }
    },
    [ctx],
  )

  return { styleId, setStyle }
}
