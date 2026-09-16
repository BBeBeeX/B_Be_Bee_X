/**
 * `@BBeBee/ui-kit-mobile` - the parity component set, React Native.
 *
 * Twin of `ui-kit-desktop`: same names, same props, same tokens. `ui-parity`
 * fails the build if they diverge, because the moment `Button` takes
 * `onPress` on one and `onClick` on the other, every plugin author pays for
 * it twice, forever (docs/08 6).
 *
 * ⚠️ **`react-native` is injected, not imported.** The repo's existing mobile
 * view packages do the same, and the reason is worth stating: importing it
 * pulls in native modules, so the package could not be typechecked or
 * unit-tested anywhere but a device — and a check that only runs on one of two
 * platforms is most of the way to no check at all. The shell calls
 * `configureNative` once at boot with the real module.
 */

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { palettes, tokens, type Palette, type Scheme } from '@BBeBee/ui-tokens'
import { identicon } from '@BBeBee/ui-core'
import type {
  ArtworkProps,
  ButtonProps,
  ButtonVariant,
  ContextMenuProps,
  EmptyStateProps,
  IconButtonProps,
  ListProps,
  MenuItemSpec,
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
 * The React Native primitives this kit builds on.
 *
 * Deliberately the smallest set that covers the component contract. Adding one
 * is a decision: it is another thing the shell must provide and another thing
 * a test must fake.
 */
export interface NativePrimitives {
  View: unknown
  Text: unknown
  Pressable: unknown
  Image: unknown
  Modal: unknown
  /**
   * `FlashList` from `@shopify/flash-list`, not `FlatList`.
   *
   * Recycling rather than mounting is what keeps a 100k-track library
   * scrolling on a low-end Android phone, and it is the mobile half of docs/11
   * §4.11. Injected like everything else here so this package still typechecks
   * and unit-tests without a device.
   */
  FlashList: unknown
  ActivityIndicator: unknown
  TextInput: unknown
}

/**
 * A stand-in used before `configureNative` runs.
 *
 * Renders host elements named after the primitive rather than throwing, so a
 * component tree can be inspected in a test without React Native present —
 * and so a shell that forgot to configure gets an obviously wrong screen
 * rather than a crash in a render pass nobody can read.
 */
const PLACEHOLDER: NativePrimitives = {
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Image: 'Image',
  Modal: 'Modal',
  FlashList: 'FlashList',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
}

let native: NativePrimitives = PLACEHOLDER
let scheme: Scheme = 'dark'

/** Called once by `apps/mobile` at boot, with the real `react-native` module. */
export function configureNative(primitives: NativePrimitives): void {
  native = primitives
}

export function setScheme(next: Scheme): void {
  scheme = next
}

/** The primitives currently in use. For the shell's own assertions and tests. */
export function nativePrimitives(): NativePrimitives {
  return native
}

const c = () => palettes[scheme]

/** Common attributes. React Native spells both of these its own way. */
function common(props: { testID?: string; accessibilityLabel?: string }) {
  return { testID: props.testID, accessibilityLabel: props.accessibilityLabel }
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

function buttonStyle(variant: ButtonVariant, disabled: boolean): Record<string, unknown> {
  const p = c()
  const base = {
    minHeight: tokens.size.touchTarget,
    paddingHorizontal: tokens.space[5],
    // A pill, as on desktop. The shape is the only cue that survives a UI
    // with almost no borders, and the two kits have to agree on it or the
    // same plugin looks like two products (docs/08 §6).
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.5 : 1,
    borderWidth: 1,
    borderColor: 'transparent',
  }
  switch (variant) {
    case 'secondary':
      // Outlined, not filled — a filled secondary beside a filled primary
      // makes two primaries.
      return { ...base, backgroundColor: 'transparent', borderColor: p.border.strong }
    case 'ghost':
      return { ...base, backgroundColor: 'transparent' }
    case 'danger':
      return { ...base, backgroundColor: p.state.error }
    default:
      return { ...base, backgroundColor: p.accent.base }
  }
}

function labelColor(variant: ButtonVariant): string {
  const p = c()
  if (variant === 'primary') return p.accent.on
  if (variant === 'danger') return p.bg.sunken
  if (variant === 'ghost') return p.text.secondary
  return p.text.primary
}

export function Button(props: ButtonProps): ReactElement {
  const { variant = 'primary', disabled = false, loading = false } = props
  // `loading` disables as well: a second tap during a request is the classic
  // double-submit, and on a phone it is easier to do by accident.
  const off = disabled || loading
  return h(
    native.Pressable as never,
    {
      ...common(props),
      accessibilityRole: 'button',
      accessibilityState: { disabled: off, busy: loading },
      disabled: off,
      onPress: off ? undefined : props.onPress,
      style: buttonStyle(variant, off),
    },
    loading
      ? h(native.ActivityIndicator as never, { color: labelColor(variant) })
      : h(
          native.Text as never,
          { style: { color: labelColor(variant), fontSize: tokens.font.size.md } },
          props.children as ReactNode,
        ),
  )
}

export function IconButton(props: IconButtonProps): ReactElement {
  const { variant = 'ghost', disabled = false, size = tokens.size.icon } = props
  return h(
    native.Pressable as never,
    {
      ...common(props),
      accessibilityRole: 'button',
      accessibilityState: { disabled },
      disabled,
      onPress: disabled ? undefined : props.onPress,
      // A square at least as large as the platform's minimum tap target,
      // whatever the icon inside it measures.
      style: {
        ...buttonStyle(variant, disabled),
        width: tokens.size.touchTarget,
        paddingHorizontal: 0,
      },
    },
    h(
      native.Text as never,
      { style: { color: labelColor(variant), fontSize: size } },
      props.icon,
    ),
  )
}

/**
 * A text input.
 *
 * Controlled, like the desktop one. React Native's `TextInput` is happy to be
 * uncontrolled, and a kit where one platform keeps its own state and the other
 * does not is exactly the divergence the parity gate exists to catch — it only
 * shows up when something resets the field, which the import screen does on
 * every successful paste.
 */
export function TextField(props: TextFieldProps): ReactElement {
  const scheme = c()
  const invalid = props.error !== undefined
  const input = h(native.TextInput as never, {
    ...common(props),
    value: props.value,
    onChangeText: props.onChange,
    placeholder: props.placeholder,
    placeholderTextColor: scheme.text.secondary,
    editable: props.disabled !== true,
    multiline: props.multiline ?? false,
    numberOfLines: props.multiline ? (props.rows ?? 8) : 1,
    secureTextEntry: props.secure ?? false,
    // Off by default and deliberately: a rule and a URL are both case- and
    // spelling-sensitive, and autocorrect silently rewriting one produces a
    // source that fails for a reason nothing on screen explains.
    autoCorrect: props.autoCorrect ?? false,
    autoCapitalize: 'none',
    style: {
      borderWidth: 1,
      // Filled rather than outlined: on a dark canvas an outlined box reads as
      // a disabled field, and the fill is what says "type here".
      borderColor: invalid ? scheme.state.error : 'transparent',
      borderRadius: tokens.radius.sm,
      backgroundColor: scheme.bg.overlay,
      color: scheme.text.primary,
      paddingHorizontal: tokens.space[3],
      paddingVertical: tokens.space[2],
      fontSize: tokens.font.size.md,
      // Monospace for a rule and a pasted document: alignment is how an author
      // spots an unbalanced brace.
      fontFamily: props.multiline ? tokens.font.family.mono : undefined,
      // A multiline field must grow; a single-line one must stay tappable.
      minHeight: props.multiline
        ? tokens.font.size.md * 1.5 * (props.rows ?? 8)
        : tokens.size.touchTarget,
      textAlignVertical: props.multiline ? 'top' : 'center',
    },
  })

  if (!invalid) return input
  return h(
    native.View as never,
    { style: { gap: tokens.space[1] } },
    input,
    h(Text, { variant: 'sm', tone: 'error' }, props.error),
  )
}

/**
 * Weight follows size — the same rule the desktop kit applies.
 *
 * The licensed display face is a lookup rather than a download, so the scale
 * has to carry the design: a heading is recognisable by being heavy and large,
 * not by being set in something distinctive.
 */
function weightFor(variant: NonNullable<TextProps['variant']>): string {
  if (variant === 'display' || variant === 'xl') return tokens.font.weight.heavy
  if (variant === 'lg') return tokens.font.weight.bold
  return tokens.font.weight.regular
}

export function Text(props: TextProps): ReactElement {
  const { variant = 'md' } = props
  const tight = variant === 'display' || variant === 'xl'
  return h(
    native.Text as never,
    {
      ...common(props),
      numberOfLines: props.numberOfLines,
      // Relative to the OS text-size setting rather than absolute, so the
      // 200% test in docs/08 8 is a layout question, not a clipping one.
      allowFontScaling: true,
      style: {
        fontSize: tokens.font.size[variant],
        fontWeight: weightFor(variant),
        lineHeight:
          tokens.font.size[variant] *
          (tight ? tokens.font.lineHeight.tight : tokens.font.lineHeight.normal),
        color: toneColor(props.tone),
      },
    },
    props.children as ReactNode,
  )
}

export function Artwork(props: ArtworkProps): ReactElement {
  const { size, radius = tokens.radius.sm } = props
  const uri = props.artwork?.sourceUrl
  const dominant = props.artwork?.dominantColor
  // No image and no colour from a real cover, but an identity (the caller's
  // seed, else the artwork row's own id) → a generated identicon, so an
  // artwork-less library is still a grid of distinct, stable squares rather
  // than one anonymous grey. Derived data never outranks real data: a
  // `dominantColor` extracted from an actual cover wins; with neither, the
  // plain colour square stands. The pattern comes from `ui-core`, so the same
  // album hashes to the same square on both platforms.
  const pattern = uri || dominant ? undefined : identicon(props.seed || props.artwork?.id)
  // The dominant colour is the background, so it shows while the image loads:
  // no grey flash and no layout shift on scroll (docs/08 4).
  return h(
    native.View as never,
    {
      ...common(props),
      style: {
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: pattern?.background ?? dominant ?? c().bg.overlay,
      },
    },
    uri
      ? h(native.Image as never, {
          source: { uri },
          style: { width: '100%', height: '100%' },
          resizeMode: 'cover',
        })
      : pattern
        ? // Five rows of five `View`s rather than `react-native-svg`: the SVG
          // package is a native module, and the grid is the one thing plain
          // views do exactly as well.
          h(
            native.View as never,
            { style: { flex: 1, flexDirection: 'column' } },
            [0, 1, 2, 3, 4].map((row) =>
              h(
                native.View as never,
                { key: row, style: { flex: 1, flexDirection: 'row' } },
                pattern.cells.slice(row * 5, row * 5 + 5).map((on, column) =>
                  h(native.View as never, {
                    key: column,
                    style: {
                      flex: 1,
                      backgroundColor: on ? pattern.foreground : 'transparent',
                    },
                  }),
                ),
              ),
            ),
          )
        : null,
  )
}

export function TrackRow(props: TrackRowProps): ReactElement {
  const { active = false, showArtwork = true, showAlbum = false } = props
  const artists = props.track.artists?.map((a) => a.name).join(', ')
  return h(
    native.Pressable as never,
    {
      ...common(props),
      accessibilityRole: 'button',
      onPress: props.onPress,
      // Long press is the mobile half of `onMore`; desktop uses right-click.
      onLongPress: (event: { nativeEvent?: { pageX?: number; pageY?: number } }) =>
        props.onMore?.({
          x: event.nativeEvent?.pageX ?? 0,
          y: event.nativeEvent?.pageY ?? 0,
        }),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        paddingHorizontal: tokens.space[3],
        borderRadius: tokens.radius.sm,
        // The playing row is green *text*, not a filled row: a fill here would
        // compete with the press highlight and the two would read the same.
        backgroundColor: 'transparent',
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
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, {
        numberOfLines: 1,
        tone: active ? 'accent' : 'default',
        children: props.track.title,
      }),
      artists
        ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: artists })
        : null,
    ),
    showAlbum && props.track.albumTitle
      ? h(Text, {
          variant: 'sm',
          tone: 'muted',
          numberOfLines: 1,
          children: props.track.albumTitle,
        })
      : null,
    props.onToggleLoved
      ? h(IconButton, {
          icon: props.track.loved ? '♥' : '♡',
          accessibilityLabel: props.track.loved ? 'Unlike' : 'Like',
          variant: props.track.loved ? 'primary' : 'ghost',
          onPress: props.onToggleLoved,
        })
      : null,
    props.onDownload && !props.track.urn.startsWith('BBeBee:local:')
      ? h(IconButton, { icon: '⬇', accessibilityLabel: 'Download', onPress: props.onDownload })
      : null,
    props.onMore
      ? h(IconButton, { icon: '⋯', accessibilityLabel: 'More', onPress: props.onMore })
      : null,
  )
}

