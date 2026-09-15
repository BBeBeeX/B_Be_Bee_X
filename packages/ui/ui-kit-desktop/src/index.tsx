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
import { palettes, tokens, type Palette, type Scheme } from '@BBeBee/ui-tokens'
import { identicon } from '@BBeBee/ui-core'
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

/**
 * A control is a **pill**, and the primary one grows a little under the
 * pointer.
 *
 * Both are load-bearing rather than fashion. The fully rounded shape is what
 * separates an action from a surface in a UI with almost no borders — when
 * every panel is a dark rectangle, roundness is the only cue left that
 * something is pressable. The 1.04 scale on hover replaces the colour change a
 * lighter theme would use: on near-black, "slightly lighter" is invisible, and
 * "slightly larger" is not.
 */
function buttonStyle(variant: ButtonVariant, disabled: boolean, hovered: boolean): CSSProperties {
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
    // Never `outline: none`. Keyboard users lose the focus ring, which
    // docs/08 8 requires to be visible.
    outlineColor: p.border.strong,
    opacity: disabled ? 0.5 : 1,
    transition: `transform ${tokens.duration.fast}ms, background-color ${tokens.duration.fast}ms, color ${tokens.duration.fast}ms, border-color ${tokens.duration.fast}ms`,
    transform: hovered && !disabled ? 'scale(1.04)' : 'scale(1)',
    border: `1px solid transparent`,
  }
  switch (variant) {
    case 'secondary':
      // Outlined, never filled: a filled secondary next to a filled primary
      // makes two primaries.
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
function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hovered, setHovered] = useState(false)
  return [hovered, { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }]
}

export function Button(props: ButtonProps) {
  const { variant = 'primary', disabled = false, loading = false } = props
  // `loading` disables as well as showing progress: a second press during a
  // request is the classic double-submit.
  const off = disabled || loading
  const [hovered, hoverProps] = useHover()
  return h(
    'button',
    {
      ...common(props),
      ...hoverProps,
      type: 'button',
      disabled: off,
      'aria-busy': loading || undefined,
      onClick: off ? undefined : props.onPress,
      style: buttonStyle(variant, off, hovered),
    },
    loading ? '…' : (props.children as ReactNode),
  )
}

