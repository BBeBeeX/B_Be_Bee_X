import { useState } from 'react'
import type { ReactElement } from 'react'
import type { MenuItemSpec } from '@BBeBee/ui-core'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export type SortOrder = 'asc' | 'desc'

export interface TableSortOption<K extends string> {
  key: K
  label: string
}

export interface TableSortResult<K extends string> {
  sortKey: K
  setSortKey: (key: K) => void
  sortOrder: SortOrder
  setSortOrder: (order: SortOrder | ((prev: SortOrder) => SortOrder)) => void
  handleHeaderClick: (key: K) => void
  renderSortIndicator: (key: K) => ReactElement | null
  buildSortMenuItems: (options: readonly TableSortOption<K>[]) => MenuItemSpec[]
}

export function useTableSort<K extends string>(initialKey: K, initialOrder: SortOrder = 'asc'): TableSortResult<K> {
  const [sortKey, setSortKey] = useState<K>(initialKey)
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialOrder)

  const handleHeaderClick = (key: K) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const renderSortIndicator = (key: K): ReactElement | null => {
    if (sortKey !== key) return null
    return (sortOrder === 'asc'
      ? tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4 } })
      : tablerIcon('chevron-down', { size: 16, style: { marginLeft: 4 } })) as ReactElement
  }

  const buildSortMenuItems = (options: readonly TableSortOption<K>[]): MenuItemSpec[] => {
    return options.map(({ key, label }) => ({
      id: `sort-${key}`,
      label,
      icon: sortKey === key ? (tablerIcon('check', { size: 18 }) as ReactElement) : undefined,
      onSelect: () => {
        if (sortKey === key) {
          setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
        } else {
          setSortKey(key)
          setSortOrder('asc')
        }
      },
    }))
  }

  return {
    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    handleHeaderClick,
    renderSortIndicator,
    buildSortMenuItems,
  }
}
