import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ButtonProps, IconButtonProps } from '@BBeBee/ui-core'
import { buttonStyle, common, useHover } from '../theme.js'
import { tablerIcon } from '../icons/index.js'

export function Button(props: ButtonProps) {
  const { variant = 'primary', disabled = false, loading = false } = props
  const off = disabled || loading
  const [hovered, hoverProps] = useHover()
  return h(
    'button',
    {
      ...common(props),
      ...hoverProps,
      type: 'button',
      disabled: off,
      'aria-busy': loading || undefined,
      onClick: off ? undefined : props.onPress,
      style: buttonStyle(variant, off, hovered),
    },
    loading ? '…' : (props.children as ReactNode),
  )
}

export function IconButton(props: IconButtonProps): ReactElement {
  const { variant = 'ghost', disabled = false, size = tokens.size.icon } = props
  const [hovered, hoverProps] = useHover()
  const renderedIcon = tablerIcon(props.icon, {
    size,
    'data-icon': typeof props.icon === 'string' ? props.icon : undefined,
  }) as ReactNode

  return h(
    'button',
    {
      ...common(props),
      ...hoverProps,
      type: 'button',
      disabled,
      onClick: disabled ? undefined : props.onPress,
      style: {
        ...buttonStyle(variant, disabled, hovered),
        width: tokens.size.touchTarget,
        minHeight: tokens.size.touchTarget,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size,
        borderRadius: tokens.radius.pill,
      },
    },
    renderedIcon,
  )
}