/** One accessibility step, as a fraction of the range. */
const SLIDER_STEP = 0.05

export function Slider(props: SliderProps): ReactElement {
  const { disabled = false } = props

  /*
   * Draggable, through React Native's own responder system.
   *
   * Not `react-native-gesture-handler`: a touch that owns itself for the
   * length of a drag is exactly what the responder system is for, and taking
   * the dependency would put a native module in the kit — which is the one
   * thing `configureNative` exists to keep out (docs/08 §6).
   *
   * The track's width arrives from `onLayout` rather than a measure call,
   * because `measure()` is async and a scrubber cannot wait a frame to know
   * where the finger is.
   */
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const width = useRef(0)
  const value = dragging ?? props.value

  const at = useCallback(
    (x: number): number => {
      if (width.current <= 0 || props.max <= 0) return 0
      const fraction = Math.max(0, Math.min(1, x / width.current))
      return Math.round(fraction * props.max)
    },
    [props.max],
  )

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = Math.max(
        0,
        Math.min(props.max, Math.round(value + direction * props.max * SLIDER_STEP)),
      )
      props.onChange?.(next)
      props.onCommit?.(next)
    },
    [props, value],
  )

  const p = c()
  return h(
    native.View as never,
    {
      ...common(props),
      accessibilityRole: 'adjustable',
      accessibilityValue: { min: 0, max: props.max, now: value },
      accessibilityState: { disabled },
      /*
       * `increment`/`decrement`, not "commit the value it already has".
       * A screen-reader user swiping up on a scrubber means "forward", and
       * committing `value` unchanged is a seek to where the track already is
       * — a control that looks adjustable and adjusts nothing.
       */
      onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
        if (disabled) return
        if (event.nativeEvent.actionName === 'increment') step(1)
        else if (event.nativeEvent.actionName === 'decrement') step(-1)
      },
      style: {
        height: tokens.size.touchTarget,
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      },
    },
    h(
      native.View as never,
      {
        onLayout: (event: { nativeEvent: { layout: { width: number } } }) => {
          width.current = event.nativeEvent.layout.width
        },
        // Claim the touch on the way down, so a drag that starts here is not
        // stolen by a scroll view above it.
        onStartShouldSetResponder: () => !disabled,
        onMoveShouldSetResponder: () => !disabled,
        onResponderGrant: (event: { nativeEvent: { locationX: number } }) => {
          const next = at(event.nativeEvent.locationX)
          setDragging(next)
          props.onChange?.(next)
        },
        onResponderMove: (event: { nativeEvent: { locationX: number } }) => {
          const next = at(event.nativeEvent.locationX)
          setDragging(next)
          props.onChange?.(next)
        },
        onResponderRelease: (event: { nativeEvent: { locationX: number } }) => {
          const next = at(event.nativeEvent.locationX)
          setDragging(undefined)
          props.onCommit?.(next)
        },
        // A drag the OS takes away — a call arriving, a parent scroll winning
        // — must not leave the thumb stranded where the finger left it.
        onResponderTerminate: () => setDragging(undefined),
        onResponderTerminationRequest: () => false,
        style: { height: 4, borderRadius: 2, backgroundColor: p.bg.overlay },
      },
      h(native.View as never, {
        style: {
          height: 4,
          borderRadius: 2,
          // White at rest, like the desktop scrubber: a green rail at rest
          // competes with every other accent on the screen.
          backgroundColor: p.text.primary,
          width: `${props.max > 0 ? Math.min(100, (value / props.max) * 100) : 0}%`,
        },
      }),
    ),
  )
}

