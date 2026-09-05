/**
 * The mobile kit, off device.
 *
 * `react-native` is injected rather than imported precisely so this file can
 * exist: the components are inspected as React element trees, with fake
 * primitives standing in for the real ones. That covers the half that is
 * genuinely shared with desktop — which props reach which element, what is
 * announced to a screen reader, what the tap target measures — and leaves
 * only pixels to the device smoke matrix.
 */

import { describe, expect, it, vi } from 'vitest'
import { tokens } from '@BBeBee/ui-tokens'
import { createElement as h, isValidElement } from 'react'
import type { ReactElement } from 'react'
import type { Track } from '@BBeBee/protocol'
import {
  Artwork,
  Button,
  EmptyState,
  IconButton,
  List,
  Sheet,
  Slider,
  Text,
  TextField,
  Toast,
  TrackRow,
  configureNative,
  nativePrimitives,
} from './index.js'

const NATIVE = {
  View: 'RNView',
  Text: 'RNText',
  Pressable: 'RNPressable',
  Image: 'RNImage',
  Modal: 'RNModal',
  FlatList: 'RNFlatList',
  ActivityIndicator: 'RNSpinner',
  TextInput: 'RNTextInput',
}
configureNative(NATIVE)

const track: Track = {
  urn: 'BBeBee:local:track:1',
  title: 'Jóga',
  artists: [{ urn: 'BBeBee:local:artist:1', name: 'Björk', role: 'main', ordinal: 0 }],
  albumTitle: 'Homogenic',
  available: true,
}

/** Every element in a tree, flattened, so a test can look for one. */
function walk(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (!isValidElement(node)) return out
  out.push(node)
  const props = node.props as { children?: unknown }
  if (props.children !== undefined) walk(props.children, out)
  return out
}

/** Render a function component one level, then flatten what it produced. */
function tree(element: ReactElement): ReactElement[] {
  const type = element.type as (p: unknown) => ReactElement | null
  const rendered = typeof type === 'function' ? type(element.props) : element
  return rendered ? walk(rendered) : []
}

const find = (element: ReactElement, type: string) =>
  tree(element).find((n) => n.type === type)

describe('native injection', () => {
  it('uses the primitives the shell configured', () => {
    expect(nativePrimitives()).toBe(NATIVE)
  })

  it('renders without them, so a tree is inspectable before boot', () => {
    // A shell that forgot to configure gets an obviously wrong screen rather
    // than a crash in a render pass nobody can read.
    expect(() => tree(h(Text, { children: 'x' }))).not.toThrow()
  })
})

describe('Button', () => {
  it('is a pressable with a button role', () => {
    const node = find(h(Button, { onPress: () => {}, children: 'Play' }), 'RNPressable')
    expect(node).toBeDefined()
    expect((node!.props as { accessibilityRole: string }).accessibilityRole).toBe('button')
  })

  it('disables and reports busy while loading', () => {
    const node = find(h(Button, { onPress: () => {}, loading: true, children: 'x' }), 'RNPressable')
    const props = node!.props as { disabled: boolean; accessibilityState: { busy: boolean } }
    expect(props.disabled).toBe(true)
    expect(props.accessibilityState.busy).toBe(true)
  })

  it('does not fire while disabled', () => {
    const onPress = vi.fn()
    const node = find(h(Button, { onPress, disabled: true, children: 'x' }), 'RNPressable')
    expect((node!.props as { onPress?: () => void }).onPress).toBeUndefined()
  })

  it('shows a spinner rather than the label while loading', () => {
    expect(find(h(Button, { onPress: () => {}, loading: true, children: 'x' }), 'RNSpinner'))
      .toBeDefined()
  })
})

describe('IconButton', () => {
  it('carries its accessible name', () => {
    const node = find(
      h(IconButton, { icon: '⏭', accessibilityLabel: 'Next track', onPress: () => {} }),
      'RNPressable',
    )
    expect((node!.props as { accessibilityLabel: string }).accessibilityLabel).toBe('Next track')
  })

  it('meets the minimum tap target regardless of icon size', () => {
    const node = find(
      h(IconButton, { icon: '·', accessibilityLabel: 'More', onPress: () => {}, size: 8 }),
      'RNPressable',
    )
    expect((node!.props as { style: { width: number } }).style.width).toBe(44)
  })
})

describe('TrackRow', () => {
  it('binds the overflow to a long press, the mobile half of onMore', () => {
    const onMore = vi.fn()
    const node = find(h(TrackRow, { track, onMore }), 'RNPressable')
    expect((node!.props as { onLongPress?: () => void }).onLongPress).toBe(onMore)
  })

  it('shows the album only when asked', () => {
    const withAlbum = tree(h(TrackRow, { track, showAlbum: true }))
    expect(JSON.stringify(withAlbum.map((n) => n.props))).toContain('Homogenic')
    const without = tree(h(TrackRow, { track }))
    expect(JSON.stringify(without.map((n) => n.props))).not.toContain('Homogenic')
  })
})

