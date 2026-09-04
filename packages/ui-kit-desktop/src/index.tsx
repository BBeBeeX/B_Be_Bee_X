/**
 * `@BBeBee/ui-kit-desktop` - the parity component set, React DOM.
 *
 * Every component here has a twin in `ui-kit-mobile` with the same name and
 * the same props; `ui-parity` fails the build if they diverge. A plugin author
 * writing both view packages should be transcribing, not redesigning.
 *
 * Colours and scales come from `ui-tokens` and are never written inline: the
 * two kits look like one product because they read the same numbers, not
 * because someone matched them by eye.
 *
 * ⚠️ This package may import `react-dom`; it may not touch a platform
 * capability (docs/02 1). If a component here needs the filesystem, the
 * component is at the wrong altitude.
 */

import { createElement as h, useCallback, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { palettes, tokens, type Scheme } from '@BBeBee/ui-tokens'
import type {
  ArtworkProps,
  ButtonProps,
  ButtonVariant,
  EmptyStateProps,
  IconButtonProps,
  ListProps,
  SheetProps,
  SliderProps,
  TextProps,
  Tone,
  ToastProps,
  TrackRowProps,
} from '@BBeBee/ui-core'

export * from './manifest.js'

/**
 * The palette this kit paints with.
 *
 * Dark by default because that is the mode a music player is used in. The
 * shell swaps it by setting the CSS custom properties from
 * `cssVariables(scheme)`; this constant is the fallback for a component
 * rendered outside one.
 */
let scheme: Scheme = 'dark'
const c = () => palettes[scheme]

/** Set by the shell at boot. Not state a component may reach for. */
export function setScheme(next: Scheme): void {
  scheme = next
}

/** Common attributes, mapped to the DOM's spelling of them. */
function common(props: { testID?: string; accessibilityLabel?: string }) {
  return {
    'data-testid': props.testID,
    'aria-label': props.accessibilityLabel,
  }
}

const toneColor = (tone: Tone | undefined): string => {
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

function buttonStyle(variant: ButtonVariant, disabled: boolean): CSSProperties {
  const p = c()
  const base: CSSProperties = {
    minHeight: tokens.size.touchTarget,
    padding: `0 ${tokens.space[4]}px`,
    borderRadius: tokens.radius.md,
    fontFamily: tokens.font.family.ui,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.medium,
    cursor: disabled ? 'not-allowed' : 'pointer',
    // Never `outline: none`. Keyboard users lose the focus ring, which
    // docs/08 8 requires to be visible.
    outlineColor: p.border.strong,
    opacity: disabled ? 0.5 : 1,
    transitionDuration: `${tokens.duration.fast}ms`,
    border: `1px solid transparent`,
  }
  switch (variant) {
    case 'secondary':
      return { ...base, background: p.bg.raised, color: p.text.primary, borderColor: p.border.strong }
    case 'ghost':
      return { ...base, background: 'transparent', color: p.text.primary }
    case 'danger':
      return { ...base, background: p.state.error, color: p.bg.base }
    default:
      return { ...base, background: p.accent.base, color: p.accent.on }
  }
}

export function Button(props: ButtonProps) {
  const { variant = 'primary', disabled = false, loading = false } = props
  // `loading` disables as well as showing progress: a second press during a
  // request is the classic double-submit.
  const off = disabled || loading
  return h(
    'button',
    {
      ...common(props),
      type: 'button',
      disabled: off,
      'aria-busy': loading || undefined,
      onClick: off ? undefined : props.onPress,
      style: buttonStyle(variant, off),
    },
    loading ? '…' : (props.children as ReactNode),
  )
}

export function IconButton(props: IconButtonProps): ReactElement {
  const { variant = 'ghost', disabled = false, size = tokens.size.icon } = props
  return h(
    'button',
    {
      ...common(props),
      type: 'button',
      disabled,
      onClick: disabled ? undefined : props.onPress,
      style: {
        ...buttonStyle(variant, disabled),
        width: tokens.size.touchTarget,
        minHeight: tokens.size.touchTarget,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size,
      },
    },
    props.icon,
  )
}

export function Text(props: TextProps) {
  const { variant = 'md' } = props
  return h(
    'span',
    {
      ...common(props),
      style: {
        fontFamily: tokens.font.family.ui,
        fontSize: tokens.font.size[variant],
        lineHeight: tokens.font.lineHeight.normal,
        color: toneColor(props.tone),
        display: props.numberOfLines ? '-webkit-box' : undefined,
        WebkitLineClamp: props.numberOfLines,
        WebkitBoxOrient: props.numberOfLines ? ('vertical' as const) : undefined,
        overflow: props.numberOfLines ? 'hidden' : undefined,
      },
    },
    props.children as ReactNode,
  )
}

export function Artwork(props: ArtworkProps) {
  const { size, radius = tokens.radius.sm } = props
  const uri = props.artwork?.sourceUrl
  // The blurhash is the *background*, so it shows while the image loads and
  // there is no grey flash and no layout shift on scroll (docs/08 4).
  return h(
    'div',
    {
      ...common(props),
      style: {
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        flexShrink: 0,
        background: props.artwork?.dominantColor ?? c().bg.overlay,
      },
    },
    uri
      ? h('img', {
          src: uri,
          alt: '',
          loading: 'lazy',
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
        })
      : null,
  )
}

export function TrackRow(props: TrackRowProps) {
  const { active = false, showArtwork = true, showAlbum = false } = props
  const p = c()
  const artists = props.track.artists?.map((a) => a.name).join(', ')
  return h(
    'div',
    {
      ...common(props),
      role: 'row',
      tabIndex: 0,
      onClick: props.onPress,
      // Right-click is the desktop half of `onMore`; mobile uses a long press.
      onContextMenu: props.onMore
        ? (event: { preventDefault(): void }) => {
            event.preventDefault()
            props.onMore?.()
          }
        : undefined,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Enter' || event.key === ' ') props.onPress?.()
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        cursor: props.onPress ? 'pointer' : 'default',
        color: active ? p.accent.base : p.text.primary,
        background: active ? p.accent.muted : 'transparent',
      },
    },
    showArtwork
      ? h(Artwork, { artwork: props.track.artwork, size: tokens.size.artworkThumb })
      : null,
    h(
      'div',
      { style: { flex: 1, minWidth: 0, overflow: 'hidden' } },
      h(Text, { numberOfLines: 1, children: props.track.title }),
      artists ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: artists }) : null,
    ),
    showAlbum && props.track.albumTitle
      ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: props.track.albumTitle })
      : null,
    props.onMore
      ? h(IconButton, { icon: '⋯', accessibilityLabel: 'More', onPress: props.onMore })
      : null,
  )
}

