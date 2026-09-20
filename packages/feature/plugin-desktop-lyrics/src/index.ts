/**
 * `plugin-desktop-lyrics` — headless state, controls and settings for desktop floating lyrics.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { DesktopLyricsPosition, DesktopLyricsState } from '@BBeBee/protocol'

export type { DesktopLyricsPosition, DesktopLyricsState }

export class DesktopLyricsService extends Service {
  static inject = ['player']

  private readonly ownCtx: Context

  private currentState: DesktopLyricsState = {
    visible: true,
    showNextLine: true,
    fontSize: 22,
    opacity: 0.92,
    position: { x: 0, y: 0 },
    locked: false,
  }

  constructor(ctx: Context) {
    super(ctx, 'desktopLyrics')
    this.ownCtx = ctx
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-desktop-lyrics: initialized')

    // Contribute commands via ctx.ui if available
    const toggle = () => this.toggleVisible()
    this.ownCtx.inject(['ui'], (scoped) =>
      scoped.effect(function* () {
        scoped.logger.debug('desktop-lyrics: contributing commands')
        yield scoped.ui.contribute({
          kind: 'command',
          id: 'desktop-lyrics.toggle',
          title: 'Toggle desktop lyrics',
          run: toggle,
        })
      }, 'desktop-lyrics-contributions'),
    )

    return () => {
      this.ownCtx.logger.info('plugin-desktop-lyrics: disposing')
    }
  }

  get state(): Readonly<DesktopLyricsState> {
    return this.currentState
  }

  private update(patch: Partial<DesktopLyricsState>): void {
    this.currentState = { ...this.currentState, ...patch }
    this.ownCtx.emit('desktop-lyrics/changed', this.currentState)
  }

  toggleVisible(): void {
    this.setVisible(!this.currentState.visible)
  }

  setVisible(visible: boolean): void {
    this.update({ visible })
  }

  setShowNextLine(showNextLine: boolean): void {
    this.update({ showNextLine })
  }

  setFontSize(size: number): void {
    const clamped = Math.min(40, Math.max(14, size))
    this.update({ fontSize: clamped })
  }

  setOpacity(opacity: number): void {
    const clamped = Math.min(1.0, Math.max(0.2, opacity))
    this.update({ opacity: clamped })
  }

  setPosition(position: DesktopLyricsPosition): void {
    this.update({ position })
  }

  setLocked(locked: boolean): void {
    this.update({ locked })
  }
}

export const name = 'plugin-desktop-lyrics'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-desktop-lyrics: loaded')
  const fiber = await ctx.plugin(DesktopLyricsService)
  return () => {
    fiber.dispose()
  }
}

export default { name, apply }
