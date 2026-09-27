import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tintRgba } from './coverTheme.js'

export interface StickyDetailBarProps {
  /** The page title, shown once the bar has taken over for the hero. */
  title: string
  /** The page's primary action, riding along with the bar. */
  playButton?: ReactNode
  /** 0 — page top, 1 — fully scrolled. Every fade on the bar is a function of this. */
  progress: number
  /** The cover's dominant colour; the bar washes towards it as it lands. */
  tint?: string
  /** Right-aligned extras (shuffle, heart, …) next to the title. */
  trailing?: ReactNode
}

/**
 * The bar a detail page collapses into.
 *
 * In flow it costs nothing — `marginBottom: -64` overlays it on the hero's
 * first 64 pixels, where a transparent bar hides nothing. As the page scrolls
 * it sticks, gains an (almost opaque) background the rows slide under, and
 * the title crossfades in; `pointerEvents` follows the fade so the ghost of
 * the bar never eats a click meant for the hero.
 */
export function StickyDetailBar(props: StickyDetailBarProps): ReactElement {
  const p = Math.max(0, Math.min(1, props.progress))
  const titleOpacity = Math.max(0, (p - 0.55) / 0.45)
  const bg = props.tint
    ? `linear-gradient(${tintRgba(props.tint, 0.5)}, ${tintRgba(props.tint, 0.5)}), var(--bg-primary, #080A10)`
    : 'var(--bg-primary, #080A10)'
  return h(
    'div',
    {
      'data-testid': 'sticky-detail-bar',
      style: {
        position: 'sticky',
        top: 0,
        zIndex: 20,
        height: 64,
        marginBottom: -64,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 32px',
        background: bg,
        opacity: p,
        pointerEvents: p > 0.1 ? 'auto' : 'none',
        borderBottom: p > 0.9 ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid transparent',
      },
    },
    props.playButton ? h('div', { style: { flexShrink: 0, display: 'flex' } }, props.playButton) : null,
    h(
      'span',
      {
        style: {
          flex: 1,
          minWidth: 0,
          fontSize: 20,
          fontWeight: 700,
          color: '#FFFFFF',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: titleOpacity,
        },
      },
      props.title,
    ),
    props.trailing ?? null,
  )
}
