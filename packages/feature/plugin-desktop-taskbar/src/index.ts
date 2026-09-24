/**
 * `plugin-desktop-taskbar` — desktop taskbar and tray playback controls.
 *
 * Bridges `ctx.player` to the desktop host (`window.BBeBee.taskbar`):
 * - Keeps playback state in sync for Windows thumbnail toolbar buttons and the tray menu.
 * - Dispatches taskbar button actions (`togglePlay`, `previous`, `next`) to `ctx.player`.
 */

import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'

export interface TaskbarState {
  isPlaying: boolean
  canPlayOrPause: boolean
  canPrevious: boolean
  canNext: boolean
  title?: string
  artist?: string
}

export interface TaskbarBridge {
  update(state: TaskbarState): Promise<void>
  onAction(callback: (action: 'togglePlay' | 'previous' | 'next') => void): () => void
}

export const name = 'plugin-desktop-taskbar'
export const inject = ['player']

export function computeTaskbarState(ctx: Context): TaskbarState {
  const player = ctx.player
  const state = player?.state
  const queue = player?.queue ?? []
  const isPlaying = state?.status === 'playing'
  const hasCurrent = Boolean(state?.trackUrn || state?.currentItemId)
  const canPlayOrPause = Boolean(
    hasCurrent || queue.length > 0 || (state?.status && state.status !== 'idle'),
  )
  const canPrevious = Boolean(hasCurrent || queue.length > 0)
  const canNext = Boolean(hasCurrent || queue.length > 0)

  return {
    isPlaying,
    canPlayOrPause,
    canPrevious,
    canNext,
    title: state?.nowPlaying?.title,
    artist: state?.nowPlaying?.artist,
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-desktop-taskbar: loaded')

  const bridge: TaskbarBridge | undefined =
    typeof window !== 'undefined'
      ? (window as unknown as { BBeBee?: { taskbar?: TaskbarBridge } }).BBeBee?.taskbar
      : undefined

  if (!bridge) {
    ctx.logger.debug(
      'plugin-desktop-taskbar: taskbar bridge not available (non-desktop environment or testing)',
    )
    return () => {}
  }

  const sync = () => {
    try {
      const state = computeTaskbarState(ctx)
      void bridge.update(state).catch((err: unknown) => {
        ctx.logger.warn('plugin-desktop-taskbar: failed to update taskbar', err)
      })
    } catch (err: unknown) {
      ctx.logger.warn('plugin-desktop-taskbar: failed to compute taskbar state', err)
    }
  }

  // Initial sync
  sync()

  const offAction = bridge.onAction((action) => {
    ctx.logger.info('plugin-desktop-taskbar: action received: %s', action)
    if (action === 'togglePlay') {
      ctx.player.togglePlay()
    } else if (action === 'previous') {
      void ctx.player.previous().catch((err: unknown) => {
        ctx.logger.warn('plugin-desktop-taskbar: previous track failed', err)
      })
    } else if (action === 'next') {
      void ctx.player.next().catch((err: unknown) => {
        ctx.logger.warn('plugin-desktop-taskbar: next track failed', err)
      })
    }
  })

  const offState = ctx.on('player/state-changed', () => sync())
  const offTrack = ctx.on('player/track-changed', () => sync())
  const offQueue = ctx.on('queue/changed', () => sync())

  return () => {
    ctx.logger.info('plugin-desktop-taskbar: disposing')
    offAction?.()
    offState()
    offTrack()
    offQueue()
  }
}

export default { name, inject, apply }
