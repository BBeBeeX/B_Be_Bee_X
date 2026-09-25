import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { TextField, tablerIcon } from '@BBeBee/ui-kit-desktop'

export type LibraryFilterKey = 'all' | 'playlist' | 'album' | 'artist' | 'downloaded'
export type LibrarySortMode = 'creator' | 'recent-added' | 'recent-played' | 'alphabetical'

export const LIBRARY_FILTER_BUTTONS = [
  { key: 'playlist', label: '歌单' },
  { key: 'album', label: '专辑' },
  { key: 'artist', label: '艺人' },
] as const

export const LIBRARY_SORT_LABELS: Record<LibrarySortMode, string> = {
  creator: '创建者',
  'recent-added': '最近添加',
  'recent-played': '最近播放',
  alphabetical: '按字母排序',
}

export interface LibraryToolbarProps {
  activeFilter: LibraryFilterKey
  setActiveFilter: (filter: LibraryFilterKey) => void
  searchOpen: boolean
  setSearchOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  sortMode: LibrarySortMode
  setSortMenuAnchor: (anchor: MenuAnchor | undefined) => void
  /** The 艺人 chip only makes sense when the library actually holds artists. */
  hasArtists?: boolean
}

export function LibraryToolbar({
  activeFilter,
  setActiveFilter,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  sortMode,
  setSortMenuAnchor,
  hasArtists = true,
}: LibraryToolbarProps): ReactElement {
  const filterButtons = LIBRARY_FILTER_BUTTONS.filter(({ key }) => key !== 'artist' || hasArtists)
  return h(
    'div',
    null,
    // Filter Pills
    h(
      'div',
      {
        style: {
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
        },
      },
      filterButtons.map(({ key, label }) => {
        const active = activeFilter === key
        return h(
          'button',
          {
            key,
            type: 'button',
            onClick: () => setActiveFilter(active ? 'all' : key),
            style: {
              padding: '5px 12px',
              borderRadius: 16,
              border: 'none',
              backgroundColor: active ? '#FFFFFF' : '#242424',
              color: active ? '#000000' : '#FFFFFF',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            },
          },
          label,
        )
      }),
    ),
    // Search + Sort Row
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h(
          'button',
          {
            type: 'button',
            'aria-label': '搜索',
            title: '搜索',
            onClick: () => setSearchOpen((prev) => !prev),
            style: {
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: searchOpen ? '#FFFFFF' : '#A0A0AE',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          tablerIcon('search', { size: 20 }),
        ),
        searchOpen
          ? h(TextField, {
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: '搜索音乐库内容...',
              testID: 'library-search-input',
            })
          : null,
      ),
        // The sort label steps aside while the search field needs the row.
        h(
          'button',
          {
            type: 'button',
            onClick: (e: { clientX: number; clientY: number }) =>
              setSortMenuAnchor({ x: e.clientX, y: e.clientY }),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 'none',
              color: '#A0A0AE',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            },
          },
          searchOpen ? null : h('span', null, LIBRARY_SORT_LABELS[sortMode]),
          tablerIcon('list', { size: 20 }),
        ),
    ),
  )
}
