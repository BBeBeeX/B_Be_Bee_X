import { createElement as h, useCallback, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { SliderProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'

/** One accessibility step, as a fraction of the range. */
const SLIDER_STEP = 0.05

export function Slider(props: SliderProps): ReactElement {
  const native = nativePrimitives()
  const { disabled = false } = props

  /*
   * Draggable, through React Native's own responder system.
   *
   * Not `react-native-gesture-handler`: a touch that owns itself for the
   * length of a drag is exactly what the responder system is for, and taking
   * the dependency would put a native module in the kit — which is the one
   * thing `configureNative` exists to keep out (docs/08 §6).
   *
   * The track's width arrives from `onLayout` rather than a measure call,
   * because `measure()` is async and a scrubber cannot wait a frame to know
   * where the finger is.
   */
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const width = useRef(0)
  const value = dragging ?? props.value

  const at = useCallback(
    (x: number): number => {
      if (width.current <= 0 || props.max <= 0) return 0
      const fraction = Math.max(0, Math.min(1, x / width.current))
      return Math.round(fraction * props.max)
    },
    [props.max],
  )

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = Math.max(
        0,
        Math.min(props.max, Math.round(value + direction * props.max * SLIDER_STEP)),
      )
      props.onChange?.(next)
      props.onCommit?.(next)
    },
    [props, value],
  )

  const p = c()
  return h(
    native.View as never,
    {
      ...common(props),
      accessibilityRole: 'adjustable',
      accessibilityValue: { min: 0, max: props.max, now: value },
      accessibilityState: { disabled },
      /*
       * `increment`/`decrement`, not "commit the value it already has".
       * A screen-reader user swiping up on a scrubber means "forward", and
       * committing `value` unchanged is a seek to where the track already is
       * — a control that looks adjustable and adjusts nothing.
       */
      onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
        if (disabled) return
        if (event.nativeEvent.actionName === 'increment') step(1)
        else if (event.nativeEvent.actionName === 'decrement') step(-1)
      },
      style: {
        height: tokens.size.touchTarget,
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      },
    },
    h(
      native.View as never,
      {
        onLayout: (event: { nativeEvent: { layout: { width: number } } }) => {
          width.current = event.nativeEvent.layout.width
        },
        // Claim the touch on the way down, so a drag that starts here is not
        // stolen by a scroll view above it.
        onStartShouldSetResponder: () => !disabled,
        onMoveShouldSetResponder: () => !disabled,
        onResponderGrant: (event: { nativeEvent: { locationX: number } }) => {
          const next = at(event.nativeEvent.locationX)
          setDragging(next)
          props.onChange?.(next)
        },
        onResponderMove: (event: { nativeEvent: { locationX: number } }) => {
          const next = at(event.nativeEvent.locationX)
          setDragging(next)
          props.onChange?.(next)
        },
        onResponderRelease: (event: { nativeEvent: { locationX: number } }) => {
          const next = at(event.nativeEvent.locationX)
          setDragging(undefined)
          props.onCommit?.(next)
        },
        // A drag the OS takes away — a call arriving, a parent scroll winning
        // — must not leave the thumb stranded where the finger left it.
        onResponderTerminate: () => setDragging(undefined),
        onResponderTerminationRequest: () => false,
        style: { height: 4, borderRadius: 2, backgroundColor: p.bg.overlay },
      },
      h(native.View as never, {
        style: {
          height: 4,
          borderRadius: 2,
          // White at rest, like the desktop scrubber: a green rail at rest
          // competes with every other accent on the screen.
          backgroundColor: p.text.primary,
          width: `${props.max > 0 ? Math.min(100, (value / props.max) * 100) : 0}%`,
        },
      }),
    ),
  )
}
