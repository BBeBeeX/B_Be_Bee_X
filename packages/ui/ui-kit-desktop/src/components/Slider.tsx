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
  const activeColor = isInteracting ? 'var(--primary, #6366F1)' : 'var(--text-primary, #F5F7FF)'
  const trackBg = isInteracting
    ? `linear-gradient(to right, #4F6BFF 0%, var(--primary, #6366F1) ${percent}%, rgba(148, 163, 184, 0.14) ${percent}%, rgba(148, 163, 184, 0.14) 100%)`
    : `linear-gradient(to right, var(--text-primary, #F5F7FF) 0%, var(--text-primary, #F5F7FF) ${percent}%, rgba(148, 163, 184, 0.14) ${percent}%, rgba(148, 163, 184, 0.14) 100%)`

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
