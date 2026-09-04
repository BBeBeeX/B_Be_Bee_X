/**
 * The props both kits accept.
 *
 * Written once, in the contract layer, so `Button` on desktop and `Button` on
 * mobile cannot drift into different shapes — the drift that would make every
 * plugin author pay twice, forever (docs/08 §6).
 *
 * These are *types only*: no React import, no platform import, so both kits
 * and the parity gate can read them.
 */

import type { ArtworkRef, Track } from '@BBeBee/protocol'

/** On every component, so a caller never has to ask which ones take them. */
export interface CommonProps {
  /** One name for both platforms; each kit maps it to its own attribute. */
  testID?: string
  /**
   * The accessible name. Written once here and mapped to `aria-label` or
   * `accessibilityLabel` by the kit, because docs/08 §8 makes it mandatory on
   * every interactive element and a per-component decision gets forgotten.
   */
  accessibilityLabel?: string
}

export type Tone = 'default' | 'muted' | 'accent' | 'error' | 'warn' | 'ok'
export type TextVariant = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'display'
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends CommonProps {
  children: unknown
  /** Not `onClick`: one name across the kits, and a tap is not a click. */
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  /** Shows progress *and* disables. Two props would drift apart. */
  loading?: boolean
}

export interface IconButtonProps extends CommonProps {
  icon: string
  onPress: () => void
  /** Required: an icon has no text to fall back on (docs/08 §8). */
  accessibilityLabel: string
  variant?: ButtonVariant
  disabled?: boolean
  size?: number
}

export interface TrackRowProps extends CommonProps {
  track: Track
  onPress?: () => void
  /** Overflow. Desktop also binds right-click; mobile a long-press. */
  onMore?: () => void
  /** This is the *playing* track, which is not the same as selected. */
  active?: boolean
  showArtwork?: boolean
  showAlbum?: boolean
}

export interface SliderProps extends CommonProps {
  value: number
  max: number
  /** While dragging. */
  onChange?: (value: number) => void
  /**
   * On release. Seeking on every frame of a drag is what makes a scrubber
   * unusable, so the two are separate and callers seek here.
   */
  onCommit?: (value: number) => void
  disabled?: boolean
}

export interface SheetProps extends CommonProps {
  open: boolean
  onClose: () => void
  title?: string
  children?: unknown
}

export interface ListProps<T> extends CommonProps {
  items: readonly T[]
  renderItem: (item: T, index: number) => unknown
  /** A 100k-track library needs stable keys or every scroll re-mounts rows. */
  keyExtractor: (item: T, index: number) => string
  /** Both virtualisers want it, and neither should have to guess. */
  estimatedItemSize?: number
  onEndReached?: () => void
  /** What to show instead of nothing. */
  empty?: unknown
}

export interface EmptyStateProps extends CommonProps {
  title: string
  description?: string
  action?: unknown
  icon?: string
}

export interface ToastProps extends CommonProps {
  message: string
  tone?: 'info' | 'ok' | 'warn' | 'error'
  action?: unknown
  onDismiss?: () => void
}

export interface TextProps extends CommonProps {
  children?: unknown
  /** Names a scale entry; a raw pixel size is never passed. */
  variant?: TextVariant
  tone?: Tone
  numberOfLines?: number
}

export interface ArtworkProps extends CommonProps {
  artwork?: ArtworkRef
  size: number
  radius?: number
}
