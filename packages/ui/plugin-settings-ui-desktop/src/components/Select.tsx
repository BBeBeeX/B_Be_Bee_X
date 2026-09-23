import { createElement as h } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export interface SelectProps<T extends string> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  accessibilityLabel?: string
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  accessibilityLabel,
}: SelectProps<T>): ReactElement {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value as T)
  }

  return h(
    'div',
    {
      style: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
      },
    },
    h(
      'select',
      {
        value,
        onChange: handleChange,
        disabled,
        'aria-label': accessibilityLabel,
        style: {
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          background: 'rgba(255, 255, 255, 0.07)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 6,
          padding: '6px 30px 6px 12px',
          color: disabled ? '#6A6A6A' : '#F5F5F7',
          fontSize: 13,
          fontWeight: 400,
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          transition: 'all 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          if (!disabled) {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
          }
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          if (!disabled) {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
          }
        },
        onFocus: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.borderColor = '#1DB954'
          e.currentTarget.style.boxShadow = '0 0 0 1px #1DB954'
        },
        onBlur: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
          e.currentTarget.style.boxShadow = 'none'
        },
      },
      options.map((opt) =>
        h(
          'option',
          {
            key: opt.value,
            value: opt.value,
            style: {
              background: '#1A1A22',
              color: '#FFFFFF',
            },
          },
          opt.label,
        ),
      ),
    ),
    // Downward chevron icon
    tablerIcon('chevron-down', {
      size: 12,
      color: disabled ? '#6A6A6A' : '#8E8E93',
      style: {
        position: 'absolute',
        right: 10,
        pointerEvents: 'none',
      },
    }),
  )
}
