import { palettes, type Palette, type Scheme } from '@BBeBee/ui-tokens'
import type { Tone } from '@BBeBee/ui-core'

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

export const c = (): Palette => palettes[scheme]

/** Common attributes. React Native spells both of these its own way. */
export function common(props: { testID?: string; accessibilityLabel?: string }): {
  testID?: string
  accessibilityLabel?: string
} {
  return { testID: props.testID, accessibilityLabel: props.accessibilityLabel }
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
