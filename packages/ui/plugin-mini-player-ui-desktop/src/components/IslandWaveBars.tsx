import { createElement as h } from 'react'
import type { ReactElement } from 'react'

export interface IslandWaveBarsProps {
  isPlaying: boolean
  color?: string
  barCount?: number
  height?: number
}

export function IslandWaveBars({
  isPlaying,
  color = 'var(--waveform-active, var(--color-primary, #5F87FF))',
  barCount = 4,
  height = 16,
}: IslandWaveBarsProps): ReactElement {
  const bars = Array.from({ length: barCount }, (_, i) => i)

  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        height,
        padding: '0 2px',
      },
    },
    ...bars.map((index) =>
      h('span', {
        key: index,
        style: {
          width: 2.5,
          height: isPlaying ? '100%' : '20%',
          backgroundColor: color,
          borderRadius: 2,
          animation: isPlaying ? `miniPlayerWaveBar 0.8s ease-in-out infinite alternate` : 'none',
          animationDelay: `${index * 0.15}s`,
          transition: 'height 0.2s ease',
          willChange: 'transform',
        },
      }),
    ),
  )
}
