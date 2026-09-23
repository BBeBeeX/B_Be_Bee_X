import { createElement as h, useCallback, useState } from 'react'
import type React from 'react'
import type { SliderProps } from '@BBeBee/ui-core'
import { c, common, useHover } from '../theme.js'

export function Slider(props: SliderProps) {
  const { disabled = false } = props
  const [hovered, hoverProps] = useHover()
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const value = dragging ?? props.value

  const commit = useCallback(
    (next: number) => {
      setDragging(undefined)
      props.onCommit?.(next)
    },
    [props],
  )

  const max = props.max > 0 ? props.max : 1
  const percent = Math.max(0, Math.min(100, (value / max) * 100))
  const isInteracting = hovered || dragging !== undefined
  const activeColor = isInteracting ? c().accent.base : c().text.primary
  const trackBg = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${percent}%, rgba(255, 255, 255, 0.2) ${percent}%, rgba(255, 255, 255, 0.2) 100%)`

  return h('input', {
    ...common(props),
    ...hoverProps,
    type: 'range',
    min: 0,
    max: props.max,
    value,
    disabled,
    'aria-valuenow': value,
    'aria-valuemax': props.max,
    className: isInteracting ? 'is-dragging' : undefined,
    onChange: (event: { target: { value: string } }) => {
      const next = Number(event.target.value)
      setDragging(next)
      props.onChange?.(next)
    },
    onPointerUp: (event: { currentTarget: { value: string } }) =>
      commit(Number(event.currentTarget.value)),
    onKeyUp: (event: { currentTarget: { value: string } }) =>
      commit(Number(event.currentTarget.value)),
    onBlur: () => setDragging(undefined),
    style: {
      width: '100%',
      accentColor: activeColor,
      cursor: disabled ? 'default' : 'pointer',
      '--slider-track-bg': trackBg,
    } as React.CSSProperties,
  })
}
