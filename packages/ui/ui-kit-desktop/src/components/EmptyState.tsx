import { createElement as h, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { EmptyStateProps } from '@BBeBee/ui-core'
import { common } from '../theme.js'
import { tablerIcon } from '../icons/index.js'
import { Text } from './Text.js'

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
    props.icon
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'currentColor',
              opacity: 0.8,
              marginBottom: tokens.space[1],
            },
          },
          tablerIcon(props.icon, { size: 40 }),
        )
      : null,
    h(Text, { variant: 'lg', children: props.title }),
    props.description ? h(Text, { tone: 'muted', children: props.description }) : null,
    props.action as ReactNode,
  )
}
