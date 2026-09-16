import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'

export interface SettingsRowProps {
  title: string
  description?: string
  action?: ReactNode
}

export function SettingsRow({ title, description, action }: SettingsRowProps): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: 8,
        border: '1px solid rgba(255, 255, 255, 0.05)',
        gap: 16,
      },
    },
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontSize: 13, fontWeight: 500, color: '#f5f5f7' } }, title),
      description
        ? h(
            'div',
            { style: { fontSize: 11, color: '#8e8e93', marginTop: 2, lineHeight: 1.4 } },
            description,
          )
        : null,
    ),
    action ? h('div', { style: { display: 'flex', alignItems: 'center' } }, action) : null,
  )
}
