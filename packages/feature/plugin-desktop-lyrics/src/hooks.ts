/**
 * View hooks for `ctx.desktopLyrics`.
 */

import { useCallback } from 'react'
import type { Context } from 'cordis'
import { useServiceState } from '@BBeBee/ui-core'
import type { DesktopLyricsPosition, DesktopLyricsState } from './index.js'

const DEFAULT_STATE: DesktopLyricsState = {
  visible: true,
  showNextLine: true,
  fontSize: 22,
  opacity: 0.92,
  position: { x: 0, y: 0 },
  locked: false,
}

export function useDesktopLyricsState(ctx: Context) {
  const state = useServiceState<DesktopLyricsState>(
    ctx,
    ['desktop-lyrics/changed'],
    () => ctx.desktopLyrics?.state ?? DEFAULT_STATE,
  )

  const toggleVisible = useCallback(() => {
    ctx.desktopLyrics?.toggleVisible?.()
  }, [ctx])

  const setVisible = useCallback(
    (v: boolean) => {
      ctx.desktopLyrics?.setVisible?.(v)
    },
    [ctx],
  )

  const setFontSize = useCallback(
    (size: number) => {
      ctx.desktopLyrics?.setFontSize?.(size)
    },
    [ctx],
  )

  const setOpacity = useCallback(
    (opacity: number) => {
      ctx.desktopLyrics?.setOpacity?.(opacity)
    },
    [ctx],
  )

  const setShowNextLine = useCallback(
    (show: boolean) => {
      ctx.desktopLyrics?.setShowNextLine?.(show)
    },
    [ctx],
  )

  const setPosition = useCallback(
    (pos: DesktopLyricsPosition) => {
      ctx.desktopLyrics?.setPosition?.(pos)
    },
    [ctx],
  )

  const setLocked = useCallback(
    (locked: boolean) => {
      ctx.desktopLyrics?.setLocked?.(locked)
    },
    [ctx],
  )

  return {
    ...state,
    toggleVisible,
    setVisible,
    setFontSize,
    setOpacity,
    setShowNextLine,
    setPosition,
    setLocked,
  }
}
