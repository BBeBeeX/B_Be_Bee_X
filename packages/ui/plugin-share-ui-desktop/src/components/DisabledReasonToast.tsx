import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface DisabledReasonToastProps {
  message: string | null
}

export function DisabledReasonToast({ message }: DisabledReasonToastProps): ReactElement | null {
  if (!message) return null

  return h(
    'div',
    {
      'data-testid': 'copy-disabled-reason-toast',
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(245, 158, 11, 0.15)',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        color: '#FCD34D',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxSizing: 'border-box',
      },
    },
    tablerIcon('alert-circle', { size: 16 }),
    h('span', null, message),
  )
}
