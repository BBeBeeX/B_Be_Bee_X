import { createElement as h, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ToastProps } from '@BBeBee/ui-core'
import { c, common } from '../theme.js'
import { IconButton } from './Button.js'
import { Text } from './Text.js'

export function Toast(props: ToastProps) {
  const background =
    props.tone === 'error'
      ? 'var(--error, #EF4444)'
      : props.tone === 'warn'
        ? 'var(--warning, #F59E0B)'
        : props.tone === 'ok'
          ? 'var(--success, #22C55E)'
          : 'var(--surface-3, #151927)'
  const border =
    props.tone === 'error'
      ? '1px solid var(--error, #EF4444)'
      : props.tone === 'warn'
        ? '1px solid var(--warning, #F59E0B)'
        : props.tone === 'ok'
          ? '1px solid var(--success, #22C55E)'
          : '1px solid var(--border-default, rgba(148,163,184,0.14))'
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
        border,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), var(--glow-sm)',
        color: props.tone && props.tone !== 'info' ? '#FFFFFF' : 'var(--text-primary, #F5F7FF)',
        zIndex: tokens.z.toast,
      },
    },
    h(Text, { children: props.message }),
    props.action as ReactNode,
    props.onDismiss
      ? h(IconButton, { icon: 'x', accessibilityLabel: 'Dismiss', onPress: props.onDismiss })
      : null,
  )
}
