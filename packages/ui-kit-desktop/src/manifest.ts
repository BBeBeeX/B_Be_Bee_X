/**
 * What this kit exports, and which props each component accepts — as data.
 *
 * A separate module that imports **nothing**, so `ui-parity` can check both
 * kits in CI without loading React, a DOM, or React Native. That matters more
 * than it sounds: the mobile kit cannot be imported off-device at all, so a
 * gate that needed the real module would only ever run for one of the two —
 * which is the same as not having it.
 *
 * Declared rather than reflected because a React component's parameter names
 * are erased at runtime; a build step that recovered them would be a bigger
 * thing to trust than this list.
 */

import type { KitPropMap } from '@BBeBee/ui-parity'

export const KIT_TARGET = 'desktop' as const

export const COMPONENT_PROPS: KitPropMap = {
  Button: ['children', 'onPress', 'variant', 'disabled', 'loading', 'testID', 'accessibilityLabel'],
  IconButton: ['icon', 'onPress', 'accessibilityLabel', 'variant', 'disabled', 'size', 'testID'],
  TrackRow: [
    'track', 'onPress', 'onMore', 'active', 'showArtwork', 'showAlbum',
    'testID', 'accessibilityLabel',
  ],
  Slider: ['value', 'max', 'onChange', 'onCommit', 'disabled', 'testID', 'accessibilityLabel'],
  Sheet: ['open', 'onClose', 'title', 'children', 'testID', 'accessibilityLabel'],
  List: [
    'items', 'renderItem', 'keyExtractor', 'estimatedItemSize', 'onEndReached', 'empty',
    'testID', 'accessibilityLabel',
  ],
  EmptyState: ['title', 'description', 'action', 'icon', 'testID', 'accessibilityLabel'],
  Toast: ['message', 'tone', 'action', 'onDismiss', 'testID', 'accessibilityLabel'],
  Text: ['children', 'variant', 'tone', 'numberOfLines', 'testID', 'accessibilityLabel'],
  Artwork: ['artwork', 'size', 'radius', 'testID', 'accessibilityLabel'],
}

/** Component names this kit exports. The parity gate compares the two lists. */
export const COMPONENT_EXPORTS = Object.keys(COMPONENT_PROPS)
