import { createElement as h, useCallback, useState } from 'react'
import type React from 'react'
import type { SliderProps } from '@BBeBee/ui-core'
import { common, useHover } from '../theme.js'

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
  const activeColor = isInteracting ? 'var(--slider-thumb, var(--color-primary, #5F87FF))' : 'var(--text-primary, #FFFFFF)'
  const trackBg = isInteracting
    ? `linear-gradient(to right, var(--electric-blue-600, #4F73FF) 0%, var(--color-primary, #5F87FF) ${percent * 0.5}%, var(--periwinkle-500, #7C86FF) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) 100%)`
    : `linear-gradient(to right, var(--text-primary, #FFFFFF) 0%, var(--text-primary, #FFFFFF) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) 100%)`

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