export function Sheet(props: SheetProps): ReactElement | null {
  if (!props.open) return null
  const p = c()
  return h(
    native.Modal as never,
    {
      ...common(props),
      visible: props.open,
      transparent: true,
      animationType: 'slide',
      // The Android back button must close it, or the sheet is a trap.
      onRequestClose: props.onClose,
    },
    h(
      native.Pressable as never,
      {
        onPress: props.onClose,
        style: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
      },
      h(
        native.Pressable as never,
        {
          // A press inside must not close it; only the backdrop does.
          onPress: () => {},
          style: {
            padding: tokens.space[5],
            borderTopLeftRadius: tokens.radius.lg,
            borderTopRightRadius: tokens.radius.lg,
            backgroundColor: p.bg.raised,
          },
        },
        props.title ? h(Text, { variant: 'lg', children: props.title }) : null,
        props.children as ReactNode,
      ),
    ),
  )
}

/**
 * A virtualised list.
 *
 * FlashList recycles row views instead of mounting one per item, which is what
 * a 100k-track library needs on a phone. Its twin on desktop windows the same
 * way with `@tanstack/react-virtual` (docs/11 §4.11).
 *
 * ⚠️ `estimatedItemSize` is deliberately not forwarded. FlashList v2 measures
 * rows itself and dropped the prop; passing it would look like a hint and be
 * ignored. The prop stays in the shared contract because the desktop
 * virtualiser genuinely needs it, and a prop one kit ignores is cheaper than
 * two contracts.
 */

