import { createElement as h, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { TextProps } from '@BBeBee/ui-core'
import { common, toneColor } from '../theme.js'

export function weightFor(variant: NonNullable<TextProps['variant']>): string {
  if (variant === 'display' || variant === 'xl') return tokens.font.weight.heavy
  if (variant === 'lg') return tokens.font.weight.bold
  return tokens.font.weight.regular
}

export function Text(props: TextProps) {
  const { variant = 'md' } = props
  return h(
    'span',
    {
      ...common(props),
      style: {
        fontFamily: tokens.font.family.ui,
        fontSize: tokens.font.size[variant],
        fontWeight: weightFor(variant),
        lineHeight:
          variant === 'display' || variant === 'xl'
            ? tokens.font.lineHeight.tight
            : tokens.font.lineHeight.normal,
        color: toneColor(props.tone),
        display: props.numberOfLines ? '-webkit-box' : undefined,
        WebkitLineClamp: props.numberOfLines,
        WebkitBoxOrient: props.numberOfLines ? ('vertical' as const) : undefined,
        overflow: props.numberOfLines ? 'hidden' : undefined,
      },
    },
    props.children as ReactNode,
  )
}