export function Slider(props: SliderProps) {
  const { disabled = false } = props
  // Track the drag locally so the thumb follows the pointer even while the
  // caller is still on the previous value.
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const value = dragging ?? props.value

  const commit = useCallback(
    (next: number) => {
      setDragging(undefined)
      props.onCommit?.(next)
    },
    [props],
  )

  return h('input', {
    ...common(props),
    type: 'range',
    min: 0,
    max: props.max,
    value,
    disabled,
    'aria-valuenow': value,
    'aria-valuemax': props.max,
    onChange: (event: { target: { value: string } }) => {
      const next = Number(event.target.value)
      setDragging(next)
      props.onChange?.(next)
    },
    // Release, not every frame: seeking per frame is what makes a scrubber
    // unusable, and it is the difference `onCommit` exists to express.
    onPointerUp: () => commit(value),
    onKeyUp: () => commit(value),
    onBlur: () => setDragging(undefined),
    style: { width: '100%', accentColor: c().accent.base },
  })
}

export function Sheet(props: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  if (!props.open) return null
  const p = c()
  return h(
    'div',
    {
      ...common(props),
      role: 'dialog',
      'aria-modal': true,
      ref,
      // Escape closes every overlay (docs/08 8).
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Escape') props.onClose()
      },
      style: {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        zIndex: tokens.z.overlay,
      },
      onClick: props.onClose,
    },
    h(
      'div',
      {
        // A click inside must not close it; only the backdrop does.
        onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
        style: {
          minWidth: 320,
          maxWidth: 560,
          padding: tokens.space[5],
          borderRadius: tokens.radius.lg,
          background: p.bg.raised,
          color: p.text.primary,
        },
      },
      props.title ? h('h2', { style: { margin: `0 0 ${tokens.space[3]}px` } }, props.title) : null,
      props.children as ReactNode,
    ),
  )
}

export function List<T>(props: ListProps<T>) {
  // Virtualisation lands with the first screen that needs it; the contract is
  // what matters now, and a plain map is honest about what this does today.
  if (props.items.length === 0 && props.empty !== undefined) {
    return h('div', common(props), props.empty as ReactNode)
  }
  return h(
    'div',
    { ...common(props), role: 'list', style: { overflowY: 'auto' } },
    props.items.map((item, i) =>
      h('div', { key: props.keyExtractor(item, i), role: 'listitem' }, props.renderItem(item, i) as ReactNode),
    ),
  )
}

export function EmptyState(props: EmptyStateProps) {
  return h(
    'div',
    {
      ...common(props),
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: tokens.space[6],
        textAlign: 'center',
      },
    },
    props.icon ? h(Text, { variant: 'xl', children: props.icon }) : null,
    h(Text, { variant: 'lg', children: props.title }),
    props.description ? h(Text, { tone: 'muted', children: props.description }) : null,
    props.action as ReactNode,
  )
}

export function Toast(props: ToastProps) {
  const p = c()
  const background =
    props.tone === 'error'
      ? p.state.error
      : props.tone === 'warn'
        ? p.state.warn
        : props.tone === 'ok'
          ? p.state.ok
          : p.bg.overlay
  return h(
    'div',
    {
      ...common(props),
      // Announced without stealing focus.
      role: 'status',
      'aria-live': 'polite',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
        borderRadius: tokens.radius.pill,
        background,
        color: props.tone && props.tone !== 'info' ? p.bg.base : p.text.primary,
        zIndex: tokens.z.toast,
      },
    },
    h(Text, { children: props.message }),
    props.action as ReactNode,
    props.onDismiss
      ? h(IconButton, { icon: '×', accessibilityLabel: 'Dismiss', onPress: props.onDismiss })
      : null,
  )
}