/**
 * A long-press / overflow menu.
 *
 * A bottom sheet, not a popover: the anchor position is ignored because a
 * finger covers it. A submenu **replaces the sheet's contents** with a back
 * row, which is the pattern the platform has already taught every user.
 *
 * Kit-side, the menu is dumb: it renders `MenuItemSpec`s and reports presses.
 * Which actions exist, and what they do, is built once by `@BBeBee/ui-menus`.
 */
export function ContextMenu(props: ContextMenuProps): ReactElement | null {
  const native = nativePrimitives()
  const [submenuId, setSubmenuId] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const p = c()

  useEffect(() => {
    if (props.open) return
    setSubmenuId(undefined)
    setFilter('')
    setCreating(false)
    setDraft('')
  }, [props.open])

  if (!props.open) return null

  const submenu = props.items.find((item) => item.id === submenuId)?.submenu
  const needle = filter.trim().toLowerCase()
  const visible = submenu
    ? submenu.items.filter((item) => item.label.toLowerCase().includes(needle))
    : []

  const close = () => props.onClose()
  const activate = (item: MenuItemSpec) => {
    if (item.disabled) return
    if (item.submenu) {
      setSubmenuId(item.id)
      setFilter('')
      setCreating(false)
      setDraft('')
      return
    }
    void item.onSelect?.()
    close()
  }

  const rows = submenu
    ? [
        h(MenuRow, {
          key: '__back',
          item: { id: '__back', label: `\u2039 ${submenu.title ?? 'Back'}` },
          onActivate: () => {
            setSubmenuId(undefined)
            setFilter('')
            setCreating(false)
            setDraft('')
          },
        }),
        submenu.searchPlaceholder
          ? h(TextField, {
              key: '__filter',
              value: filter,
              onChange: setFilter,
              placeholder: submenu.searchPlaceholder,
              testID: 'context-menu-filter',
            })
          : null,
        ...(() => {
          const isCreateBottom = submenu.create?.placement === 'bottom'
          const createRow = submenu.create
            ? creating || submenu.create.alwaysVisible
              ? h(
                  native.View as never,
                  {
                    key: '__create-field',
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: tokens.space[2],
                      borderTopWidth: isCreateBottom ? 1 : 0,
                      borderTopColor: 'rgba(255, 255, 255, 0.08)',
                      paddingTop: isCreateBottom ? tokens.space[2] : 0,
                      marginTop: isCreateBottom ? tokens.space[1] : 0,
                    },
                  },
                  h(
                    native.View as never,
                    { style: { flex: 1 } },
                    h(TextField, {
                      value: draft,
                      onChange: setDraft,
                      placeholder: submenu.create.placeholder,
                      testID: 'context-menu-create-name',
                    }),
                  ),
                  h(Button, {
                    onPress: () => {
                      const name = draft.trim()
                      if (!name) return
                      void submenu.create?.onSelect(name)
                      close()
                    },
                    disabled: draft.trim().length === 0,
                    testID: 'context-menu-create-confirm',
                    children: submenu.create.buttonLabel ?? '确定',
                  }),
                )
              : h(MenuRow, {
                  key: '__create',
                  item: { id: '__create', label: submenu.create.label, icon: '\uff0b' },
                  onActivate: () => setCreating(true),
                })
            : null

          const itemRows = visible.length === 0
            ? [
                h(
                  native.View as never,
                  { key: '__empty', style: { padding: tokens.space[3] } },
                  h(Text, { variant: 'sm', tone: 'muted', children: submenu.emptyLabel ?? 'No matches' }),
                ),
              ]
            : visible.map((item) => h(MenuRow, { key: item.id, item, onActivate: activate }))

          return isCreateBottom
            ? [...itemRows, ...(createRow ? [createRow] : [])]
            : [...(createRow ? [createRow] : []), ...itemRows]
        })(),
      ]
    : props.items.map((item) => h(MenuRow, { key: item.id, item, onActivate: activate }))

  return h(
    native.Modal as never,
    {
      visible: true,
      transparent: true,
      animationType: 'slide',
      onRequestClose: close,
    },
    h(
      native.Pressable as never,
      {
        onPress: close,
        style: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
      },
      h(
        native.Pressable as never,
        {
          // A press inside must not close it; only the backdrop does.
          onPress: () => {},
          ...common(props),
          style: {
            paddingHorizontal: tokens.space[3],
            paddingBottom: tokens.space[5],
            paddingTop: tokens.space[2],
            borderTopLeftRadius: tokens.radius.lg,
            borderTopRightRadius: tokens.radius.lg,
            backgroundColor: p.bg.overlay,
          },
        },
        h(
          native.View as never,
          { style: { width: 36, height: 4, borderRadius: 2, backgroundColor: p.border.strong, alignSelf: 'center', marginBottom: tokens.space[2] } },
        ),
        props.title
          ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: props.title })
          : null,
        ...rows.filter((row) => row !== null),
      ),
    ),
  )
}

