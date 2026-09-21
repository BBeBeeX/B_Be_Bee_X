import { createElement as h, type ReactElement } from 'react'

export interface StatusMeterProps {
  value: number // 0 to 100
  label?: string
}

/**
 * Vertical status gauge matching the reference image top-left:
 * Multi-colored segment bar from 0% to 100% with tick marks.
 */
export function StatusMeter({ value, label = 'SYSTEM LOAD' }: StatusMeterProps): ReactElement {
  const clamped = Math.max(0, Math.min(100, value))

  // Height is 160px, width is 24px
  const height = 160
  const barWidth = 14
  const fillHeight = (clamped / 100) * height

  return h(
    'div',
    {
      'data-testid': 'status-meter',
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      },
    },
    // The vertical meter container
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          position: 'relative',
          height,
        },
      },
      // Gauge bar
      h(
        'div',
        {
          style: {
            width: barWidth,
            height,
            background: 'rgba(9, 14, 26, 0.8)',
            border: '1px solid rgba(138, 164, 206, 0.3)',
            borderRadius: 2,
            position: 'relative',
            overflow: 'hidden',
            boxShadow: 'inset 0 0 6px rgba(0, 0, 0, 0.8)',
          },
        },
        // Color segments background (gradient from red -> orange -> green -> cyan -> electric blue)
        h('div', {
          style: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: fillHeight,
            background:
              'linear-gradient(to top, #4158D0 0%, #10B981 40%, #F59E0B 75%, #EF4444 100%)',
            boxShadow: '0 0 8px rgba(65, 88, 208, 0.6)',
            transition: 'height 0.4s ease',
          },
        }),
        // Segment grid lines (horizontal ticks over the bar)
        ...Array.from({ length: 16 }).map((_, i) =>
          h('div', {
            key: i,
            style: {
              position: 'absolute',
              top: `${(i / 16) * 100}%`,
              left: 0,
              right: 0,
              height: 1,
              background: 'rgba(5, 7, 13, 0.6)',
              pointerEvents: 'none',
            },
          }),
        ),
      ),
      // Scale tick marks (100%, 75%, 50%, 25%, 0%)
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            marginLeft: 6,
            height,
            fontSize: 9,
            color: '#8EA4CE',
            letterSpacing: 0.5,
          },
        },
        h('span', { style: { transform: 'translateY(-4px)' } }, '- 100%'),
        h('span', { style: { transform: 'translateY(-2px)' } }, '- 75%'),
        h('span', null, '- 50%'),
        h('span', { style: { transform: 'translateY(2px)' } }, '- 25%'),
        h('span', { style: { transform: 'translateY(4px)' } }, '- 0%'),
      ),
    ),
    label
      ? h(
          'div',
          {
            style: {
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              transform: 'rotate(180deg)',
              fontSize: 9,
              letterSpacing: 1.5,
              color: 'rgba(142, 164, 206, 0.5)',
              fontWeight: 600,
            },
          },
          label,
        )
      : null,
  )
}
