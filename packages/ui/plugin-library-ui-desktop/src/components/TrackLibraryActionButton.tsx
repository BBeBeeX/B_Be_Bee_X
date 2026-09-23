import { createElement as h, useEffect, useState } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import type { Track } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export function TrackLibraryActionButton({
  track,
  hovered,
  inLibrary: initialInLibrary,
  onAddToFavorites,
  onOpenPlaylistMenu,
}: {
  track: Track
  hovered: boolean
  inLibrary: boolean
  onAddToFavorites?: () => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
}): ReactElement {
  const [inLibrary, setInLibrary] = useState(initialInLibrary)
  useEffect(() => {
    setInLibrary(initialInLibrary)
  }, [initialInLibrary])

  return h(
    'button',
    {
      type: 'button',
      'aria-label': inLibrary ? `Add ${track.title} to playlist` : `Add ${track.title} to favourites`,
      title: inLibrary ? '加入歌单' : '加入最喜欢的音乐',
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        if (inLibrary) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onOpenPlaylistMenu(track, { x: rect.left, y: rect.bottom + 4 })
        } else {
          setInLibrary(true)
          onAddToFavorites?.()
        }
      },
      style: {
        background: 'none',
        border: 'none',
        color: inLibrary ? '#1ed760' : '#b3b3b3',
        fontSize: inLibrary ? 16 : 18,
        fontWeight: 700,
        cursor: 'pointer',
        padding: '2px 4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.15s ease',
      },
    },
    inLibrary ? tablerIcon('heart-filled', { size: 16 }) : tablerIcon('plus', { size: 16 }),
  )
}