export function IconButton(props: IconButtonProps): ReactElement {
  const { variant = 'ghost', disabled = false, size = tokens.size.icon } = props
  const [hovered, hoverProps] = useHover()
  return h(
    'button',
    {
      ...common(props),
      ...hoverProps,
      type: 'button',
      disabled,
      onClick: disabled ? undefined : props.onPress,
      style: {
        ...buttonStyle(variant, disabled, hovered),
        width: tokens.size.touchTarget,
        minHeight: tokens.size.touchTarget,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size,
        // Round, because an icon has no text to give a pill its shape.
        borderRadius: tokens.radius.pill,
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
    // Filled rather than outlined: on a dark canvas a box drawn in outline
    // reads as a disabled field, and the fill is what says "type here".
    border: `1px solid ${invalid ? scheme.state.error : 'transparent'}`,
    background: scheme.bg.overlay,
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

/**
 * Weight follows size.
 *
 * The type scale is doing the work the typeface cannot — the licensed face is
 * a lookup, not a download (see `ui-tokens`) — so a heading is recognisable by
 * being *heavy and large*, not by being set in something distinctive. A 40px
 * title at regular weight reads as a paragraph that got out of hand.
 */
function weightFor(variant: NonNullable<TextProps['variant']>): string {
  if (variant === 'display' || variant === 'xl') return tokens.font.weight.heavy
  if (variant === 'lg') return tokens.font.weight.bold
  return tokens.font.weight.regular
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
        fontWeight: weightFor(variant),
        lineHeight:
          variant === 'display' || variant === 'xl'
            ? tokens.font.lineHeight.tight
            : tokens.font.lineHeight.normal,
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
  const rawUri = props.artwork?.sourceUrl
  const uri = rawUri?.startsWith('file://') ? rawUri.replace(/^file:\/\//, 'bbebee-file://') : rawUri
  const dominant = props.artwork?.dominantColor
  // No image and no colour from a real cover, but an identity (the caller's
  // seed, else the artwork row's own id) → a generated identicon, so an
  // artwork-less library is still a grid of distinct, stable squares rather
  // than one anonymous grey. Derived data never outranks real data: a
  // `dominantColor` extracted from an actual cover wins; with neither, the
  // plain colour square stands.
  const pattern = uri || dominant ? undefined : identicon(props.seed || props.artwork?.id)
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
        background: pattern?.background ?? dominant ?? c().bg.overlay,
      },
    },
    uri
      ? h('img', {
          src: uri,
          alt: '',
          loading: 'lazy',
          /*
           * A remote cover is fetched with no Referer.
           *
           * Several CDNs answer a hotlink 403 when the referrer is a foreign
           * origin — Bilibili's `hdslb.com` is one, and in dev the renderer's
           * referrer is `http://localhost:5173`. Without this every search
           * result shows a broken cover while the same URL opens fine in a
           * browser tab, which is exactly the wrong way round to debug.
           */
          referrerPolicy: 'no-referrer',
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
        })
      : pattern
        ? h(
            'svg',
            {
              viewBox: '0 0 5 5',
              width: '100%',
              height: '100%',
              'aria-hidden': true,
              // The cells are axis-aligned and share edges; anti-aliasing the
              // seams would show hairlines where the squares meet.
              shapeRendering: 'crispEdges',
            },
            pattern.cells.flatMap((on, i) =>
              on
                ? [
                    h('rect', {
                      key: i,
                      x: i % 5,
                      y: Math.floor(i / 5),
                      width: 1,
                      height: 1,
                      fill: pattern.foreground,
                    }),
                  ]
                : [],
            ),
          )
        : null,
  )
}

export function TrackRow(props: TrackRowProps) {
  const { active = false, showArtwork = true, showAlbum = false } = props
  const p = c()
  const [hovered, hoverProps] = useHover()
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
      ...hoverProps,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.sm,
        cursor: props.onPress ? 'pointer' : 'default',
        // The playing row is green *text* on the same surface as its
        // neighbours — a filled row would compete with the hover fill, and
        // then "playing" and "pointer is here" look like the same thing.
        color: active ? p.accent.base : p.text.primary,
        background: hovered ? p.bg.overlay : 'transparent',
        transition: `background-color ${tokens.duration.fast}ms`,
      },
    },
    showArtwork
      ? h(Artwork, {
          artwork: props.track.artwork,
          seed: props.track.urn,
          size: tokens.size.artworkThumb,
        })
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
    props.onToggleLoved
      ? h(
          'span',
          { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
          h(IconButton, {
            icon: props.track.loved ? '♥' : '♡',
            accessibilityLabel: props.track.loved ? 'Unlike' : 'Like',
            variant: props.track.loved ? 'primary' : 'ghost',
            onPress: props.onToggleLoved,
          }),
        )
      : null,
    props.onDownload
      ? h(
          'span',
          { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
          h(IconButton, {
            icon: '⬇',
            accessibilityLabel: 'Download',
            onPress: props.onDownload,
          }),
        )
      : null,
    props.onMore
      ? h(
          'span',
          { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
          h(IconButton, { icon: '⋯', accessibilityLabel: 'More', onPress: props.onMore }),
        )
      : null,
  )
}

export function Slider(props: SliderProps) {
  const { disabled = false } = props
  const [hovered, hoverProps] = useHover()
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
    ...hoverProps,
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
    onPointerUp: (event: { currentTarget: { value: string } }) =>
      commit(Number(event.currentTarget.value)),
    onKeyUp: (event: { currentTarget: { value: string } }) =>
      commit(Number(event.currentTarget.value)),
    onBlur: () => setDragging(undefined),
    /*
     * White until you touch it, then green.
     *
     * `accent-color` paints the filled part of the rail and the thumb
     * together, which is the whole control here — a scrubber that is green at
     * rest competes with every other accent on the screen, and one that never
     * turns green gives no feedback that it is grabbable.
     */
    style: {
      width: '100%',
      accentColor: hovered || dragging !== undefined ? c().accent.base : c().text.primary,
      cursor: disabled ? 'default' : 'pointer',
    },
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

let jsonEpoch = 0

/** Syntax colours for the tree, all from the palette. */
function jsonColor(value: unknown, palette: Palette): string | undefined {
  if (typeof value === 'string') return palette.state.ok
  if (typeof value === 'number') return palette.text.primary
  if (typeof value === 'boolean' || value === null) return palette.state.warn
  return undefined
}

/** Per-level indent. 16px — deep enough to read, shallow enough to stay narrow. */
const INDENT = tokens.space[4]

/** Long strings start clipped; clicking spreads them. A body can hold a URL no one needs all of. */
const STRING_CLIP = 300

/** One expand-all/collapse-all directive, shared by every branch. */
export interface JsonDirective {
  value: boolean
  /** Bumped on every press, so pressing the same button twice still re-applies. */
  epoch: number
}

interface JsonFrame {
  palette: Palette
  defaultExpandedDepth: number
  directive: JsonDirective | undefined
}

function JsonString(props: { value: string; palette: Palette }): ReactElement {
  const [spread, setSpread] = useState(false)
  const clipped = !spread && props.value.length > STRING_CLIP
  const shown = clipped ? props.value.slice(0, STRING_CLIP) : props.value
  return h(
    'span',
    {
      onClick: clipped ? () => setSpread(true) : undefined,
      style: {
        color: props.palette.state.ok,
        cursor: clipped ? 'pointer' : undefined,
        ...(clipped ? { textDecoration: 'underline dotted' } : {}),
      },
    },
    JSON.stringify(shown) + (clipped ? `… (+${props.value.length - STRING_CLIP})` : ''),
  )
}

/**
 * Everything a row needs to behave like a row: hover highlight, arrow-key
 * navigation across the whole tree, and the left/right collapse contract.
 * A leaf takes the navigation and the highlight; collapse is the branch's.
 */
function rowBehavior(
  frame: JsonFrame,
  opts: { onCollapse?: (open: boolean) => void } = {},
): Record<string, unknown> {
  return {
    tabIndex: -1,
    'data-json-row': true,
    onKeyDown: (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
      const container = event.currentTarget.closest('[data-json-tree]') as HTMLElement | null
      const rows = container
        ? Array.from(container.querySelectorAll<HTMLElement>('[data-json-row]'))
        : []
      const index = rows.indexOf(event.currentTarget)
      if (event.key === 'ArrowDown' && index >= 0 && index < rows.length - 1) {
        event.preventDefault()
        rows[index + 1]!.focus()
      } else if (event.key === 'ArrowUp' && index > 0) {
        event.preventDefault()
        rows[index - 1]!.focus()
      } else if (event.key === 'ArrowRight') {
        opts.onCollapse?.(true)
      } else if (event.key === 'ArrowLeft') {
        opts.onCollapse?.(false)
      }
    },
  }
}

function JsonBranch(props: {
  name: string | undefined
  value: Record<string, unknown> | readonly unknown[]
  depth: number
  frame: JsonFrame
}): ReactElement {
  const { palette, directive } = props.frame
  // A branch mounted *after* a directive was issued (its parent was just
  // expanded) must honour that directive on arrival, not only on the next one
  // — hence the initial state, not an effect.
  const [open, setOpen] = useState(
    directive ? directive.value : props.depth < props.frame.defaultExpandedDepth,
  )
  const appliedEpoch = useRef(directive?.epoch)
  useEffect(() => {
    if (directive && directive.epoch !== appliedEpoch.current) {
      appliedEpoch.current = directive.epoch
      setOpen(directive.value)
    }
  }, [directive])

  const entries: [string, unknown][] = Array.isArray(props.value)
    ? props.value.map((v, i) => [String(i), v])
    : Object.entries(props.value)
  const brace = Array.isArray(props.value) ? ['[', ']'] : ['{', '}']
  const [hovered, setHovered] = useState(false)

  const row = h(
    'div',
    {
      role: 'button',
      onClick: () => setOpen(!open),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      ...rowBehavior(props.frame, { onCollapse: setOpen }),
      // One tab stop per tree: the root branch. Deeper rows are reachable by
      // arrow keys from there, not by tabbing through every line.
      tabIndex: props.depth === 0 ? 0 : undefined,
      style: {
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'baseline',
        gap: tokens.space[1],
        borderRadius: tokens.radius.sm,
        background: hovered ? palette.bg.overlay : undefined,
        outline: 'none',
      },
    },
    h('span', { style: { color: palette.text.disabled, userSelect: 'none' } }, open ? '▼' : '▶'),
    props.name !== undefined
      ? h('span', { style: { color: palette.text.secondary } }, props.name)
      : null,
    h('span', { style: { color: palette.text.primary } }, brace[0]),
    !open
      ? h(
          'span',
          { style: { color: palette.text.disabled } },
          `…} ${entries.length} ${Array.isArray(props.value) ? 'items' : 'keys'}`,
        )
      : null,
    h('span', { style: { color: palette.text.primary } }, open ? '' : brace[1]),
  )

  return h(
    'div',
    { style: { paddingLeft: props.depth === 0 ? 0 : INDENT } },
    row,
    open
      ? h(
          'div',
          { style: { borderLeft: `1px solid ${palette.border.subtle}`, marginLeft: tokens.space[1] } },
          ...entries.map(([key, child]) =>
            h(JsonEntry, {
              key,
              name: key,
              value: child,
              depth: props.depth + 1,
              frame: props.frame,
            }),
          ),
        )
      : null,
    open
      ? h(
          'div',
          { style: { color: palette.text.primary, paddingLeft: INDENT }, 'data-json-row': true, tabIndex: -1 },
          brace[1],
        )
      : null,
  )
}

function JsonEntry(props: { name: string; value: unknown; depth: number; frame: JsonFrame }): ReactElement {
  const { palette } = props.frame
  const value = props.value
  const isBranch = value !== null && typeof value === 'object'

  if (isBranch) {
    return h(JsonBranch, {
      name: props.name,
      value: value as Record<string, unknown>,
      depth: props.depth,
      frame: props.frame,
    })
  }

  const color = jsonColor(value, palette)
  const [hovered, setHovered] = useState(false)
  const rendered =
    typeof value === 'string'
      ? h(JsonString, { value, palette })
      : h('span', { style: { color } }, value === undefined ? 'undefined' : String(value))

  return h(
    'div',
    {
      ...rowBehavior(props.frame),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        paddingLeft: INDENT,
        display: 'flex',
        alignItems: 'baseline',
        gap: tokens.space[1],
        borderRadius: tokens.radius.sm,
        background: hovered ? palette.bg.overlay : undefined,
        outline: 'none',
      },
    },
    // The root entry has no name: the tree opens with the value itself.
    props.name !== '' ? h('span', { style: { color: palette.text.secondary } }, props.name) : null,
    props.name !== '' ? h('span', null, ':') : null,
    rendered,
  )
}

/**
 * A parsed JSON value as a collapsible tree.
 *
 * For *reading* a response — the test screen's output pane — not editing it.
 * Objects and arrays collapse on click (leaves just highlight); the toolbar
 * expands or collapses everything at once; arrows move between rows and
 * left/right collapse or expand the focused branch.
 */
export function JsonTree(props: {
  value: unknown
  /** How many nesting levels start open. Default 2: the shape without the noise. */
  defaultExpandedDepth?: number
  /** Render the expand-all / collapse-all toolbar above the tree. */
  controls?: boolean
  testID?: string
  accessibilityLabel?: string
}): ReactElement {
  const palette = c()
  const [directive, setDirective] = useState<JsonDirective | undefined>(undefined)
  const frame: JsonFrame = {
    palette,
    defaultExpandedDepth: props.defaultExpandedDepth ?? 2,
    directive,
  }

  return h(
    'div',
    {
      'data-testid': props.testID,
      'aria-label': props.accessibilityLabel,
      'data-json-tree': true,
      style: {
        fontFamily: tokens.font.family.mono,
        fontSize: tokens.font.size.sm,
        lineHeight: 1.6,
        overflowWrap: 'anywhere',
        color: palette.text.primary,
      },
    },
    // Row hover via one scoped rule rather than a listener per row: it
    // arrives and leaves with the component.
    h('style', null, `[data-json-tree] [data-json-row]:hover { background: ${palette.bg.overlay}; }`),
    props.controls
      ? h(
          'div',
          { style: { display: 'flex', gap: tokens.space[2], marginBottom: tokens.space[1] } },
          h(
            'button',
            {
              onClick: () => setDirective({ value: true, epoch: ++jsonEpoch }),
              style: {
                background: 'none',
                border: 'none',
                color: palette.text.secondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: tokens.font.size.sm,
                padding: 0,
              },
            },
            'Expand all',
          ),
          h(
            'button',
            {
              onClick: () => setDirective({ value: false, epoch: ++jsonEpoch }),
              style: {
                background: 'none',
                border: 'none',
                color: palette.text.secondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: tokens.font.size.sm,
                padding: 0,
              },
            },
            'Collapse all',
          ),
        )
      : null,
    h(JsonEntry, {
      name: '',
      value: props.value,
      depth: 0,
      frame,
    }),
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
