import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ToastProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'
import { IconButton } from './Button.js'

export function Toast(props: ToastProps): ReactElement {
  const native = nativePrimitives()
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
