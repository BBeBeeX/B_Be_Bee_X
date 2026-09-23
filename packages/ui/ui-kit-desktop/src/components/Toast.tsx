import { createElement as h, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ToastProps } from '@BBeBee/ui-core'
import { c, common } from '../theme.js'
import { IconButton } from './Button.js'
import { Text } from './Text.js'

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