/** One menu row. `role` is Android's, so TalkBack announces it as a menu item. */
function MenuRow({
  item,
  onActivate,
}: {
  item: MenuItemSpec
  onActivate: (item: MenuItemSpec) => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'menuitem',
      accessibilityLabel: item.label,
      accessibilityState: { disabled: item.disabled === true },
      disabled: item.disabled,
      onPress: () => onActivate(item),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        minHeight: tokens.size.touchTarget,
        paddingHorizontal: tokens.space[2],
        opacity: item.disabled ? 0.45 : 1,
      },
    },
    item.icon ? h(Text, { variant: 'md' }, item.icon) : null,
    h(Text, {
      variant: 'md',
      tone: item.tone === 'danger' ? 'error' : 'default',
      numberOfLines: 1,
      children: item.label,
    }),
    item.submenu ? h(Text, { tone: 'muted', children: '\u203a' }) : null,
  )
}

export function List<T>(props: ListProps<T>): ReactElement {
  return h(native.FlashList as never, {
    ...common(props),
    data: props.items,
    keyExtractor: props.keyExtractor,
    renderItem: ({ item, index }: { item: T; index: number }) => props.renderItem(item, index),
    onEndReached: props.onEndReached,
    onEndReachedThreshold: 0.5,
    ListEmptyComponent: props.empty as ReactNode,
  })
}

