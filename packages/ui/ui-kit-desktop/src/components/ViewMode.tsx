/**
 * View mode selector for track/album tables.
 *
 * A page offers 紧凑 (no covers, artists as their own column) and 列表 (the
 * full row with covers); album grids may additionally offer 平铺 (the card
 * grid). The choice persists per page in `localStorage` so a page the user
 * prefers compact stays compact.
 */

import { createElement as h, useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import { tablerIcon } from '../icons/index.js'

export type TrackViewMode = 'compact' | 'list'
export type AlbumViewMode = TrackViewMode | 'tiled'

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const stored = window.localStorage?.getItem(key)
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T
  } catch {
    // Storage unavailable — the fallback is the answer.
  }
  return fallback
}

/** View-mode state persisted under `bbebee_view_mode:<key>`. */
export function useViewMode<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (mode: TrackViewMode | AlbumViewMode) => void] {
  const [mode, setMode] = useState<T>(() => readStored(`bbebee_view_mode:${key}`, fallback, allowed))
  const update = useCallback(
    (next: TrackViewMode | AlbumViewMode) => {
      setMode(next as T)
      try {
        window.localStorage?.setItem(`bbebee_view_mode:${key}`, next)
      } catch {
        // Storage unavailable — the choice lives for this session only.
      }
    },
    [key],
  )
  return [mode, update]
}

const MODE_LABELS = { compact: '紧凑', list: '列表', tiled: '平铺' } as const

/**
 * `视图模式: 紧凑/列表(/平铺)` — a segmented capsule rendered next to the
 * page's sort control. The active segment is highlighted, not filled.
 */
export function ViewModeSelector({
  value,
  onChange,
  allowTiled = false,
  testIDPrefix,
}: {
  value: TrackViewMode | AlbumViewMode
  onChange: (mode: TrackViewMode | AlbumViewMode) => void
  allowTiled?: boolean
  testIDPrefix?: string
}): ReactElement {
  const modes: (TrackViewMode | AlbumViewMode)[] = allowTiled
    ? ['compact', 'list', 'tiled']
    : ['compact', 'list']
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      },
    },
    h(
      'span',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: '#b3b3b3',
          fontSize: 13,
        },
      },
      tablerIcon('layout-grid', { size: 16 }),
      '视图模式',
    ),
    h(
      'div',
      {
        role: 'group',
        'aria-label': '视图模式',
        style: {
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: '2px',
        },
      },
      modes.map((mode) => {
        const active = value === mode
        return h(
          'button',
          {
            key: mode,
            type: 'button',
            'aria-pressed': active,
            'data-testid': testIDPrefix ? `${testIDPrefix}-view-${mode}` : undefined,
            onClick: () => onChange(mode),
            style: {
              padding: '3px 12px',
              borderRadius: 14,
              border: 'none',
              background: active ? 'rgba(255, 255, 255, 0.16)' : 'transparent',
              color: active ? '#FFFFFF' : '#b3b3b3',
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            },
          },
          MODE_LABELS[mode],
        )
      }),
    ),
  )
}