describe('Slider', () => {
  it('reports its range as an adjustable control', () => {
    const node = tree(h(Slider, { value: 30, max: 100 }))[0]!
    const props = node.props as {
      accessibilityRole: string
      accessibilityValue: { now: number; max: number }
    }
    expect(props.accessibilityRole).toBe('adjustable')
    expect(props.accessibilityValue).toMatchObject({ now: 30, max: 100 })
  })

  it('does not divide by a zero duration', () => {
    // A track whose duration is not known yet is the ordinary case at load.
    expect(() => tree(h(Slider, { value: 0, max: 0 }))).not.toThrow()
  })
})

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    expect(tree(h(Sheet, { open: false, onClose: () => {}, children: 'x' }))).toEqual([])
  })

  it('closes on the Android back button', () => {
    // Without `onRequestClose` the sheet is a trap on Android.
    const onClose = vi.fn()
    const node = find(h(Sheet, { open: true, onClose, children: 'x' }), 'RNModal')
    expect((node!.props as { onRequestClose: () => void }).onRequestClose).toBe(onClose)
  })
})

describe('List', () => {
  it('hands the virtualiser its keys and its size hint', () => {
    const keyExtractor = (i: { id: string }) => i.id
    const node = tree(
      h(List<{ id: string }>, {
        items: [{ id: 'a' }],
        keyExtractor,
        renderItem: () => null,
        estimatedItemSize: 56,
      }),
    )[0]!
    const props = node.props as {
      keyExtractor: unknown
      getItemLayout: (d: unknown, i: number) => { length: number; offset: number }
    }
    expect(props.keyExtractor).toBe(keyExtractor)
    expect(props.getItemLayout(null, 2)).toMatchObject({ length: 56, offset: 112 })
  })

  it('omits the layout hint when none was given, rather than guessing', () => {
    const node = tree(
      h(List<{ id: string }>, { items: [], keyExtractor: (i) => i.id, renderItem: () => null }),
    )[0]!
    expect((node.props as { getItemLayout?: unknown }).getItemLayout).toBeUndefined()
  })
})

describe('Toast', () => {
  it('announces politely rather than stealing focus', () => {
    const node = tree(h(Toast, { message: 'Saved' }))[0]!
    expect((node.props as { accessibilityLiveRegion: string }).accessibilityLiveRegion).toBe(
      'polite',
    )
  })
})

describe('Artwork and EmptyState', () => {
  it('paints the dominant colour behind the image', () => {
    const node = tree(h(Artwork, { size: 48, artwork: { id: 'a', dominantColor: '#3a5f7d' } }))[0]!
    expect((node.props as { style: { backgroundColor: string } }).style.backgroundColor).toBe(
      '#3a5f7d',
    )
  })

  it('renders no image when there is nothing to show', () => {
    expect(find(h(Artwork, { size: 48 }), 'RNImage')).toBeUndefined()
  })

  it('gives an empty screen something to say', () => {
    const nodes = tree(h(EmptyState, { title: 'No tracks yet', description: 'Add a folder' }))
    expect(JSON.stringify(nodes.map((n) => n.props))).toContain('No tracks yet')
  })
})

describe('TextField', () => {
  it('is controlled, like its desktop twin', () => {
    /*
     * React Native's `TextInput` is happy to be uncontrolled, and a kit where
     * one platform keeps its own state and the other does not diverges the
     * moment anything resets the field — which the import screen does on every
     * successful paste.
     */
    const input = find(
      h(TextField, { value: 'abc', onChange: () => {}, accessibilityLabel: 'Rule' }),
      'RNTextInput',
    )
    expect(input?.props).toMatchObject({ value: 'abc' })
    expect(typeof (input?.props as { onChangeText?: unknown }).onChangeText).toBe('function')
  })

  it('turns autocorrect and capitalisation off', () => {
    // A rule and a URL are both case- and spelling-sensitive, and a phone
    // keyboard rewriting one produces a source that fails for a reason nothing
    // on screen explains.
    const input = find(
      h(TextField, { value: '', onChange: () => {}, accessibilityLabel: 'Rule' }),
      'RNTextInput',
    )
    expect(input?.props).toMatchObject({ autoCorrect: false, autoCapitalize: 'none' })
  })

  it('grows for a pasted document and stays tappable for a rule', () => {
    const many = find(
      h(TextField, { value: '', onChange: () => {}, multiline: true, rows: 6, accessibilityLabel: 'Doc' }),
      'RNTextInput',
    )
    const single = find(
      h(TextField, { value: '', onChange: () => {}, accessibilityLabel: 'Rule' }),
      'RNTextInput',
    )
    const heightOf = (n: ReactElement | undefined) =>
      (n?.props as { style?: { minHeight?: number } }).style?.minHeight ?? 0
    expect(heightOf(many)).toBeGreaterThan(heightOf(single))
    expect(heightOf(single)).toBeGreaterThanOrEqual(tokens.size.touchTarget)
  })

  it('hides a secure value', () => {
    const input = find(
      h(TextField, { value: 'hunter2', onChange: () => {}, secure: true, accessibilityLabel: 'Password' }),
      'RNTextInput',
    )
    expect(input?.props).toMatchObject({ secureTextEntry: true })
  })

  it('renders an error rather than hiding it', () => {
    const nodes = tree(
      h(TextField, {
        value: '{',
        onChange: () => {},
        error: 'sourceUrl: must be a string',
        accessibilityLabel: 'Doc',
      }),
    )
    expect(JSON.stringify(nodes.map((n) => n.props))).toContain('sourceUrl: must be a string')
  })
})