export function EmptyState(props: EmptyStateProps): ReactElement {
  return h(
    native.View as never,
    {
      ...common(props),
      style: {
        alignItems: 'center',
        gap: tokens.space[2],
        padding: tokens.space[6],
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

/** Long strings start clipped; tapping spreads them. A body can hold a URL no one needs all of. */
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
    native.Text as never,
    {
      onPress: clipped ? () => setSpread(true) : undefined,
      style: { color: props.palette.state.ok },
    },
    JSON.stringify(shown) + (clipped ? `… (+${props.value.length - STRING_CLIP})` : ''),
  )
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

  return h(
    native.View as never,
    { style: { paddingLeft: props.depth === 0 ? 0 : INDENT } },
    h(
      native.Pressable as never,
      {
        onPress: () => setOpen(!open),
        accessibilityRole: 'button',
        style: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space[1] },
      },
      h(native.Text as never, { style: { color: palette.text.disabled } }, open ? '▼' : '▶'),
      props.name !== undefined
        ? h(native.Text as never, { style: { color: palette.text.secondary } }, props.name)
        : null,
      h(native.Text as never, { style: { color: palette.text.primary } }, brace[0]),
      !open
        ? h(
            native.Text as never,
            { style: { color: palette.text.disabled } },
            `…} ${entries.length} ${Array.isArray(props.value) ? 'items' : 'keys'}`,
          )
        : null,
      h(native.Text as never, { style: { color: palette.text.primary } }, open ? '' : brace[1]),
    ),
    open
      ? h(
          native.View as never,
          { style: { borderLeftWidth: 1, borderLeftColor: palette.border.subtle, marginLeft: tokens.space[1] } },
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
          native.Text as never,
          { style: { color: palette.text.primary, paddingLeft: INDENT } },
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
  const rendered =
    typeof value === 'string'
      ? h(JsonString, { value, palette })
      : h(native.Text as never, { style: { color } }, value === undefined ? 'undefined' : String(value))

  return h(
    native.View as never,
    { style: { paddingLeft: INDENT, flexDirection: 'row', alignItems: 'baseline', gap: tokens.space[1] } },
    // The root entry has no name: the tree opens with the value itself.
    props.name !== '' ? h(native.Text as never, { style: { color: palette.text.secondary } }, props.name) : null,
    props.name !== '' ? h(native.Text as never, null, ':') : null,
    rendered,
  )
}

/**
 * A parsed JSON value as a collapsible tree.
 *
 * For *reading* a response — the test screen's output pane — not editing it.
 * Twin of the desktop kit's, down to the toolbar, the counts and the clip
 * behaviour; hover and arrow keys are the desktop half of that bargain.
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
    native.View as never,
    {
      testID: props.testID,
      accessibilityLabel: props.accessibilityLabel,
    },
    props.controls
      ? h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[3], marginBottom: tokens.space[1] } },
          h(Button, {
            variant: 'ghost',
            onPress: () => setDirective({ value: true, epoch: ++jsonEpoch }),
            children: 'Expand all',
          }),
          h(Button, {
            variant: 'ghost',
            onPress: () => setDirective({ value: false, epoch: ++jsonEpoch }),
            children: 'Collapse all',
          }),
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

export function Toast(props: ToastProps): ReactElement {
  const p = c()
  const backgroundColor =
    props.tone === 'error'
      ? p.state.error
      : props.tone === 'warn'
        ? p.state.warn
        : props.tone === 'ok'
          ? p.state.ok
          : p.bg.overlay
  return h(
    native.View as never,
    {
      ...common(props),
      // Announced without stealing focus, like the desktop twin.
      accessibilityLiveRegion: 'polite',
      accessibilityRole: 'alert',
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        paddingVertical: tokens.space[2],
        paddingHorizontal: tokens.space[4],
        borderRadius: tokens.radius.pill,
        backgroundColor,
      },
    },
    h(Text, {
      tone: props.tone && props.tone !== 'info' ? 'default' : 'default',
      children: props.message,
    }),
    props.action as ReactNode,
    props.onDismiss
      ? h(IconButton, { icon: '×', accessibilityLabel: 'Dismiss', onPress: props.onDismiss })
      : null,
  )
}
