import { createElement as h } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

export interface SettingsSectionProps {
  id?: string
  title: string
  description?: string
  children?: ReactNode
  style?: CSSProperties
}

export function SettingsSection({
  id,
  title,
  description,
  children,
  style,
}: SettingsSectionProps): ReactElement {
  return h(
    'section',
    {
      id,
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 48,
        scrollMarginTop: 24,
        ...style,
      },
    },
    h(
      'header',
      {
        style: {
          paddingBottom: 10,
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          marginBottom: 4,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 16,
            fontWeight: 600,
            color: '#FFFFFF',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        title,
      ),
      description
        ? h(
            'p',
            {
              style: {
                fontSize: 12,
                color: '#8E8E93',
                margin: '4px 0 0',
                lineHeight: 1.4,
              },
            },
            description,
          )
        : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
        },
      },
      children,
    ),
  )
}
