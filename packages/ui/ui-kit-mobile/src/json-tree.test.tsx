// @vitest-environment jsdom
/**
 * The mobile JsonTree, rendered in a DOM.
 *
 * The kit's main test file inspects element trees one level deep, which a
 * stateful component cannot survive — hooks need a renderer. This file gives
 * the tree a real one, with host components standing in for React Native, so
 * the desktop twin's behaviour (collapse, expand, clip, spread) is pinned
 * on this side too rather than assumed from the shared props list.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { configureNative, JsonTree } from './index.js'

afterEach(cleanup)

/** A fake native host: a `div` that keeps the RN props it was given. */
function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, testID, onPress } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: hostComponent('FlashList'),
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

describe('JsonTree on mobile', () => {
  it('renders the shape, and keeps deep levels collapsed', () => {
    const view = render(
      h(JsonTree, {
        value: { a: { b: { c: 1 } }, list: [1, 2], ok: true, none: null },
        accessibilityLabel: 'Response',
      }),
    )
    expect(view.container.textContent).toContain('a')
    expect(view.container.textContent).toContain('1 keys')
    expect(view.container.textContent).not.toContain('"c"')
    expect(view.container.textContent).toContain('null')
  })

  it('expands a collapsed branch on tap', async () => {
    const view = render(h(JsonTree, { value: { a: { deep: 7 } }, defaultExpandedDepth: 1 }))
    expect(view.container.textContent).not.toContain('7')

    const branches = view.container.querySelectorAll<HTMLElement>('[data-host="Pressable"]')
    await act(async () => {
      branches[branches.length - 1]!.click()
    })
    expect(view.container.textContent).toContain('7')
  })

  it('clips a long string until it is tapped', async () => {
    const view = render(h(JsonTree, { value: { url: 'x'.repeat(400) }, defaultExpandedDepth: 3 }))
    expect(view.container.textContent).toContain('(+100)')

    const clipped = Array.from(view.container.querySelectorAll('[data-host="Text"]')).find((el) =>
      el.textContent?.includes('(+100)'),
    ) as HTMLElement
    await act(async () => {
      clipped.click()
    })
    expect(view.container.textContent?.includes('(+100)')).toBe(false)
  })
})
