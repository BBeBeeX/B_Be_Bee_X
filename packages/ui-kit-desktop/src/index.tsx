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

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
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
  TextFieldProps,
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

/**
 * A text input.
 *
 * Controlled, on both platforms. An uncontrolled input here and a controlled
 * one on mobile would drift the moment either had to be reset — and the import
 * screen resets it on every successful paste.
 */
export function TextField(props: TextFieldProps): ReactElement {
  const scheme = c()
  const invalid = props.error !== undefined
  const style = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
    borderRadius: tokens.radius.sm,
    border: `1px solid ${invalid ? scheme.state.error : scheme.border.strong}`,
    background: scheme.bg.raised,
    color: scheme.text.primary,
    // Monospace for a rule and for a pasted document: alignment is how an
    // author spots an unbalanced brace, and a proportional font hides it.
    fontFamily: props.multiline ? tokens.font.family.mono : tokens.font.family.ui,
    fontSize: tokens.font.size.md,
    // Native resizing on a textarea a caller sized is a scrollbar fight.
    resize: 'vertical' as const,
    minHeight: props.multiline ? undefined : tokens.size.touchTarget,
  }

  const onChange = (e: { target: { value: string } }) => props.onChange(e.target.value)
  const field = props.multiline
    ? h('textarea', {
        ...common(props),
        value: props.value,
        rows: props.rows ?? 8,
        placeholder: props.placeholder,
        disabled: props.disabled,
        spellCheck: props.autoCorrect ?? false,
        onChange,
        style,
      })
    : h('input', {
        ...common(props),
        type: props.secure ? 'password' : 'text',
        value: props.value,
        placeholder: props.placeholder,
        disabled: props.disabled,
        spellCheck: props.autoCorrect ?? false,
        onChange,
        style,
      })

  if (!invalid) return field
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
    field,
    // Rendered, not a title attribute: an error only a hover reveals is one a
    // touch user and a screen reader both never see.
    h(Text, { variant: 'sm', tone: 'error' }, props.error),
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

/**
 * A virtualised list.
 *
 * The row set is windowed by `@tanstack/react-virtual`: a 100k-track library
 * puts 100k rows in the DOM otherwise, and the browser spends its frame budget
 * on layout for rows nobody can see. The twin does the same job with FlashList
 * (docs/11 §4.11).
 *
 * `role="list"` sits on the scroller and each row keeps `role="listitem"`, so
 * a screen reader reads a list of `aria-setsize` items rather than the handful
 * currently rendered — the one thing windowing breaks if it is not said out
 * loud.
 */
export function List<T>(props: ListProps<T>) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const count = props.items.length
  // `tokens.size.row` rather than a number: the estimate only has to be close,
  // and the closest thing available is the height a TrackRow actually is.
  const estimate = props.estimatedItemSize ?? tokens.size.row

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    overscan: 8,
  })

  const rows = virtualizer.getVirtualItems()

  /*
   * `onEndReached` fires from the last *rendered* row rather than from a
   * scroll handler: with windowing the two are the same event, and reading it
   * off the window costs no listener.
   *
   * In an effect, not during render. The callback belongs to the caller and
   * almost always sets state — "cannot update a component while rendering a
   * different component" is the warning, and a dropped page is the symptom.
   * `firedFor` keys the guard on the count so one page is requested once, and
   * the arrival of that page re-arms it.
   */
  const last = rows[rows.length - 1]
  const reachedEnd = last !== undefined && last.index >= count - 1
  const firedFor = useRef(-1)
  const onEndReached = props.onEndReached
  useEffect(() => {
    if (!reachedEnd || !onEndReached || firedFor.current === count) return
    firedFor.current = count
    onEndReached()
  }, [reachedEnd, onEndReached, count])

  if (count === 0 && props.empty !== undefined) {
    return h('div', common(props), props.empty as ReactNode)
  }

  return h(
    'div',
    {
      ...common(props),
      ref: scroller,
      role: 'list',
      style: { overflowY: 'auto', height: '100%' },
    },
    // The spacer carries the full scroll height, so the scrollbar reports the
    // whole library and not the window.
    h(
      'div',
      { style: { height: virtualizer.getTotalSize(), position: 'relative', width: '100%' } },
      rows.map((row) => {
        const item = props.items[row.index]!
        return h(
          'div',
          {
            key: props.keyExtractor(item, row.index),
            role: 'listitem',
            'aria-setsize': count,
            'aria-posinset': row.index + 1,
            ref: virtualizer.measureElement,
            'data-index': row.index,
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${row.start}px)`,
            },
          },
          props.renderItem(item, row.index) as ReactNode,
        )
      }),
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
