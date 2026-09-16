import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'

export interface SettingsSectionProps {
  title: string
  description?: string
  children?: ReactNode
}

export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps): ReactElement {
  return h(
    'section',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        marginBottom: 24,
      },
    },
    h(
      'header',
      { style: { marginBottom: 4 } },
      h('h3', { style: { fontSize: 14, fontWeight: 600, color: '#f5f5f7', margin: 0 } }, title),
      description
        ? h('p', { style: { fontSize: 12, color: '#8e8e93', margin: '4px 0 0' } }, description)
        : null,
    ),
    children,
  )
}
