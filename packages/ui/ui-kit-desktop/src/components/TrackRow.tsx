import { createElement as h } from 'react'
import type React from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { c, common, useHover } from '../theme.js'
import { Artwork } from './Artwork.js'
import { Text } from './Text.js'
import { IconButton } from './Button.js'

export function TrackRow(props: TrackRowProps) {
  const { active = false, showArtwork = true, showAlbum = false } = props
  const p = c()
  const [hovered, hoverProps] = useHover()
  const artists = props.track.artists?.map((a) => a.name).join(', ')

  return h(
    'div',
    {
      ...common(props),
      role: 'row',
      tabIndex: 0,
      onClick: props.onPress,
      onContextMenu: props.onMore
        ? (event: { preventDefault(): void; clientX?: number; clientY?: number }) => {
            event.preventDefault()
            props.onMore?.({
              x: event.clientX ?? 0,
              y: event.clientY ?? 0,
            })
          }
        : undefined,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Enter' || event.key === ' ') props.onPress?.()
      },
      ...hoverProps,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.sm,
        cursor: props.onPress ? 'pointer' : 'default',
        color: active ? p.accent.base : p.text.primary,
        background: hovered ? p.bg.overlay : 'transparent',
        transition: `background-color ${tokens.duration.fast}ms`,
      },
    },
    showArtwork
      ? h(Artwork, {
          artwork: props.track.artwork,
          seed: props.track.urn,
          size: tokens.size.artworkThumb,
        })
      : null,
    h(
      'div',
      { style: { flex: 1, minWidth: 0, overflow: 'hidden' } },
      h(Text, { numberOfLines: 1, children: props.track.title }),
      artists ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: artists }) : null,
    ),
    showAlbum && props.track.albumTitle
      ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: props.track.albumTitle })
      : null,
    props.onToggleLoved
      ? h(
          'span',
          { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
          h(IconButton, {
            icon: props.track.loved ? '♥' : '♡',
            accessibilityLabel: props.track.loved ? 'Unlike' : 'Like',
            variant: props.track.loved ? 'primary' : 'ghost',
            onPress: props.onToggleLoved,
          }),
        )
      : null,
    props.onDownload && !props.track.urn.startsWith('BBeBee:local:')
      ? h(
          'span',
          { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
          h(IconButton, {
            icon: '⬇',
            accessibilityLabel: 'Download',
            onPress: props.onDownload,
          }),
        )
      : null,
    props.onMore
      ? h(
          'span',
          {
            onClick: (e: React.MouseEvent<HTMLElement>) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              props.onMore?.({ x: rect.left, y: rect.bottom + 4 })
            },
            style: {
              visibility: hovered ? 'visible' : 'hidden',
            },
          },
          h(IconButton, { icon: '⋯', accessibilityLabel: 'More', onPress: () => {} }),
        )
      : null,
  )
}
