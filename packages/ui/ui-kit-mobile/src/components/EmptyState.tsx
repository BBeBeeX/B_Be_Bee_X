import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { EmptyStateProps } from '@BBeBee/ui-core'
import { common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'

export function EmptyState(props: EmptyStateProps): ReactElement {
  const native = nativePrimitives()
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
