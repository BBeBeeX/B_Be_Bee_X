import { useState } from 'react'
import type { CSSProperties } from 'react'
import { palettes, tokens, type Palette, type Scheme } from '@BBeBee/ui-tokens'
import type { ButtonVariant, Tone } from '@BBeBee/ui-core'

let scheme: Scheme = 'dark'
export const c = (): Palette => palettes[scheme]

export function setScheme(next: Scheme): void {
  scheme = next
}

/** Common attributes, mapped to the DOM's spelling of them. */
export function common(props: { testID?: string; accessibilityLabel?: string }) {
  return {
    'data-testid': props.testID,
    'aria-label': props.accessibilityLabel,
  }
}

export const toneColor = (tone: Tone | undefined): string => {
  const p = c()
  switch (tone) {
    case 'muted':
      return p.text.secondary
    case 'accent':
      return p.accent.base
    case 'error':
      return p.state.error
    case 'warn':
      return p.state.warn
    case 'ok':
      return p.state.ok
    default:
      return p.text.primary
  }
}

export function buttonStyle(variant: ButtonVariant, disabled: boolean, hovered: boolean): CSSProperties {
  const p = c()
  const base: CSSProperties = {
    minHeight: tokens.size.touchTarget,
    padding: `0 ${tokens.space[5]}px`,
    borderRadius: tokens.radius.pill,
    fontFamily: tokens.font.family.ui,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.bold,
    letterSpacing: 0.2,
    cursor: disabled ? 'not-allowed' : 'pointer',
    outlineColor: p.border.strong,
    opacity: disabled ? 0.5 : 1,
    transition: `transform ${tokens.duration.fast}ms, background-color ${tokens.duration.fast}ms, color ${tokens.duration.fast}ms, border-color ${tokens.duration.fast}ms`,
    transform: hovered && !disabled ? 'scale(1.04)' : 'scale(1)',
    border: `1px solid transparent`,
  }
  switch (variant) {
    case 'secondary':
      return {
        ...base,
        background: 'transparent',
        color: p.text.primary,
        borderColor: hovered && !disabled ? p.text.primary : p.border.strong,
      }
    case 'ghost':
      return {
        ...base,
        background: 'transparent',
        color: hovered && !disabled ? p.text.primary : p.text.secondary,
        transform: 'scale(1)',
      }
    case 'danger':
      return { ...base, background: p.state.error, color: p.bg.sunken }
    default:
      return {
        ...base,
        background: hovered && !disabled ? p.accent.hover : p.accent.base,
        color: p.accent.on,
      }
  }
}

/** Pointer-over state, since this kit styles inline and has no `:hover`. */
export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hovered, setHovered] = useState(false)
  return [hovered, { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }]
}
