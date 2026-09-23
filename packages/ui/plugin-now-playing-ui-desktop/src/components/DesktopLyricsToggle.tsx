import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DesktopLyricsService, DesktopLyricsSettings, SettingsService } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

/**
 * Toggle button for floating desktop lyrics.
 * Synchronized bidirectionally with ctx.desktopLyrics and ctx.settings.
 */
export function DesktopLyricsToggle({ ctx }: { ctx: Context }): ReactElement {
  const isVisible = useServiceState<boolean>(
    ctx,
    ['desktop-lyrics/changed', 'settings/changed'],
    () => {
      const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
      if (dl) return dl.state.visible
      const settings = serviceOf<SettingsService>(ctx, 'settings')
      return settings?.getSync()?.desktopLyrics?.enabled ?? false
    },
  )

  const handleToggle = () => {
    const service = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
    if (service) {
      service.toggleVisible()
    } else {
      const settings = serviceOf<SettingsService>(ctx, 'settings')
      if (settings) {
        const cur = settings.getSync()?.desktopLyrics
        void settings.update({
          desktopLyrics: {
            ...cur,
            enabled: !(cur?.enabled ?? false),
          } as DesktopLyricsSettings,
        })
      }
      void ctx.ui?.runCommand?.('desktop-lyrics.toggle')
    }
  }

  return h(
    'button',
    {
      type: 'button',
      'aria-label': isVisible ? '隐藏桌面歌词' : '显示桌面歌词',
      title: isVisible ? '隐藏桌面歌词' : '显示桌面歌词',
      onClick: handleToggle,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: tokens.radius.sm,
        border: isVisible ? '1px solid #A78BFA' : '1px solid rgba(255, 255, 255, 0.16)',
        background: isVisible ? 'rgba(124, 58, 237, 0.3)' : 'transparent',
        color: isVisible ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none',
        flexShrink: 0,
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isVisible ? '#A78BFA' : 'rgba(255, 255, 255, 0.4)'
        e.currentTarget.style.color = '#FFFFFF'
        e.currentTarget.style.transform = 'scale(1.05)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isVisible ? '#A78BFA' : 'rgba(255, 255, 255, 0.16)'
        e.currentTarget.style.color = isVisible ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)'
        e.currentTarget.style.transform = 'scale(1)'
      },
    },
    '词',
  )
}
