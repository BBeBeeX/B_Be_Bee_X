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
  switch (tone) {
    case 'muted':
      return 'var(--text-secondary, #C5CAD8)'
    case 'accent':
      return 'var(--accent, #A855F7)'
    case 'error':
      return 'var(--error, #EF4444)'
    case 'warn':
      return 'var(--warning, #F59E0B)'
    case 'ok':
      return 'var(--success, #22C55E)'
    default:
      return 'var(--text-primary, #F5F7FF)'
  }
}

export function buttonStyle(variant: ButtonVariant, disabled: boolean, hovered: boolean): CSSProperties {
  const base: CSSProperties = {
    minHeight: tokens.size.touchTarget,
    padding: `0 ${tokens.space[5]}px`,
    borderRadius: tokens.radius.pill,
    fontFamily: tokens.font.family.ui,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.bold,
    letterSpacing: 0.2,
    cursor: disabled ? 'not-allowed' : 'pointer',
    outlineColor: 'var(--border-focus, rgba(139,92,246,0.65))',
    opacity: disabled ? 0.5 : 1,
    transition: `transform ${tokens.duration.fast}ms, background-color ${tokens.duration.fast}ms, color ${tokens.duration.fast}ms, border-color ${tokens.duration.fast}ms, box-shadow ${tokens.duration.fast}ms`,
    transform: hovered && !disabled ? 'scale(1.04)' : 'scale(1)',
    border: `1px solid transparent`,
  }
  switch (variant) {
    case 'secondary':
      return {
        ...base,
        background: hovered && !disabled ? 'var(--surface-hover, #191E30)' : 'transparent',
        color: 'var(--text-primary, #F5F7FF)',
        borderColor: hovered && !disabled ? 'var(--border-hover, rgba(99,102,241,0.30))' : 'var(--border-default, rgba(148,163,184,0.14))',
      }
    case 'ghost':
      return {
        ...base,
        background: hovered && !disabled ? 'var(--surface-hover, #191E30)' : 'transparent',
        color: hovered && !disabled ? 'var(--text-primary, #F5F7FF)' : 'var(--text-secondary, #C5CAD8)',
        transform: 'scale(1)',
      }
    case 'danger':
      return { ...base, background: 'var(--error, #EF4444)', color: '#FFFFFF' }
    default:
      return {
        ...base,
        background: hovered && !disabled ? 'var(--primary-hover, #818CF8)' : 'var(--primary, #6366F1)',
        color: 'var(--text-primary, #F5F7FF)',
        boxShadow: hovered && !disabled ? 'var(--glow-sm, 0 0 10px rgba(99,102,241,0.16))' : 'none',
      }
  }
}

/** Pointer-over state, since this kit styles inline and has no `:hover`. */
export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hovered, setHovered] = useState(false)
  return [hovered, { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }]
}
