import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { SheetProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'

export function Sheet(props: SheetProps): ReactElement | null {
  if (!props.open) return null
  const native = nativePrimitives()
  const p = c()
  return h(
    native.Modal as never,
    {
      ...common(props),
      visible: props.open,
      transparent: true,
      animationType: 'slide',
      // The Android back button must close it, or the sheet is a trap.
      onRequestClose: props.onClose,
    },
    h(
      native.Pressable as never,
      {
        onPress: props.onClose,
        style: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
      },
      h(
        native.Pressable as never,
        {
          // A press inside must not close it; only the backdrop does.
          onPress: () => {},
          style: {
            padding: tokens.space[5],
            borderTopLeftRadius: tokens.radius.lg,
            borderTopRightRadius: tokens.radius.lg,
            backgroundColor: p.bg.raised,
          },
        },
        props.title ? h(Text, { variant: 'lg', children: props.title }) : null,
        props.children as ReactNode,
      ),
    ),
  )
}
