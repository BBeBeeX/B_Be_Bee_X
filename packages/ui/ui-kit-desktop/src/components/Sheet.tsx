import { createElement as h, useRef, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { SheetProps } from '@BBeBee/ui-core'
import { c, common } from '../theme.js'

export function Sheet(props: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  if (!props.open) return null
  const p = c()
  return h(
    'div',
    {
      ...common(props),
      role: 'dialog',
      'aria-modal': true,
      ref,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Escape') props.onClose()
      },
      style: {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        zIndex: tokens.z.overlay,
      },
      onClick: props.onClose,
    },
    h(
      'div',
      {
        onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
        style: {
          minWidth: 320,
          maxWidth: 560,
          padding: tokens.space[5],
          borderRadius: tokens.radius.lg,
          background: p.bg.raised,
          color: p.text.primary,
        },
      },
      props.title ? h('h2', { style: { margin: `0 0 ${tokens.space[3]}px` } }, props.title) : null,
      props.children as ReactNode,
    ),
  )
}
