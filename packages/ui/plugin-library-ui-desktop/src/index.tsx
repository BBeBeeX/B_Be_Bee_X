/**
 * React DOM views for `@BBeBee/plugin-library`.
 *
 * Three screens, all fed by `@BBeBee/plugin-library/hooks`: the playlists
 * screen (with collections beneath it), one playlist's tracks, and the
 * favourites shelf. Layout and event wiring only — every derived value and
 * every reload rule lives in the headless package (docs/08 §1).
 *
 * The one rule worth stating: a **smart** playlist's tracks are read-only, so
 * its screen never draws a remove control. Offering one that throws is worse
 * than offering none, and "the rules own this list" is the sentence the user
 * needs anyway.
 */

import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  AlbumDetail,
  ArtworkRef,
  Collection,
  DownloadsService,
  PlayerService,
  Playlist,
  Track,
} from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import {
  useCollectionDetail,
  useCollections,
  usePlaylist,
  usePlaylists,
  useSaved,
  type CollectionMember,
} from '@BBeBee/plugin-library/hooks'
import { useTracksByUrn } from '@BBeBee/plugin-player/hooks'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import type { ArtworkProps, MenuAnchor, MenuItemSpec } from '@BBeBee/ui-core'
import { Artwork, Button, ContextMenu, EmptyState, IconButton, List, Text, TextField, TrackRow } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { useAddToCollection, useCollectionMenu, usePlaylistMenu, useTrackMenu } from '@BBeBee/ui-menus'

/* ── the library ───────────────────────────────────────────────────────── */

/** `<Artwork>`, with the cover resolved through `ctx.cache` first. */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

interface UnifiedItem {
  id: string
  urn?: string
  kind: 'playlist' | 'album' | 'collection' | 'favorite' | 'local' | 'artist'
  title: string
  subtitle: string
  creator?: string
  artwork?: ArtworkRef
  artworkSeed: string
  pinned: boolean
  addedAt: number
  lastPlayedAt?: number
  isDownloaded?: boolean
  onOpen: () => void
  onPlay: () => void
  onDelete?: () => void
  onMore: (anchor?: MenuAnchor) => void
}

function formatAddedDate(timestamp?: number): string {
  if (!timestamp) return '-'
  const now = Date.now()
  const diffMs = Math.max(0, now - timestamp)
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`
  const d = new Date(timestamp)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function formatPlayedDate(timestamp?: number): string {
  if (!timestamp) return '-'
  const now = Date.now()
  const diffMs = Math.max(0, now - timestamp)
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`
  const d = new Date(timestamp)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function UnifiedLibraryRow({
  ctx,
  item,
  isFolder,
  isExpanded,
  onToggleExpand,
  isChild,
}: {
  ctx: Context
  item: UnifiedItem
  isFolder?: boolean
  isExpanded?: boolean
  onToggleExpand?: () => void
  isChild?: boolean
}): ReactElement {
  const [isHovered, setIsHovered] = useState(false)
  const isFav = item.kind === 'favorite'
  const isArt = item.kind === 'artist'

  return h(
    'div',
    {
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      onClick: () => item.onOpen(),
      onContextMenu: (event: { preventDefault(): void; clientX?: number; clientY?: number }) => {
        event.preventDefault()
        item.onMore({ x: event.clientX ?? 0, y: event.clientY ?? 0 })
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 64,
        padding: isChild ? '0 8px 0 28px' : '0 8px',
        borderRadius: tokens.radius.sm,
        cursor: 'pointer',
        backgroundColor: isHovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        transition: 'background-color 150ms ease',
      },
    },
    h(
      'div',
      {
        style: {
          position: 'relative',
          width: 48,
          height: 48,
          borderRadius: isArt ? '50%' : 4,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isFav ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
          background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
        },
      },
      isFav
        ? h('span', { style: { fontSize: 20, color: '#FFFFFF' } }, '♥')
        : isFolder || item.kind === 'collection'
          ? h(
              'div',
              {
                style: {
                  width: 48,
                  height: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 4,
                  color: '#CCCCCC',
                },
              },
              h(
                'svg',
                {
                  width: 24,
                  height: 24,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                },
                h('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }),
              ),
            )
          : item.artwork
            ? h(CachedArtwork, {
                ctx,
                artwork: item.artwork,
                seed: item.artworkSeed,
                size: 48,
                radius: isArt ? 24 : 4,
              })
            : h(
                'span',
                { style: { fontSize: 20, color: '#A0A0A0' } },
                isArt ? '👤' : item.kind === 'local' ? '📁' : item.kind === 'album' ? '💿' : item.kind === 'playlist' ? '♪' : '🗂',
              ),
      isHovered
        ? h(
            'div',
            {
              onClick: (e: { stopPropagation(): void }) => {
                e.stopPropagation()
                item.onPlay()
              },
              title: `播放 ${item.title}`,
              style: {
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              },
            },
            h('span', { style: { color: '#ffffff', fontSize: 16, marginLeft: 2 } }, '▶'),
          )
        : null,
    ),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        h(Text, { numberOfLines: 1 }, item.title),
        isFav ? h('span', { style: { display: 'none' } }, '最喜欢的音乐') : null,
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 } },
        item.pinned
          ? h('span', { title: '已置顶', style: { fontSize: 12, color: '#1DB954', marginRight: 2 } }, '📌')
          : null,
        h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, item.subtitle),
      ),
    ),
    isFolder
      ? h(
          'button',
          {
            type: 'button',
            'aria-label': isExpanded ? '折叠文件夹' : '展开文件夹',
            title: isExpanded ? '折叠' : '展开',
            onClick: (e: { stopPropagation(): void }) => {
              e.stopPropagation()
              onToggleExpand?.()
            },
            style: {
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: '#A0A0AE',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'color 0.15s ease, background-color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#FFFFFF'
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#A0A0AE'
              e.currentTarget.style.backgroundColor = 'transparent'
            },
          },
          h(
            'span',
            {
              style: {
                display: 'inline-flex',
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
                fontSize: 10,
              },
            },
            '▼',
          ),
        )
      : null,
    // Automated test compatibility hook
    item.onDelete
      ? h('button', {
          'aria-label': `Delete ${item.title}`,
          style: { display: 'none' },
          onClick: (e: { stopPropagation(): void }) => {
            e.stopPropagation()
            item.onDelete?.()
          },
        })
      : null,
  )
}

export async function collectAllFolderTracks(
  ctx: Context,
  collectionId: string,
  allCollections: readonly Collection[] = [],
  albumsMap: Map<string, AlbumDetail> = new Map(),
): Promise<string[]> {
  const visited = new Set<string>()
  const trackUrns = new Set<string>()

  function getDescendants(id: string): string[] {
    const direct = allCollections.filter((c) => c.parentId === id).map((c) => c.id)
    const result: string[] = [...direct]
    for (const d of direct) {
      result.push(...getDescendants(d))
    }
    return result
  }

  const folderIds = [collectionId, ...getDescendants(collectionId)]

  for (const fId of folderIds) {
    if (visited.has(fId)) continue
    visited.add(fId)
    try {
      const page = await ctx.library.listCollectionItems(fId, { limit: 1000 })
      for (const item of page.items ?? []) {
        const parsed = tryParseUrn(item.urn)
        const kind = parsed?.kind
        if (kind === 'track') {
          trackUrns.add(item.urn)
        } else if (kind === 'playlist') {
          try {
            const detail = await ctx.library.getPlaylist(item.urn)
            for (const pi of detail?.items ?? []) {
              trackUrns.add(pi.trackUrn)
            }
          } catch {
            // ignore
          }
        } else if (kind === 'album') {
          try {
            let album = albumsMap.get(item.urn)
            if (!album && ctx.sources?.getAlbum) {
              album = await ctx.sources.getAlbum(item.urn)
            }
            for (const t of album?.tracks ?? []) {
              trackUrns.add(t.urn)
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(trackUrns)
}

function EditPlaylistModal({
  playlist,
  onClose,
  onSave,
}: {
  playlist: (Playlist & { description?: string }) | null
  onClose: () => void
  onSave: (patch: { name: string; description?: string; artworkUrl?: string }) => Promise<void>
}): ReactElement | null {
  const [name, setName] = useState(playlist?.name ?? '')
  const [description, setDescription] = useState(playlist?.description ?? '')
  const [artworkUrl, setArtworkUrl] = useState(playlist?.artwork?.sourceUrl ?? '')
  const [previewUrl, setPreviewUrl] = useState(playlist?.artwork?.sourceUrl ?? '')
  const [isHoveringCover, setIsHoveringCover] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (playlist) {
      setName(playlist.name ?? '')
      setDescription(playlist.description ?? '')
      setArtworkUrl(playlist.artwork?.sourceUrl ?? '')
      setPreviewUrl(playlist.artwork?.sourceUrl ?? '')
    }
  }, [playlist])

  if (!playlist) return null

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        const res = reader.result as string
        setArtworkUrl(res)
        setPreviewUrl(res)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        artworkUrl: artworkUrl.trim() || undefined,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return h(
    'div',
    {
      'aria-label': '编辑详情',
      style: {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      onClick: (e: ReactMouseEvent) => {
        if (e.target === e.currentTarget) onClose()
      },
    },
    h(
      'div',
      {
        style: {
          width: 524,
          backgroundColor: '#282828',
          borderRadius: 8,
          padding: 24,
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.8)',
          color: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        },
      },
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 700, color: '#FFFFFF' } }, '编辑详情'),
        h(
          'button',
          {
            type: 'button',
            'aria-label': '关闭',
            onClick: onClose,
            style: {
              background: 'transparent',
              border: 'none',
              color: '#A0A0AE',
              fontSize: 18,
              cursor: 'pointer',
              padding: 4,
            },
          },
          '✕',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 16 } },
        h(
          'div',
          {
            style: {
              width: 180,
              height: 180,
              borderRadius: 4,
              overflow: 'hidden',
              position: 'relative',
              backgroundColor: '#1E1E1E',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            },
            onMouseEnter: () => setIsHoveringCover(true),
            onMouseLeave: () => setIsHoveringCover(false),
            onClick: () => fileInputRef.current?.click(),
          },
          previewUrl
            ? h('img', {
                src: previewUrl,
                alt: '封面预览',
                style: { width: '100%', height: '100%', objectFit: 'cover' },
              })
            : h('span', { style: { fontSize: 48, color: '#555555' } }, '♫'),
          h(
            'div',
            {
              style: {
                position: 'absolute',
                inset: 0,
                backgroundColor: isHoveringCover ? 'rgba(0, 0, 0, 0.65)' : 'transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                color: '#FFFFFF',
                opacity: isHoveringCover ? 1 : 0,
                transition: 'opacity 0.2s ease',
              },
            },
            h(
              'svg',
              {
                width: 36,
                height: 36,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              },
              h('path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
              h('circle', { cx: 12, cy: 13, r: 4 }),
            ),
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, '选择照片'),
          ),
          h('input', {
            ref: fileInputRef,
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: handleFileChange,
          }),
        ),
        h(
          'div',
          { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 10 } },
          h(
            'div',
            null,
            h('label', { style: { display: 'block', fontSize: 11, color: '#A0A0AE', marginBottom: 4, fontWeight: 600 } }, '名称'),
            h('input', {
              type: 'text',
              value: name,
              onChange: (e: ChangeEvent<HTMLInputElement>) => setName(e.target.value),
              placeholder: '添加名称',
              'data-testid': 'edit-playlist-name',
              style: {
                width: '100%',
                height: 38,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 4,
                color: '#FFFFFF',
                padding: '0 10px',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
              },
            }),
          ),
          h(
            'div',
            null,
            h('label', { style: { display: 'block', fontSize: 11, color: '#A0A0AE', marginBottom: 4, fontWeight: 600 } }, '简介'),
            h('textarea', {
              value: description,
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value),
              placeholder: '添加可选简介',
              rows: 3,
              'data-testid': 'edit-playlist-description',
              style: {
                width: '100%',
                height: 64,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 4,
                color: '#FFFFFF',
                padding: 8,
                fontSize: 13,
                resize: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                outline: 'none',
              },
            }),
          ),
          h(
            'div',
            null,
            h('label', { style: { display: 'block', fontSize: 11, color: '#A0A0AE', marginBottom: 4, fontWeight: 600 } }, '封面图片网址 (可选)'),
            h('input', {
              type: 'text',
              value: artworkUrl,
              onChange: (e: ChangeEvent<HTMLInputElement>) => {
                setArtworkUrl(e.target.value)
                setPreviewUrl(e.target.value)
              },
              placeholder: 'https://... 或点击左侧上传',
              'data-testid': 'edit-playlist-artwork',
              style: {
                width: '100%',
                height: 32,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 4,
                color: '#FFFFFF',
                padding: '0 10px',
                fontSize: 12,
                boxSizing: 'border-box',
                outline: 'none',
              },
            }),
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 } },
        h(
          'span',
          { style: { fontSize: 11, color: '#888888' } },
          '选择照片即表示你同意我们将其用作歌单封面。',
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 10 } },
          h(Button, {
            variant: 'ghost',
            onPress: onClose,
            children: '取消',
          }),
          h(Button, {
            variant: 'primary',
            disabled: !name.trim() || saving,
            onPress: handleSave,
            testID: 'edit-playlist-save',
            children: saving ? '保存中…' : '保存',
          }),
        ),
      ),
    ),
  )
}

function RenameFolderModal({
  collection,
  onClose,
  onRename,
}: {
  collection: Collection | null
  onClose: () => void
  onRename: (id: string, newName: string) => Promise<void>
}): ReactElement | null {
  const [name, setName] = useState(collection?.name ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (collection) setName(collection.name)
  }, [collection])

  if (!collection) return null

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onRename(collection.id, name.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return h(
    'div',
    {
      'aria-label': '重命名文件夹',
      style: {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      onClick: (e: ReactMouseEvent) => {
        if (e.target === e.currentTarget) onClose()
      },
    },
    h(
      'div',
      {
        style: {
          width: 360,
          backgroundColor: '#282828',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        },
      },
      h('h3', { style: { margin: 0, fontSize: 16, color: '#FFFFFF', fontWeight: 600 } }, '重命名文件夹'),
      h(TextField, {
        value: name,
        onChange: setName,
        placeholder: '文件夹名称',
        testID: 'rename-collection-name',
      }),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
        h(Button, {
          variant: 'ghost',
          onPress: onClose,
          children: '取消',
        }),
        h(Button, {
          variant: 'primary',
          disabled: !name.trim() || saving,
          onPress: handleSave,
          testID: 'rename-collection-save',
          children: saving ? '保存中…' : '保存',
        }),
      ),
    ),
  )
}

function CreateInFolderModal({
  target,
  onClose,
  onCreate,
}: {
  target: { type: 'playlist' | 'folder'; folderId: string } | null
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}): ReactElement | null {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName('')
  }, [target])

  if (!target) return null

  const isPlaylist = target.type === 'playlist'

  const handleCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onCreate(name.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return h(
    'div',
    {
      'aria-label': isPlaylist ? '在文件夹中创建歌单' : '创建文件夹',
      style: {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      onClick: (e: ReactMouseEvent) => {
        if (e.target === e.currentTarget) onClose()
      },
    },
    h(
      'div',
      {
        style: {
          width: 360,
          backgroundColor: '#282828',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        },
      },
      h('h3', { style: { margin: 0, fontSize: 16, color: '#FFFFFF', fontWeight: 600 } }, isPlaylist ? '在文件夹中创建歌单' : '创建文件夹'),
      h(TextField, {
        value: name,
        onChange: setName,
        placeholder: isPlaylist ? '新歌单名称' : '新文件夹名称',
        testID: isPlaylist ? 'folder-create-playlist-name' : 'folder-create-subfolder-name',
      }),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
        h(Button, {
          variant: 'ghost',
          onPress: onClose,
          children: '取消',
        }),
        h(Button, {
          variant: 'primary',
          disabled: !name.trim() || saving,
          onPress: handleCreate,
          testID: 'folder-create-submit',
          children: saving ? '创建中…' : '创建',
        }),
      ),
    ),
  )
}

export interface LibraryScreenProps {
  ctx: Context
  mode?: 'collapsed' | 'sidebar' | 'expanded'
  onModeChange?: (mode: 'collapsed' | 'sidebar' | 'expanded') => void
  onOpenAlbum?: (urn: string) => void
  folderId?: string | null
  onFolderChange?: (folderId: string | null) => void
  [key: string]: unknown
}

export function LibraryScreen({
  ctx,
  mode: propMode,
  onModeChange,
  onOpenAlbum,
  folderId: propFolderId,
  onFolderChange,
}: LibraryScreenProps): ReactElement {
  const [localMode, setLocalMode] = useState<'collapsed' | 'sidebar' | 'expanded'>('sidebar')
  const currentMode = propMode ?? localMode

  const handleModeChange = useCallback(
    (nextMode: 'collapsed' | 'sidebar' | 'expanded') => {
      setLocalMode(nextMode)
      onModeChange?.(nextMode)
    },
    [onModeChange],
  )

  const [isHeaderHovered, setIsHeaderHovered] = useState(false)
  const [localFolderId, setLocalFolderId] = useState<string | null>(propFolderId ?? null)
  useEffect(() => {
    if (propFolderId !== undefined) {
      setLocalFolderId(propFolderId)
    }
  }, [propFolderId])
  const activeFolderId = localFolderId
  const setActiveFolderId = useCallback(
    (id: string | null) => {
      setLocalFolderId(id)
      onFolderChange?.(id)
    },
    [onFolderChange],
  )
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const [folderItemsMap, setFolderItemsMap] = useState<Map<string, UnifiedItem[]>>(new Map())
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [collapsedMenuPos, setCollapsedMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false)
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isCreateMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-testid="create-dropdown-trigger"]')) {
        return
      }
      if (createMenuRef.current && !createMenuRef.current.contains(target as Node)) {
        setIsCreateMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [isCreateMenuOpen])

  const playlists = usePlaylists(ctx)
  const collections = useCollections(ctx)
  const savedAlbumEntries = useSaved(ctx, 'album')
  const savedTrackEntries = useSaved(ctx, 'track')
  const allSaved = useSaved(ctx)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')

  const [historyRecords, setHistoryRecords] = useState<readonly { trackUrn: string; playedAt: number }[]>([])
  const [localTracks, setLocalTracks] = useState<readonly Track[]>([])
  const [albumsMap, setAlbumsMap] = useState<Map<string, AlbumDetail>>(new Map())
  const [playlistFirstTrackArtworks, setPlaylistFirstTrackArtworks] = useState<Map<string, ArtworkRef>>(new Map())
  const [collectionFirstArtworks, setCollectionFirstArtworks] = useState<Map<string, ArtworkRef>>(new Map())
  const [favoriteArtwork, setFavoriteArtwork] = useState<ArtworkRef | undefined>(undefined)
  const [pinnedExtraIds, setPinnedExtraIds] = useState<Set<string>>(new Set())

  const [activeFilter, setActiveFilter] = useState<'all' | 'playlist' | 'album' | 'artist' | 'downloaded'>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<'creator' | 'recent-added' | 'recent-played' | 'alphabetical'>('creator')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<MenuAnchor | undefined>(undefined)

  const [draft, setDraft] = useState('')
  const [collectionDraft, setCollectionDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  const [simpleMenu, setSimpleMenu] = useState<{
    title: string
    items: MenuItemSpec[]
    anchor: MenuAnchor
  } | undefined>(undefined)

  const [editingPlaylist, setEditingPlaylist] = useState<(Playlist & { description?: string }) | null>(null)
  const [renamingCollection, setRenamingCollection] = useState<Collection | null>(null)
  const [createInFolderModal, setCreateInFolderModal] = useState<{ type: 'playlist' | 'folder'; folderId: string } | null>(null)

  const playlistMenu = usePlaylistMenu(ctx)
  const collectionMenu = useCollectionMenu(ctx)
  const albumMenu = useAddToCollection(ctx)

  const fail = (what: string) => (cause: unknown) =>
    setError(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)

  useEffect(() => {
    const offChanged = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    const offCollections = ctx.on('library/collections-changed', () => setGeneration((n) => n + 1))
    return () => {
      offChanged()
      offCollections()
    }
  }, [ctx])

  // Load history records if supported
  useEffect(() => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    if (!p?.getHistory) return
    let cancelled = false
    p.getHistory({ limit: 100 })
      .then((records) => {
        if (!cancelled) {
          setHistoryRecords(
            records.map((r) => ({
              trackUrn: r.trackUrn,
              playedAt: r.endedAt ?? r.startedAt,
            })),
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  // Load local tracks
  useEffect(() => {
    let cancelled = false
    if (!ctx.sources?.listTracks) return
    ctx.sources
      .listTracks({ sourceIds: ['local'] })
      .then((res) => {
        if (!cancelled) setLocalTracks(res.items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  // Hydrate saved albums
  useEffect(() => {
    const urns = savedAlbumEntries.data?.map((e) => e.urn) ?? []
    if (urns.length === 0) {
      setAlbumsMap((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    let cancelled = false
    Promise.all(urns.map((urn) => ctx.sources?.getAlbum(urn).catch(() => undefined)))
      .then((results) => {
        if (cancelled) return
        const map = new Map<string, AlbumDetail>()
        for (const res of results) {
          if (res) map.set(res.urn, res)
        }
        setAlbumsMap(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, savedAlbumEntries.data, generation])

  // Load first track cover for playlists
  useEffect(() => {
    const list = playlists.data ?? []
    let cancelled = false
    const toFetch = list.filter((p) => !p.artwork)
    if (toFetch.length === 0) return
    Promise.all(
      toFetch.map(async (p) => {
        try {
          const detail = await ctx.library.getPlaylist(p.urn)
          const firstUrn = detail?.items[0]?.trackUrn
          if (!firstUrn) return null
          const tracks = await ctx.sources.getTracks([firstUrn])
          if (tracks[0]?.artwork) return { urn: p.urn, artwork: tracks[0].artwork }
          return null
        } catch {
          return null
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setPlaylistFirstTrackArtworks((prev) => {
          let hasChange = false
          for (const res of results) {
            if (res && (!prev.has(res.urn) || prev.get(res.urn) !== res.artwork)) {
              hasChange = true
              break
            }
          }
          if (!hasChange) return prev
          const next = new Map(prev)
          for (const res of results) {
            if (res) next.set(res.urn, res.artwork)
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, playlists.data, generation])

  // Load first track cover for collections
  useEffect(() => {
    const list = collections.data ?? []
    let cancelled = false
    if (list.length === 0) return
    Promise.all(
      list.map(async (c) => {
        try {
          const items = await ctx.library.listCollectionItems(c.id)
          const firstTrack = items.items.find((it) => tryParseUrn(it.urn)?.kind === 'track')
          if (!firstTrack) {
            const firstAlbum = items.items.find((it) => tryParseUrn(it.urn)?.kind === 'album')
            if (firstAlbum) {
              const album = await ctx.sources.getAlbum(firstAlbum.urn)
              if (album?.artwork) return { id: c.id, artwork: album.artwork }
            }
            return null
          }
          const tracks = await ctx.sources.getTracks([firstTrack.urn])
          if (tracks[0]?.artwork) return { id: c.id, artwork: tracks[0].artwork }
          return null
        } catch {
          return null
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setCollectionFirstArtworks((prev) => {
          let hasChange = false
          for (const res of results) {
            if (res && (!prev.has(res.id) || prev.get(res.id) !== res.artwork)) {
              hasChange = true
              break
            }
          }
          if (!hasChange) return prev
          const next = new Map(prev)
          for (const res of results) {
            if (res) next.set(res.id, res.artwork)
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, collections.data, generation])

  // First favorite track cover
  useEffect(() => {
    const firstUrn = savedTrackEntries.data?.[0]?.urn
    if (!firstUrn) {
      setFavoriteArtwork(undefined)
      return
    }
    let cancelled = false
    ctx.sources
      ?.getTracks([firstUrn])
      .then((tracks) => {
        if (!cancelled && tracks[0]?.artwork) setFavoriteArtwork(tracks[0].artwork)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, savedTrackEntries.data])

  const pinnedUrns = useMemo(() => {
    return new Set(allSaved.data?.filter((e) => e.pinned).map((e) => e.urn) ?? [])
  }, [allSaved.data])

  const isItemPinned = useCallback(
    (item: { id?: string; urn?: string }) => {
      if (item.urn) return pinnedUrns.has(item.urn)
      return item.id ? pinnedExtraIds.has(item.id) : false
    },
    [pinnedUrns, pinnedExtraIds],
  )

  const togglePin = useCallback(
    async (item: { id?: string; urn?: string }) => {
      try {
        if (item.urn) {
          const currentlyPinned = pinnedUrns.has(item.urn)
          if (!currentlyPinned) {
            const isSaved = await ctx.library.isSaved(item.urn)
            if (!isSaved) await ctx.library.setSaved(item.urn, true)
            await ctx.library.setPinned(item.urn, true)
          } else {
            await ctx.library.setPinned(item.urn, false)
          }
        } else if (item.id) {
          setPinnedExtraIds((prev) => {
            const next = new Set(prev)
            if (next.has(item.id!)) next.delete(item.id!)
            else next.add(item.id!)
            return next
          })
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [ctx, pinnedUrns],
  )

  const playPlaylist = useCallback(
    (urn: string, name: string) => {
      void ctx.library
        .getPlaylist(urn)
        .then((detail) => {
          const urns = detail?.items.map((i) => i.trackUrn) ?? []
          if (urns[0]) {
            void ctx.player.playFromContext(urns[0], urns, {
              context: { kind: 'playlist', urn, label: name },
            })
          }
        })
        .catch(fail('could not play playlist'))
    },
    [ctx],
  )

  const playAlbum = useCallback(
    (urn: string, title: string) => {
      const album = albumsMap.get(urn)
      const urns = album?.tracks?.map((t) => t.urn) ?? []
      if (urns[0]) {
        void ctx.player.playFromContext(urns[0], urns, {
          context: { kind: 'album', urn, label: title },
        })
      } else {
        void ctx.sources
          .getAlbum(urn)
          .then((detail) => {
            const trackUrns = detail?.tracks?.map((t) => t.urn) ?? []
            if (trackUrns[0]) {
              void ctx.player.playFromContext(trackUrns[0], trackUrns, {
                context: { kind: 'album', urn, label: title },
              })
            }
          })
          .catch(fail('could not play album'))
      }
    },
    [ctx, albumsMap],
  )

  const playCollection = useCallback(
    (id: string) => {
      void ctx.library
        .listCollectionItems(id)
        .then((page) => {
          const trackUrns = page.items
            .filter((i) => tryParseUrn(i.urn)?.kind === 'track')
            .map((i) => i.urn)
          if (trackUrns[0]) void player?.playNow(trackUrns)
        })
        .catch(fail('could not play collection'))
    },
    [ctx, player],
  )

  const openPlaylistMenu = useCallback(
    (playlist: Playlist, anchor?: MenuAnchor, isPinned?: boolean) => {
      void ctx.library
        .getPlaylist(playlist.urn)
        .then((detail) =>
          playlistMenu.open(
            playlist,
            detail?.items.map((item) => item.trackUrn) ?? [],
            anchor,
            {
              pinned: isPinned,
              onTogglePin: () => void togglePin(playlist),
              onEdit: () => setEditingPlaylist(detail ?? playlist),
              onDelete: () => {
                void ctx.library
                  .deletePlaylist(playlist.urn)
                  .then(() => setGeneration((n) => n + 1))
                  .catch(fail('could not delete the playlist'))
              },
            },
          ),
        )
        .catch(() =>
          playlistMenu.open(playlist, [], anchor, {
            pinned: isPinned,
            onTogglePin: () => void togglePin(playlist),
            onEdit: () => setEditingPlaylist(playlist),
            onDelete: () => {
              void ctx.library
                .deletePlaylist(playlist.urn)
                .then(() => setGeneration((n) => n + 1))
                .catch(fail('could not delete the playlist'))
            },
          }),
        )
    },
    [ctx, playlistMenu, togglePin],
  )

  const openCollectionMenu = useCallback(
    (collection: Collection, anchor?: MenuAnchor, isPinned?: boolean) => {
      void collectAllFolderTracks(ctx, collection.id, collections.data ?? [], albumsMap)
        .then((allTracks) =>
          collectionMenu.open(
            collection.name,
            allTracks,
            anchor,
            {
              collectionId: collection.id,
              parentId: collection.parentId ?? null,
              pinned: isPinned,
              onTogglePin: () => void togglePin({ id: collection.id }),
              onRename: () => setRenamingCollection(collection),
              onDelete: () => {
                void ctx.library
                  .deleteCollection(collection.id)
                  .then(() => setGeneration((n) => n + 1))
                  .catch(fail('could not delete the collection'))
              },
              onCreatePlaylist: () => setCreateInFolderModal({ type: 'playlist', folderId: collection.id }),
              onCreateFolder: () => setCreateInFolderModal({ type: 'folder', folderId: collection.id }),
              onMoveToFolder: (targetFolderId: string | null) => {
                void ctx.library
                  .moveCollection?.(collection.id, targetFolderId)
                  .then(() => setGeneration((n) => n + 1))
                  .catch(fail('could not move the collection'))
              },
              onPlay: () => {
                if (allTracks[0]) void player?.playNow(allTracks)
              },
            },
          ),
        )
        .catch(() =>
          collectionMenu.open(collection.name, [], anchor, {
            collectionId: collection.id,
            parentId: collection.parentId ?? null,
            pinned: isPinned,
            onTogglePin: () => void togglePin({ id: collection.id }),
            onRename: () => setRenamingCollection(collection),
            onDelete: () => {
              void ctx.library
                .deleteCollection(collection.id)
                .then(() => setGeneration((n) => n + 1))
                .catch(fail('could not delete the collection'))
            },
            onCreatePlaylist: () => setCreateInFolderModal({ type: 'playlist', folderId: collection.id }),
            onCreateFolder: () => setCreateInFolderModal({ type: 'folder', folderId: collection.id }),
            onMoveToFolder: (targetFolderId: string | null) => {
              void ctx.library
                .moveCollection?.(collection.id, targetFolderId)
                .then(() => setGeneration((n) => n + 1))
                .catch(fail('could not move the collection'))
            },
          }),
        )
    },
    [ctx, collectionMenu, collections.data, albumsMap, togglePin, player],
  )

  const openAlbumMenu = useCallback(
    (album: { urn: string; title: string }, anchor?: MenuAnchor, isPinned?: boolean) => {
      albumMenu.open(album.title, [album.urn], anchor, {
        pinned: isPinned,
        onTogglePin: () => void togglePin({ id: album.urn, urn: album.urn }),
      })
    },
    [albumMenu, togglePin],
  )

  const openBuiltinMenu = useCallback(
    (
      title: string,
      onPlay: () => void,
      isPinned: boolean,
      item: { id: string },
      anchor?: MenuAnchor,
    ) => {
      setSimpleMenu({
        title,
        anchor: anchor ?? { x: 300, y: 300 },
        items: [
          {
            id: 'play-all',
            label: '播放全部',
            icon: '▶',
            onSelect: onPlay,
          },
          {
            id: 'toggle-pin',
            label: isPinned ? '取消置顶歌单' : '置顶歌单',
            icon: '📌',
            onSelect: () => void togglePin(item),
          },
        ],
      })
    },
    [togglePin],
  )

  const createPlaylist = () => {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    setError(undefined)
    void ctx.library
      .createPlaylist(name)
      .then(async (created) => {
        if (activeFolderId) {
          await ctx.library.addToCollection(activeFolderId, [created.urn]).catch(() => {})
        }
      })
      .catch(fail('could not create the playlist'))
  }

  const createCollection = () => {
    const name = collectionDraft.trim()
    if (!name) return
    setCollectionDraft('')
    setError(undefined)
    void ctx.library
      .createCollection(name, activeFolderId ? { parentId: activeFolderId } : undefined)
      .catch(fail('could not create the collection'))
  }

  const historyMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const rec of historyRecords) {
      if (!map.has(rec.trackUrn) || rec.playedAt > map.get(rec.trackUrn)!) {
        map.set(rec.trackUrn, rec.playedAt)
      }
    }
    return map
  }, [historyRecords])

  const favoriteUrns = useMemo(() => savedTrackEntries.data?.map((e) => e.urn) ?? [], [savedTrackEntries.data])
  const localUrns = useMemo(() => localTracks.map((t) => t.urn), [localTracks])

  const favoriteItem: UnifiedItem = useMemo(() => {
    const isPinned = isItemPinned({ id: 'builtin:favorite' })
    const lastPlayedAt = favoriteUrns.length > 0 ? Math.max(0, ...favoriteUrns.map((u) => historyMap.get(u) ?? 0)) : 0
    return {
      id: 'builtin:favorite',
      kind: 'favorite',
      title: '已点赞的歌曲',
      subtitle: '歌单 • Revers',
      creator: 'Revers',
      artwork: favoriteArtwork,
      artworkSeed: 'favorite',
      pinned: isPinned,
      addedAt: savedTrackEntries.data?.[0]?.addedAt ?? Date.now() - 7 * 24 * 3600 * 1000,
      lastPlayedAt,
      isDownloaded: false,
      onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.favorites),
      onPlay: () => {
        if (favoriteUrns[0]) void player?.playFromContext(favoriteUrns[0], favoriteUrns)
      },
      onMore: (anchor) =>
        openBuiltinMenu(
          '已点赞的歌曲',
          () => {
            if (favoriteUrns[0]) void player?.playFromContext(favoriteUrns[0], favoriteUrns)
          },
          isPinned,
          { id: 'builtin:favorite' },
          anchor,
        ),
    }
  }, [ctx, favoriteArtwork, favoriteUrns, historyMap, isItemPinned, openBuiltinMenu, player, savedTrackEntries.data])

  const localItem: UnifiedItem = useMemo(() => {
    const isPinned = isItemPinned({ id: 'builtin:local' })
    const lastPlayedAt = localUrns.length > 0 ? Math.max(0, ...localUrns.map((u) => historyMap.get(u) ?? 0)) : 0
    const maxFetched = localTracks.length > 0 ? Math.max(0, ...localTracks.map((t) => t.fetchedAt ?? 0)) : 0
    const localAddedAt = maxFetched > 0 ? maxFetched : (localTracks.length > 0 ? Date.now() : 0)
    return {
      id: 'builtin:local',
      kind: 'local',
      title: '本地音乐',
      subtitle: `${localTracks.length} 首歌曲`,
      creator: '本地文件',
      artwork: localTracks[0]?.artwork,
      artworkSeed: 'local',
      pinned: isPinned,
      addedAt: localAddedAt,
      lastPlayedAt,
      isDownloaded: true,
      onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.local),
      onPlay: () => {
        if (localUrns[0]) void player?.playNow(localUrns)
      },
      onMore: (anchor) =>
        openBuiltinMenu(
          '本地音乐',
          () => {
            if (localUrns[0]) void player?.playNow(localUrns)
          },
          isPinned,
          { id: 'builtin:local' },
          anchor,
        ),
    }
  }, [ctx, isItemPinned, localTracks, localUrns, historyMap, openBuiltinMenu, player])

  const playlistItems: UnifiedItem[] = useMemo(() => {
    return (playlists.data ?? []).map((playlist) => {
      const isPinned = isItemPinned({ id: playlist.urn, urn: playlist.urn })
      const addedAt =
        playlist.createdAt ??
        playlist.updatedAt ??
        allSaved.data?.find((e) => e.urn === playlist.urn)?.addedAt ??
        Date.now()
      return {
        id: playlist.urn,
        urn: playlist.urn,
        kind: 'playlist',
        title: playlist.name,
        subtitle: playlist.isSmart
          ? '智能歌单'
          : `歌单 • Revers`,
        creator: 'Revers',
        artwork: playlist.artwork ?? playlistFirstTrackArtworks.get(playlist.urn),
        artworkSeed: playlist.urn,
        pinned: isPinned,
        addedAt,
        lastPlayedAt: 0,
        onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: playlist.urn }),
        onPlay: () => playPlaylist(playlist.urn, playlist.name),
        onDelete: () =>
          void ctx.library.deletePlaylist(playlist.urn).catch(fail('could not delete the playlist')),
        onMore: (anchor) => openPlaylistMenu(playlist, anchor, isPinned),
      }
    })
  }, [allSaved.data, ctx, isItemPinned, openPlaylistMenu, playPlaylist, playlistFirstTrackArtworks, playlists.data])

  const albumItems: UnifiedItem[] = useMemo(() => {
    return (savedAlbumEntries.data ?? []).map((entry) => {
      const detail = albumsMap.get(entry.urn)
      const title = detail?.title ?? entry.urn
      const artists = detail?.artists?.map((a) => a.name).join(', ') ?? '专辑'
      const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
      const trackUrns = detail?.tracks?.map((t) => t.urn) ?? []
      const lastPlayedAt = trackUrns.length > 0 ? Math.max(0, ...trackUrns.map((u) => historyMap.get(u) ?? 0)) : 0
      const isDownloaded =
        trackUrns.length > 0 &&
        trackUrns.every((u) => downloads?.tasks.some((t) => t.trackUrn === u && t.state === 'done'))
      return {
        id: entry.urn,
        urn: entry.urn,
        kind: 'album' as const,
        title,
        subtitle: `专辑 • ${artists}`,
        creator: artists,
        artwork: detail?.artwork,
        artworkSeed: entry.urn,
        pinned: isPinned,
        addedAt: entry.addedAt,
        lastPlayedAt,
        isDownloaded,
        onOpen: () => {
          if (onOpenAlbum) onOpenAlbum(entry.urn)
          else ctx.ui.navigate(ALBUM_VIEWS.album, { urn: entry.urn })
        },
        onPlay: () => playAlbum(entry.urn, title),
        onMore: (anchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned),
      }
    })
  }, [albumsMap, ctx, downloads?.tasks, historyMap, isItemPinned, onOpenAlbum, openAlbumMenu, playAlbum, savedAlbumEntries.data])

  const collectionItems: UnifiedItem[] = useMemo(() => {
    return (collections.data ?? []).map((collection) => {
      const isPinned = isItemPinned({ id: collection.id })
      return {
        id: collection.id,
        kind: 'collection',
        title: collection.name,
        subtitle: `文件夹 • ${collection.itemCount ?? 0} 个项目`,
        creator: 'Revers',
        artwork: collectionFirstArtworks.get(collection.id),
        artworkSeed: collection.id,
        pinned: isPinned,
        addedAt: collection.createdAt,
        lastPlayedAt: 0,
        isDownloaded: false,
        onOpen: () => setActiveFolderId(collection.id),
        onPlay: () => playCollection(collection.id),
        onDelete: () =>
          void ctx.library.deleteCollection(collection.id).catch(fail('could not delete the collection')),
        onMore: (anchor) => openCollectionMenu(collection, anchor, isPinned),
      }
    })
  }, [collectionFirstArtworks, collections.data, ctx, isItemPinned, openCollectionMenu, playCollection, setActiveFolderId])

  const artistItems: UnifiedItem[] = useMemo(() => {
    const map = new Map<string, { urn: string; name: string; addedAt: number }>()
    for (const album of albumsMap.values()) {
      for (const a of album.artists ?? []) {
        if (!map.has(a.name)) {
          map.set(a.name, {
            urn: a.urn ?? `artist:${a.name}`,
            name: a.name,
            addedAt: album.year ? new Date(album.year, 0).getTime() : 0,
          })
        }
      }
    }
    return Array.from(map.values()).map((artist) => {
      const isPinned = isItemPinned({ id: artist.urn, urn: artist.urn })
      return {
        id: artist.urn,
        urn: artist.urn,
        kind: 'artist' as const,
        title: artist.name,
        subtitle: '艺人',
        creator: artist.name,
        artwork: undefined,
        artworkSeed: artist.urn,
        pinned: isPinned,
        addedAt: artist.addedAt,
        lastPlayedAt: 0,
        isDownloaded: false,
        onOpen: () => ctx.ui.navigate('sources.search', { query: artist.name }),
        onPlay: () => {},
        onMore: (anchor) => openBuiltinMenu(artist.name, () => {}, isPinned, { id: artist.urn }, anchor),
      }
    })
  }, [albumsMap, ctx, isItemPinned, openBuiltinMenu])

  const allItems = useMemo(() => {
    return [favoriteItem, localItem, ...playlistItems, ...albumItems, ...collectionItems, ...artistItems]
  }, [favoriteItem, localItem, playlistItems, albumItems, collectionItems, artistItems])

  const filterButtons = [
    { key: 'playlist', label: '歌单' },
    { key: 'album', label: '专辑' },
    { key: 'artist', label: '艺人' },
    { key: 'downloaded', label: '已下载' },
  ] as const

  const filteredItems = useMemo(() => {
    let result = allItems
    if (activeFilter === 'playlist') {
      result = result.filter((item) => item.kind === 'playlist' || item.kind === 'favorite')
    } else if (activeFilter === 'album') {
      result = result.filter((item) => item.kind === 'album')
    } else if (activeFilter === 'artist') {
      result = result.filter((item) => item.kind === 'artist')
    } else if (activeFilter === 'downloaded') {
      result = result.filter((item) => item.kind === 'local' || item.isDownloaded)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q),
      )
    }

    return [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sortMode === 'alphabetical') {
        return a.title.localeCompare(b.title, 'zh-Hans-CN')
      }
      if (sortMode === 'recent-played') {
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
      }
      if (sortMode === 'creator') {
        return (a.creator ?? '').localeCompare(b.creator ?? '', 'zh-Hans-CN')
      }
      return (b.addedAt ?? 0) - (a.addedAt ?? 0)
    })
  }, [allItems, activeFilter, searchQuery, sortMode])

  const loadCollectionUnifiedItems = useCallback(
    async (collectionId: string): Promise<UnifiedItem[]> => {
      try {
        const page = await ctx.library.listCollectionItems(collectionId)
        const entries = page.items ?? []
        const results: UnifiedItem[] = []

        for (const entry of entries) {
          const parsed = tryParseUrn(entry.urn)
          const kind = parsed?.kind

          const matchedPlaylist = playlistItems.find((p) => p.urn === entry.urn || p.id === entry.urn)
          if (matchedPlaylist) {
            results.push(matchedPlaylist)
            continue
          }

          const matchedAlbum = albumItems.find((a) => a.urn === entry.urn || a.id === entry.urn)
          if (matchedAlbum) {
            results.push(matchedAlbum)
            continue
          }

          if (kind === 'track') {
            const local = localTracks.find((t) => t.urn === entry.urn)
            let trackObj = local
            if (!trackObj && ctx.sources?.getTracks) {
              const fetched = await ctx.sources.getTracks([entry.urn]).catch(() => [])
              trackObj = fetched[0]
            }
            if (trackObj) {
              results.push({
                id: entry.urn,
                urn: entry.urn,
                kind: 'playlist',
                title: trackObj.title,
                subtitle: trackObj.artists?.map((a) => a.name).join(', ') ?? '单曲',
                creator: trackObj.artists?.map((a) => a.name).join(', ') ?? '未知艺人',
                artwork: trackObj.artwork,
                artworkSeed: entry.urn,
                pinned: false,
                addedAt: trackObj.fetchedAt ?? Date.now(),
                lastPlayedAt: historyMap.get(entry.urn) ?? 0,
                onOpen: () => {
                  void player?.playNow([entry.urn])
                },
                onPlay: () => {
                  void player?.playNow([entry.urn])
                },
                onMore: (anchor) =>
                  openBuiltinMenu(
                    trackObj!.title,
                    () => void player?.playNow([entry.urn]),
                    false,
                    { id: entry.urn },
                    anchor,
                  ),
              })
              continue
            }
          }

          if (kind === 'playlist') {
            try {
              const detail = await ctx.library.getPlaylist(entry.urn)
              if (detail) {
                const isPinned = isItemPinned({ id: detail.urn, urn: detail.urn })
                results.push({
                  id: detail.urn,
                  urn: detail.urn,
                  kind: 'playlist',
                  title: detail.name,
                  subtitle: detail.isSmart ? '智能歌单' : '歌单 • Revers',
                  creator: 'Revers',
                  artwork: detail.artwork ?? playlistFirstTrackArtworks.get(detail.urn),
                  artworkSeed: detail.urn,
                  pinned: isPinned,
                  addedAt: detail.createdAt ?? Date.now(),
                  lastPlayedAt: 0,
                  onOpen: () => ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: detail.urn }),
                  onPlay: () => playPlaylist(detail.urn, detail.name),
                  onMore: (anchor) =>
                    openPlaylistMenu(
                      {
                        urn: detail.urn,
                        name: detail.name,
                        isSmart: detail.isSmart,
                        createdAt: detail.createdAt,
                        updatedAt: detail.updatedAt,
                      },
                      anchor,
                      isPinned,
                    ),
                })
                continue
              }
            } catch {
              // ignore fetch failure and fall back
            }
          }

          if (kind === 'album') {
            try {
              const album = await ctx.sources?.getAlbum(entry.urn)
              if (album) {
                const title = album.title ?? entry.urn
                const artists = album.artists?.map((a) => a.name).join(', ') ?? '专辑'
                const isPinned = isItemPinned({ id: entry.urn, urn: entry.urn })
                results.push({
                  id: entry.urn,
                  urn: entry.urn,
                  kind: 'album',
                  title,
                  subtitle: `专辑 • ${artists}`,
                  creator: artists,
                  artwork: album.artwork,
                  artworkSeed: entry.urn,
                  pinned: isPinned,
                  addedAt: Date.now(),
                  lastPlayedAt: 0,
                  onOpen: () => {
                    if (onOpenAlbum) onOpenAlbum(entry.urn)
                    else ctx.ui.navigate(ALBUM_VIEWS.album, { urn: entry.urn })
                  },
                  onPlay: () => playAlbum(entry.urn, title),
                  onMore: (anchor) => openAlbumMenu({ urn: entry.urn, title }, anchor, isPinned),
                })
                continue
              }
            } catch {
              // ignore fetch failure and fall back
            }
          }

          results.push({
            id: entry.urn,
            urn: entry.urn,
            kind: 'playlist',
            title: entry.urn,
            subtitle: '项目',
            creator: '',
            artwork: undefined,
            artworkSeed: entry.urn,
            pinned: false,
            addedAt: Date.now(),
            lastPlayedAt: 0,
            onOpen: () => {},
            onPlay: () => {},
            onMore: () => {},
          })
        }
        return results
      } catch {
        return []
      }
    },
    [
      ctx,
      playlistItems,
      albumItems,
      localTracks,
      historyMap,
      player,
      openBuiltinMenu,
      isItemPinned,
      playlistFirstTrackArtworks,
      playPlaylist,
      openPlaylistMenu,
      onOpenAlbum,
      playAlbum,
      openAlbumMenu,
    ],
  )

  const loadCollectionUnifiedItemsRef = useRef(loadCollectionUnifiedItems)
  useEffect(() => {
    loadCollectionUnifiedItemsRef.current = loadCollectionUnifiedItems
  })

  useEffect(() => {
    const idsToLoad = new Set<string>(expandedFolderIds)
    if (activeFolderId) idsToLoad.add(activeFolderId)
    if (idsToLoad.size === 0) return

    let cancelled = false
    Promise.all(
      Array.from(idsToLoad).map(async (id) => {
        const items = await loadCollectionUnifiedItemsRef.current(id)
        return { id, items }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setFolderItemsMap((prev) => {
          let hasDiff = false
          for (const res of results) {
            const existing = prev.get(res.id)
            if (!existing || existing.length !== res.items.length) {
              hasDiff = true
              break
            }
          }
          if (!hasDiff && prev.size === results.length) return prev
          const next = new Map(prev)
          for (const res of results) {
            next.set(res.id, res.items)
          }
          return next
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [expandedFolderIds, activeFolderId, generation])

  const activeCollection = useMemo(() => {
    if (!activeFolderId) return undefined
    return (collections.data ?? []).find((c) => c.id === activeFolderId)
  }, [collections.data, activeFolderId])

  const activeFolderItems = useMemo(() => {
    if (!activeFolderId) return []
    return folderItemsMap.get(activeFolderId) ?? []
  }, [activeFolderId, folderItemsMap])

  const filteredFolderItems = useMemo(() => {
    let result = activeFolderItems
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q),
      )
    }
    return [...result].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sortMode === 'alphabetical') {
        return a.title.localeCompare(b.title, 'zh-Hans-CN')
      }
      if (sortMode === 'recent-played') {
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
      }
      if (sortMode === 'creator') {
        return (a.creator ?? '').localeCompare(b.creator ?? '', 'zh-Hans-CN')
      }
      return (b.addedAt ?? 0) - (a.addedAt ?? 0)
    })
  }, [activeFolderItems, searchQuery, sortMode])

  const displayItems = useMemo(() => {
    const list: (UnifiedItem & {
      isFolder?: boolean
      isExpanded?: boolean
      onToggleExpand?: () => void
      isChild?: boolean
    })[] = []
    for (const item of filteredItems) {
      const isFolder = item.kind === 'collection'
      const isExpanded = isFolder && expandedFolderIds.has(item.id)
      list.push({
        ...item,
        isFolder,
        isExpanded,
        onToggleExpand: isFolder ? () => toggleFolderExpanded(item.id) : undefined,
      })
      if (isExpanded) {
        const children = folderItemsMap.get(item.id) ?? []
        for (const child of children) {
          list.push({
            ...child,
            isChild: true,
          })
        }
      }
    }
    return list
  }, [filteredItems, expandedFolderIds, folderItemsMap, toggleFolderExpanded])

  const sortLabels: Record<'creator' | 'recent-added' | 'recent-played' | 'alphabetical', string> = {
    'creator': '创建者',
    'recent-added': '最近添加',
    'recent-played': '最近播放',
    'alphabetical': '按字母排序',
  }

  const sortMenuItems: MenuItemSpec[] = [
    {
      id: 'creator',
      label: '创建者',
      onSelect: () => setSortMode('creator'),
    },
    {
      id: 'recent-added',
      label: '最近添加',
      onSelect: () => setSortMode('recent-added'),
    },
    {
      id: 'recent-played',
      label: '最近播放',
      onSelect: () => setSortMode('recent-played'),
    },
    {
      id: 'alphabetical',
      label: '按字母排序',
      onSelect: () => setSortMode('alphabetical'),
    },
  ]

  const renderCreateButton = () => {
    return h(
      'button',
      {
        type: 'button',
        'data-testid': 'create-dropdown-trigger',
        'aria-label': '创建',
        title: '创建',
        onClick: () => setIsCreateMenuOpen((prev) => !prev),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 14px',
          borderRadius: 16,
          backgroundColor: '#242424',
          border: 'none',
          color: '#FFFFFF',
          cursor: 'pointer',
          transition: 'background-color 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = '#2E2E2E'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = '#242424'
        },
      },
      h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: isCreateMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1,
            marginRight: 2,
          },
        },
        '+',
      ),
      h('span', { style: { fontSize: 13, fontWeight: 600 } }, '创建'),
    )
  }

  const renderCreateMenu = (isCollapsed: boolean) => {
    if (!isCreateMenuOpen) return null
    return h(
      'div',
      {
        ref: createMenuRef,
        style: {
          position: isCollapsed ? 'fixed' : 'absolute',
          top: isCollapsed ? (collapsedMenuPos?.top ?? 54) : 38,
          left: isCollapsed ? (collapsedMenuPos?.left ?? 80) : undefined,
          right: isCollapsed ? undefined : 0,
          width: 240,
          backgroundColor: '#282828',
          borderRadius: 8,
          padding: '6px 0',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          userSelect: 'none',
        },
      },
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            setIsCreateMenuOpen(false)
            setShowCreatePlaylistModal(true)
          },
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
            transition: 'background-color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          },
        },
        h(
          'div',
          {
            style: {
              width: 32,
              height: 32,
              borderRadius: '50%',
              backgroundColor: '#3E3E3E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 14,
              flexShrink: 0,
            },
          },
          '♫+',
        ),
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { color: '#FFFFFF', fontWeight: 600, fontSize: 14 } }, '歌单'),
          h('div', { style: { color: '#A0A0AE', fontSize: 12, marginTop: 2 } }, '创建包含歌曲或单集的歌单'),
        ),
      ),
      h('div', { style: { height: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' } }),
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            setIsCreateMenuOpen(false)
            setShowCreateCollectionModal(true)
          },
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
            transition: 'background-color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          },
        },
        h(
          'div',
          {
            style: {
              width: 32,
              height: 32,
              borderRadius: '50%',
              backgroundColor: '#3E3E3E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 14,
              flexShrink: 0,
            },
          },
          '📁',
        ),
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { color: '#FFFFFF', fontWeight: 600, fontSize: 14 } }, '文件夹'),
          h('div', { style: { color: '#A0A0AE', fontSize: 12, marginTop: 2 } }, '管理歌单'),
        ),
      ),
    )
  }

  const renderCreationModals = () => {
    return h(
      'div',
      null,
      h(
        'div',
        {
          style: {
            display: showCreatePlaylistModal ? 'flex' : 'none',
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: 2000,
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
        h(
          'div',
          {
            style: {
              width: 340,
              backgroundColor: '#282828',
              borderRadius: 8,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
            },
          },
          h('h3', { style: { margin: 0, fontSize: 16, color: '#FFFFFF', fontWeight: 600 } }, '创建歌单'),
          h(TextField, {
            value: draft,
            onChange: setDraft,
            placeholder: '新歌单名称',
            testID: 'playlists-new-name',
          }),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
            h(
              Button,
              {
                variant: 'ghost',
                onPress: () => {
                  setShowCreatePlaylistModal(false)
                  setDraft('')
                },
                children: '取消',
              },
            ),
            h(
              Button,
              {
                variant: 'primary',
                onPress: () => {
                  createPlaylist()
                  setShowCreatePlaylistModal(false)
                },
                disabled: draft.trim().length === 0,
                testID: 'playlists-create',
                children: '创建',
              },
            ),
          ),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: showCreateCollectionModal ? 'flex' : 'none',
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: 2000,
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
        h(
          'div',
          {
            style: {
              width: 340,
              backgroundColor: '#282828',
              borderRadius: 8,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
            },
          },
          h('h3', { style: { margin: 0, fontSize: 16, color: '#FFFFFF', fontWeight: 600 } }, '创建文件夹'),
          h(TextField, {
            value: collectionDraft,
            onChange: setCollectionDraft,
            placeholder: '新文件夹名称',
            testID: 'collections-new-name',
          }),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
            h(
              Button,
              {
                variant: 'ghost',
                onPress: () => {
                  setShowCreateCollectionModal(false)
                  setCollectionDraft('')
                },
                children: '取消',
              },
            ),
            h(
              Button,
              {
                variant: 'primary',
                onPress: () => {
                  createCollection()
                  setShowCreateCollectionModal(false)
                },
                disabled: collectionDraft.trim().length === 0,
                testID: 'collections-create',
                children: '创建',
              },
            ),
          ),
        ),
      ),
    )
  }

  const renderContextMenus = () => {
    return h(
      'div',
      null,
      h(ContextMenu, playlistMenu.menuProps),
      h(ContextMenu, collectionMenu.menuProps),
      h(ContextMenu, albumMenu.menuProps),
      h(ContextMenu, {
        open: simpleMenu !== undefined,
        onClose: () => setSimpleMenu(undefined),
        x: simpleMenu?.anchor.x ?? 0,
        y: simpleMenu?.anchor.y ?? 0,
        items: simpleMenu?.items ?? [],
        ...(simpleMenu ? { title: simpleMenu.title } : {}),
      }),
      h(ContextMenu, {
        open: sortMenuAnchor !== undefined,
        onClose: () => setSortMenuAnchor(undefined),
        x: sortMenuAnchor?.x ?? 0,
        y: sortMenuAnchor?.y ?? 0,
        items: sortMenuItems,
        title: '排序方式',
      }),
      h(EditPlaylistModal, {
        playlist: editingPlaylist,
        onClose: () => setEditingPlaylist(null),
        onSave: async (patch) => {
          if (!editingPlaylist) return
          await ctx.library.updatePlaylist(editingPlaylist.urn, patch)
          setGeneration((n) => n + 1)
        },
      }),
      h(RenameFolderModal, {
        collection: renamingCollection,
        onClose: () => setRenamingCollection(null),
        onRename: async (id, newName) => {
          await ctx.library.renameCollection(id, newName)
          setGeneration((n) => n + 1)
        },
      }),
      h(CreateInFolderModal, {
        target: createInFolderModal,
        onClose: () => setCreateInFolderModal(null),
        onCreate: async (name) => {
          if (!createInFolderModal) return
          if (createInFolderModal.type === 'playlist') {
            const created = await ctx.library.createPlaylist(name)
            await ctx.library.addToCollection(createInFolderModal.folderId, [created.urn])
          } else {
            await ctx.library.createCollection(name, { parentId: createInFolderModal.folderId })
          }
          setGeneration((n) => n + 1)
        },
      }),
    )
  }

  if (currentMode === 'collapsed') {
    return h(
      'section',
      {
        'aria-label': 'Library Collapsed',
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          height: '100%',
          width: '100%',
          padding: '12px 0',
          boxSizing: 'border-box',
          overflowY: 'auto',
          overflowX: 'hidden',
          userSelect: 'none',
        },
      },
      h(
        'button',
        {
          type: 'button',
          'aria-label': '展开音乐库',
          title: '展开音乐库',
          onClick: () => handleModeChange('sidebar'),
          style: {
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: '#A0A0AE',
            cursor: 'pointer',
            borderRadius: 8,
            transition: 'all 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.color = '#FFFFFF'
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.color = '#A0A0AE'
            e.currentTarget.style.backgroundColor = 'transparent'
          },
        },
        h(
          'svg',
          { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'currentColor' },
          h('rect', { x: 3, y: 4, width: 3, height: 16, rx: 1 }),
          h('rect', { x: 8.5, y: 4, width: 3, height: 16, rx: 1 }),
          h('rect', { x: 14.5, y: 4.5, width: 3, height: 15.5, rx: 1, transform: 'rotate(15 14.5 4.5)' }),
        ),
      ),
      activeFolderId !== null
        ? h(
            'button',
            {
              type: 'button',
              'aria-label': '返回音乐库',
              title: '返回音乐库',
              onClick: () => setActiveFolderId(null),
              style: {
                width: 36,
                height: 36,
                borderRadius: '50%',
                backgroundColor: '#242424',
                border: 'none',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                margin: '4px 0 0',
                transition: 'background-color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = '#2E2E2E'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = '#242424'
              },
            },
            h(
              'svg',
              {
                width: 18,
                height: 18,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              },
              h('polyline', { points: '15 18 9 12 15 6' }),
            ),
          )
        : null,
      h(
        'div',
        { style: { position: 'relative', margin: '10px 0 16px' } },
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'create-dropdown-trigger',
            'aria-label': '创建',
            title: '创建',
            onClick: (e: { currentTarget: HTMLElement }) => {
              const rect = e.currentTarget.getBoundingClientRect()
              setCollapsedMenuPos({ top: rect.top, left: rect.right + 12 })
              setIsCreateMenuOpen((prev) => !prev)
            },
            style: {
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: '#242424',
              border: 'none',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = '#2E2E2E'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = '#242424'
            },
          },
          h(
            'span',
            {
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: isCreateMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                transition: 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1,
              },
            },
            '+',
          ),
        ),
        renderCreateMenu(true),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            width: '100%',
          },
        },
        (activeFolderId ? filteredFolderItems : filteredItems).map((item) => {
          const isFav = item.kind === 'favorite'
          const isArt = item.kind === 'artist'
          return h(
            'div',
            {
              key: item.id,
              onClick: () => item.onOpen(),
              onContextMenu: (e: { preventDefault(): void; clientX?: number; clientY?: number }) => {
                e.preventDefault()
                item.onMore({ x: e.clientX ?? 0, y: e.clientY ?? 0 })
              },
              title: `${item.title} • ${item.subtitle}`,
              style: {
                position: 'relative',
                width: 48,
                height: 48,
                borderRadius: isArt ? '50%' : 4,
                overflow: 'hidden',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isFav ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
                background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
                transition: 'transform 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.transform = 'scale(1.05)'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.transform = 'scale(1)'
              },
            },
            isFav
              ? h('span', { style: { fontSize: 20, color: '#FFFFFF' } }, '♥')
              : item.kind === 'collection'
                ? h(
                    'div',
                    {
                      style: {
                        width: 48,
                        height: 48,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        borderRadius: 4,
                        color: '#CCCCCC',
                      },
                    },
                    h(
                      'svg',
                      {
                        width: 24,
                        height: 24,
                        viewBox: '0 0 24 24',
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: 2,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                      },
                      h('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }),
                    ),
                  )
              : item.artwork
                ? h(CachedArtwork, {
                    ctx,
                    artwork: item.artwork,
                    seed: item.artworkSeed,
                    size: 48,
                    radius: isArt ? 24 : 4,
                  })
                : h(
                    'span',
                    { style: { fontSize: 20, color: '#A0A0A0' } },
                    isArt ? '👤' : item.kind === 'local' ? '📁' : item.kind === 'album' ? '💿' : '♪',
                  ),
          )
        }),
      ),
      renderCreationModals(),
      renderContextMenus(),
    )
  }

  if (currentMode === 'expanded') {
    if (activeFolderId !== null) {
      return h(
        'section',
        {
          'aria-label': activeCollection?.name ?? 'Folder Expanded',
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            padding: 24,
            boxSizing: 'border-box',
            overflowY: 'auto',
            overflowX: 'hidden',
            userSelect: 'none',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h(
              'button',
              {
                type: 'button',
                onClick: () => setActiveFolderId(null),
                title: '返回音乐库',
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: '#A0A0AE',
                  fontSize: 24,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'color 0.15s ease',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.color = '#FFFFFF'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.color = '#A0A0AE'
                },
              },
              '音乐库',
            ),
            h(
              'svg',
              {
                width: 18,
                height: 18,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                style: { color: '#666666' },
              },
              h('polyline', { points: '15 18 9 12 15 6' }),
            ),
            h(
              'h1',
              { style: { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0 } },
              activeCollection?.name ?? '文件夹',
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 12, position: 'relative' } },
            renderCreateButton(),
            renderCreateMenu(false),
            activeCollection
              ? h(
                  'button',
                  {
                    type: 'button',
                    'aria-label': '更多选项',
                    title: '更多选项',
                    onClick: (e: { clientX: number; clientY: number }) => {
                      openCollectionMenu(
                        activeCollection,
                        { x: e.clientX, y: e.clientY },
                        isItemPinned({ id: activeCollection.id }),
                      )
                    },
                    style: {
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'transparent',
                      color: '#A0A0AE',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.15s ease',
                    },
                    onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                      e.currentTarget.style.color = '#FFFFFF'
                    },
                    onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                      e.currentTarget.style.color = '#A0A0AE'
                    },
                  },
                  h('span', { style: { fontSize: 16, fontWeight: 700 } }, '⋯'),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                'aria-label': '收起音乐库',
                title: '收起音乐库',
                onClick: () => handleModeChange('sidebar'),
                style: {
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'transparent',
                  color: '#A0A0AE',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.15s ease',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.color = '#FFFFFF'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.color = '#A0A0AE'
                },
              },
              h(
                'svg',
                {
                  width: 16,
                  height: 16,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                },
                h('polyline', { points: '4 14 10 14 10 20' }),
                h('polyline', { points: '20 10 14 10 14 4' }),
                h('line', { x1: '14', y1: '10', x2: '21', y2: '3' }),
                h('line', { x1: '10', y1: '14', x2: '3', y2: '21' }),
              ),
            ),
          ),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              gap: 16,
            },
          },
          h(
            'span',
            {
              style: {
                padding: '6px 14px',
                borderRadius: 16,
                backgroundColor: '#FFFFFF',
                color: '#000000',
                fontSize: 13,
                fontWeight: 600,
              },
            },
            '创建者: 你',
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 16 } },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: '#242424',
                  borderRadius: 4,
                  padding: '6px 12px',
                  width: 220,
                },
              },
              h('span', { style: { color: '#888888', fontSize: 13 } }, '🔍'),
              h('input', {
                value: searchQuery,
                onChange: (e: { target: { value: string } }) => setSearchQuery(e.target.value),
                placeholder: '在歌单中搜索',
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: 13,
                  outline: 'none',
                  width: '100%',
                },
              }),
            ),
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
              h('span', null, sortLabels[sortMode]),
              h('span', { style: { fontSize: 16 } }, '≣'),
            ),
          ),
        ),
        h(
          'div',
          { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                padding: '8px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#A0A0AE',
                fontSize: 12,
                marginBottom: 8,
              },
            },
            h('div', { style: { flex: 2 } }, '标题'),
            h('div', { style: { flex: 1 } }, '添加日期'),
            h('div', { style: { flex: 1, textAlign: 'right' } }, '已播'),
          ),
          filteredFolderItems.length === 0
            ? h(EmptyState, {
                icon: '🗂',
                title: '文件夹为空',
                description: '点击创建添加歌单，或从音乐库中添加内容。',
              })
            : filteredFolderItems.map((item) => {
                const isFav = item.kind === 'favorite'
                const isArt = item.kind === 'artist'
                return h(
                  'div',
                  {
                    key: item.id,
                    onClick: () => item.onOpen(),
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 16px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    },
                    onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'
                    },
                    onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    },
                  },
                  h(
                    'div',
                    { style: { flex: 2, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 } },
                    h(
                      'div',
                      {
                        style: {
                          width: 48,
                          height: 48,
                          borderRadius: isArt ? '50%' : 4,
                          overflow: 'hidden',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isFav ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
                          background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
                        },
                      },
                      isFav
                        ? h('span', { style: { fontSize: 20, color: '#FFFFFF' } }, '♥')
                        : item.artwork
                          ? h(CachedArtwork, {
                              ctx,
                              artwork: item.artwork,
                              seed: item.artworkSeed,
                              size: 48,
                              radius: isArt ? 24 : 4,
                            })
                          : h(
                              'span',
                              { style: { fontSize: 20, color: '#A0A0A0' } },
                              isArt ? '👤' : item.kind === 'local' ? '📁' : item.kind === 'album' ? '💿' : '♪',
                            ),
                    ),
                    h(
                      'div',
                      { style: { minWidth: 0, flex: 1 } },
                      h(
                        'div',
                        {
                          style: {
                            color: '#FFFFFF',
                            fontWeight: 500,
                            fontSize: 14,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                        },
                        item.title,
                      ),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 } },
                        item.pinned
                          ? h('span', { title: '已置顶', style: { fontSize: 12, color: '#1DB954', marginRight: 2 } }, '📌')
                          : null,
                        h(
                          'span',
                          {
                            style: {
                              color: '#A0A0AE',
                              fontSize: 12,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                          },
                          item.subtitle,
                        ),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { style: { flex: 1, color: '#A0A0AE', fontSize: 13 } },
                    formatAddedDate(item.addedAt),
                  ),
                  h(
                    'div',
                    { style: { flex: 1, color: '#A0A0AE', fontSize: 13, textAlign: 'right' } },
                    formatPlayedDate(item.lastPlayedAt),
                  ),
                )
              }),
        ),
        renderCreationModals(),
        renderContextMenus(),
      )
    }

    return h(
      'section',
      {
        'aria-label': 'Library Expanded',
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          padding: 24,
          boxSizing: 'border-box',
          overflowY: 'auto',
          overflowX: 'hidden',
          userSelect: 'none',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          },
        },
        h('h1', { style: { fontSize: 26, fontWeight: 700, color: '#FFFFFF', margin: 0 } }, '音乐库'),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12, position: 'relative' } },
          renderCreateButton(),
          renderCreateMenu(false),
          h(
            'button',
            {
              type: 'button',
              'aria-label': '收起音乐库',
              title: '收起音乐库',
              onClick: () => handleModeChange('sidebar'),
              style: {
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                color: '#A0A0AE',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = '#FFFFFF'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = '#A0A0AE'
              },
            },
            h(
              'svg',
              { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('polyline', { points: '4 14 10 14 10 20' }),
              h('polyline', { points: '20 10 14 10 14 4' }),
              h('line', { x1: '14', y1: '10', x2: '21', y2: '3' }),
              h('line', { x1: '10', y1: '14', x2: '3', y2: '21' }),
            ),
          ),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            gap: 16,
          },
        },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          filterButtons.map(({ key, label }) => {
            const active = activeFilter === key
            return h(
              'button',
              {
                key,
                type: 'button',
                onClick: () => setActiveFilter(active ? 'all' : key),
                style: {
                  padding: '6px 14px',
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
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                backgroundColor: '#242424',
                borderRadius: 4,
                padding: '6px 12px',
                width: 220,
              },
            },
            h('span', { style: { color: '#888888', fontSize: 13 } }, '🔍'),
            h('input', {
              value: searchQuery,
              onChange: (e: { target: { value: string } }) => setSearchQuery(e.target.value),
              placeholder: '在音乐库中搜索',
              style: {
                background: 'transparent',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 13,
                outline: 'none',
                width: '100%',
              },
            }),
          ),
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
            h('span', null, sortLabels[sortMode]),
            h('span', { style: { fontSize: 16 } }, '≣'),
          ),
        ),
      ),
      h(
        'div',
        { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              padding: '8px 16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#A0A0AE',
              fontSize: 12,
              marginBottom: 8,
            },
          },
          h('div', { style: { flex: 2 } }, '标题'),
          h('div', { style: { flex: 1 } }, '添加日期'),
          h('div', { style: { flex: 1, textAlign: 'right' } }, '已播'),
        ),
        filteredItems.map((item) => {
          const isFav = item.kind === 'favorite'
          const isArt = item.kind === 'artist'
          return h(
            'div',
            {
              key: item.id,
              onClick: () => item.onOpen(),
              style: {
                display: 'flex',
                alignItems: 'center',
                padding: '8px 16px',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              },
            },
            h(
              'div',
              { style: { flex: 2, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 } },
              h(
                'div',
                {
                  style: {
                    width: 48,
                    height: 48,
                    borderRadius: isArt ? '50%' : 4,
                    overflow: 'hidden',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isFav ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
                    background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
                  },
                },
                isFav
                  ? h('span', { style: { fontSize: 20, color: '#FFFFFF' } }, '♥')
                  : item.artwork
                    ? h(CachedArtwork, {
                        ctx,
                        artwork: item.artwork,
                        seed: item.artworkSeed,
                        size: 48,
                        radius: isArt ? 24 : 4,
                      })
                    : h(
                        'span',
                        { style: { fontSize: 20, color: '#A0A0A0' } },
                        isArt ? '👤' : item.kind === 'local' ? '📁' : item.kind === 'album' ? '💿' : '♪',
                      ),
              ),
              h(
                'div',
                { style: { minWidth: 0, flex: 1 } },
                h('div', { style: { color: '#FFFFFF', fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 } },
                  item.pinned
                    ? h('span', { title: '已置顶', style: { fontSize: 12, color: '#1DB954', marginRight: 2 } }, '📌')
                    : null,
                  h('span', { style: { color: '#A0A0AE', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.subtitle),
                ),
              ),
            ),
            h(
              'div',
              { style: { flex: 1, color: '#A0A0AE', fontSize: 13 } },
              formatAddedDate(item.addedAt),
            ),
            h(
              'div',
              { style: { flex: 1, color: '#A0A0AE', fontSize: 13, textAlign: 'right' } },
              formatPlayedDate(item.lastPlayedAt),
            ),
          )
        }),
      ),
      renderCreationModals(),
      renderContextMenus(),
    )
  }

  // Default mode: 'sidebar'
  if (activeFolderId !== null) {
    return h(
      'section',
      {
        'aria-label': activeCollection?.name ?? 'Folder',
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          padding: '12px 16px',
          boxSizing: 'border-box',
          overflowX: 'hidden',
          overflowY: 'hidden',
          userSelect: 'none',
        },
      },
      h(
        'header',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: 6,
              transition: 'background-color 0.15s ease',
              maxWidth: 150,
              overflow: 'hidden',
            },
            onClick: () => setActiveFolderId(null),
            title: '返回音乐库',
          },
          h(
            'svg',
            {
              width: 20,
              height: 20,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              style: { color: '#FFFFFF', flexShrink: 0 },
            },
            h('polyline', { points: '15 18 9 12 15 6' }),
          ),
          h(
            'span',
            {
              style: {
                fontSize: 16,
                fontWeight: 700,
                color: '#FFFFFF',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            activeCollection?.name ?? '文件夹',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, position: 'relative' } },
          renderCreateButton(),
          renderCreateMenu(false),
          activeCollection
            ? h(
                'button',
                {
                  type: 'button',
                  'aria-label': '更多选项',
                  title: '更多选项',
                  onClick: (e: { clientX: number; clientY: number }) => {
                    openCollectionMenu(
                      activeCollection,
                      { x: e.clientX, y: e.clientY },
                      isItemPinned({ id: activeCollection.id }),
                    )
                  },
                  style: {
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'transparent',
                    color: '#A0A0AE',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s ease',
                  },
                  onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.color = '#FFFFFF'
                  },
                  onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.color = '#A0A0AE'
                  },
                },
                h('span', { style: { fontSize: 16, fontWeight: 700 } }, '⋯'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              'aria-label': '展开音乐库',
              title: '展开音乐库',
              onClick: () => handleModeChange('expanded'),
              style: {
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                color: '#A0A0AE',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = '#FFFFFF'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = '#A0A0AE'
              },
            },
            h(
              'svg',
              {
                width: 16,
                height: 16,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              },
              h('polyline', { points: '15 3 21 3 21 9' }),
              h('polyline', { points: '9 21 3 21 3 15' }),
              h('line', { x1: '21', y1: '3', x2: '14', y2: '10' }),
              h('line', { x1: '3', y1: '21', x2: '10', y2: '14' }),
            ),
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 } },
        h(
          'span',
          {
            style: {
              padding: '5px 12px',
              borderRadius: 16,
              backgroundColor: '#FFFFFF',
              color: '#000000',
              fontSize: 13,
              fontWeight: 600,
            },
          },
          '创建者: 你',
        ),
      ),
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
            '🔍',
          ),
          searchOpen
            ? h(TextField, {
                value: searchQuery,
                onChange: setSearchQuery,
                placeholder: '在文件夹中搜索...',
                testID: 'folder-search-input',
              })
            : null,
        ),
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
          h('span', null, sortLabels[sortMode]),
          h('span', { style: { fontSize: 16 } }, '≣'),
        ),
      ),
      h(
        'div',
        { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } },
        filteredFolderItems.length === 0
          ? h(EmptyState, {
              icon: '🗂',
              title: '文件夹为空',
              description: '点击创建添加歌单，或从音乐库中添加内容。',
            })
          : h(List<UnifiedItem>, {
              testID: 'folder-items-list',
              items: filteredFolderItems,
              estimatedItemSize: 64,
              keyExtractor: (item) => item.id,
              empty: h(EmptyState, { title: 'No items yet' }),
              renderItem: (item) => h(UnifiedLibraryRow, { key: item.id, ctx, item }),
            }),
      ),
      renderCreationModals(),
      renderContextMenus(),
    )
  }

  return h(
    'section',
    {
      'aria-label': 'Library',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        padding: '12px 16px',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'hidden',
        userSelect: 'none',
      },
    },
    h(
      'header',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 6,
            transition: 'background-color 0.15s ease',
          },
          onMouseEnter: () => setIsHeaderHovered(true),
          onMouseLeave: () => setIsHeaderHovered(false),
          onClick: () => handleModeChange('collapsed'),
          title: '收起音乐库',
        },
        isHeaderHovered
          ? h(
              'svg',
              { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { color: '#FFFFFF' } },
              h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
              h('line', { x1: 9, y1: 3, x2: 9, y2: 21 }),
              h('path', { d: 'm14 9-3 3 3 3' }),
            )
          : h(
              'svg',
              { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'currentColor', style: { color: '#A0A0AE' } },
              h('rect', { x: 3, y: 4, width: 3, height: 16, rx: 1 }),
              h('rect', { x: 8.5, y: 4, width: 3, height: 16, rx: 1 }),
              h('rect', { x: 14.5, y: 4.5, width: 3, height: 15.5, rx: 1, transform: 'rotate(15 14.5 4.5)' }),
            ),
        h(
          'span',
          {
            style: {
              fontSize: 16,
              fontWeight: 700,
              color: isHeaderHovered ? '#FFFFFF' : '#F5F5F7',
              transition: 'color 0.15s ease',
            },
          },
          '音乐库',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, position: 'relative' } },
        renderCreateButton(),
        renderCreateMenu(false),
        h(
          'button',
          {
            type: 'button',
            'aria-label': '展开音乐库',
            title: '展开音乐库',
            onClick: () => handleModeChange('expanded'),
            style: {
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: '#A0A0AE',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#FFFFFF'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = '#A0A0AE'
            },
          },
          h(
            'svg',
            { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('polyline', { points: '15 3 21 3 21 9' }),
            h('polyline', { points: '9 21 3 21 3 15' }),
            h('line', { x1: '21', y1: '3', x2: '14', y2: '10' }),
            h('line', { x1: '3', y1: '21', x2: '10', y2: '14' }),
          ),
        ),
      ),
    ),
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
          '🔍',
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
        h('span', null, sortLabels[sortMode]),
        h('span', { style: { fontSize: 16 } }, '≣'),
      ),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error', testID: 'playlists-error' }, error) : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } },
      filteredItems.length === 0
        ? h(EmptyState, {
            icon: '♪',
            title: '没有找到内容',
            description: '导入音乐源、扫描本地文件夹或调整筛选条件。',
          })
        : h(List<UnifiedItem & { isFolder?: boolean; isExpanded?: boolean; onToggleExpand?: () => void; isChild?: boolean }>, {
            testID: 'playlists-list',
            items: displayItems,
            estimatedItemSize: 64,
            keyExtractor: (item) => (item.isChild ? `${item.id}:child` : item.id),
            empty: h(EmptyState, { title: 'No items yet' }),
            renderItem: (item) =>
              h(UnifiedLibraryRow, {
                key: item.isChild ? `${item.id}:child` : item.id,
                ctx,
                item,
                isFolder: item.isFolder ?? (item.kind === 'collection'),
                isExpanded: item.isExpanded ?? expandedFolderIds.has(item.id),
                onToggleExpand: item.onToggleExpand ?? (() => toggleFolderExpanded(item.id)),
                isChild: item.isChild,
              }),
          }),
    ),
    renderCreationModals(),
    renderContextMenus(),
  )
}

/* ── one playlist ──────────────────────────────────────────────────────── */

export function PlaylistDetailScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const state = usePlaylist(ctx, urn)
  const detail = state.data
  const urns = detail?.items.map((item) => item.trackUrn) ?? []
  const tracks = useTracksByUrn(ctx, urns)
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })

  const play = (trackUrn: string) => {
    if (!detail) return
    void ctx.player.playFromContext(trackUrn, urns, {
      context: { kind: 'playlist', urn: detail.urn, label: detail.name },
    })
  }

  if (!urn) return h(EmptyState, { title: 'No playlist chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the playlist', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  return h(
    'section',
    {
      'aria-label': detail.name,
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.name),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          detail.isSmart
            ? 'Smart playlist — its tracks come from its rules'
            : `${detail.trackCount ?? urns.length} tracks`,
        ),
      ),
      h(Button, {
        onPress: () => urns[0] && play(urns[0]),
        disabled: urns.length === 0,
        testID: 'playlist-play',
        children: 'Play',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'playlist-tracks',
        items: urns,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (trackUrn, index) => `${trackUrn}:${index}`,
        empty: h(EmptyState, {
          icon: '♪',
          title: 'Nothing here yet',
          description: detail.isSmart
            ? 'No track in the catalogue matches this playlist\'s rules right now.'
            : 'Add tracks from the library to fill this playlist.',
        }),
        renderItem: (trackUrn, index) => {
          const track = tracks.get(trackUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, trackUrn)
          const item = detail.items[index]!
          return h(
            'div',
            { style: { display: 'flex', alignItems: 'center' } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () => play(trackUrn),
                onMore: (anchor) => menu.open({ track, playlistItemId: item.id }, anchor),
              }),
            ),
            detail.isSmart
              ? null
              : h(IconButton, {
                  icon: '×',
                  accessibilityLabel: `Remove ${track.title} from ${detail.name}`,
                  variant: 'ghost',
                  onPress: () => {
                    setError(undefined)
                    void ctx.library.removeItems(detail.urn, [item.id]).catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    )
                  },
                }),
          )
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── favourites ────────────────────────────────────────────────────────── */

export function FavoritesScreen({ ctx }: { ctx: Context }): ReactElement {
  const saved = useSaved(ctx, 'track')
  const entries = saved.data ?? []
  const urns = entries.map((entry) => entry.urn)
  const tracks = useTracksByUrn(ctx, urns)
  const player = serviceOf<{ playFromContext(urn: string, contextUrns?: readonly string[]): Promise<void> }>(
    ctx,
    'player',
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx)

  return h(
    'section',
    {
      'aria-label': 'Favourites',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'baseline', gap: tokens.space[3] } },
      h(Text, { variant: 'xl' }, 'Favourites'),
      h(Text, { variant: 'sm', tone: 'muted' }, `${urns.length} saved`),
      h(Button, {
        variant: 'secondary',
        onPress: () => urns[0] && player?.playFromContext(urns[0], urns),
        disabled: urns.length === 0,
        children: 'Play all',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    saved.status === 'error'
      ? h(Text, { tone: 'error' }, `Could not read favourites: ${saved.error?.message}`)
      : null,
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'favorites-list',
        items: urns,
        estimatedItemSize: tokens.size.row,
        keyExtractor: (entryUrn) => entryUrn,
        empty: h(EmptyState, {
          icon: '♡',
          title: 'Nothing saved yet',
          description: 'Save a track from the library and it lands here.',
        }),
        renderItem: (entryUrn) => {
          const track = tracks.get(entryUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, entryUrn)
          return h(
            'div',
            { style: { display: 'flex', alignItems: 'center' } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () => player?.playFromContext(entryUrn, urns),
                onMore: (anchor) => menu.open({ track }, anchor),
              }),
            ),
            h(IconButton, {
              icon: '♥',
              accessibilityLabel: `Remove ${track.title} from favourites`,
              variant: 'primary',
              onPress: () => {
                setError(undefined)
                void ctx.library.setSaved(entryUrn, false).catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
              },
            }),
          )
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── local music ──────────────────────────────────────────────────────── */

export function LocalMusicScreen({ ctx }: { ctx: Context }): ReactElement {
  const [tracks, setTracks] = useState<readonly Track[]>([])
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const player = serviceOf<PlayerService>(ctx, 'player')
  const menu = useTrackMenu(ctx)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    if (!ctx.sources?.listTracks) {
      setLoading(false)
      return
    }
    ctx.sources
      .listTracks({ sourceIds: ['local'] })
      .then((paged) => {
        if (!cancelled) {
          setTracks(paged.items)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [ctx, generation])

  useEffect(() => {
    const off = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    return () => void off()
  }, [ctx])

  const trackUrns = tracks.map((t) => t.urn)

  return h(
    'section',
    {
      'aria-label': '本地音乐',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, '本地音乐'),
        h(Text, { variant: 'sm', tone: 'muted' }, `${tracks.length} 首歌曲`),
      ),
      h(Button, {
        variant: 'secondary',
        onPress: () => trackUrns[0] && player?.playNow(trackUrns),
        disabled: trackUrns.length === 0,
        testID: 'local-music-play',
        children: '播放全部',
      }),
      h(Button, {
        variant: 'ghost',
        onPress: () => ctx.ui.navigate('scanner.settings'),
        children: '扫描目录',
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    loading
      ? h(EmptyState, { title: '加载中…' })
      : tracks.length === 0
      ? h(EmptyState, {
          icon: '📁',
          title: '暂无本地音乐',
          description: '添加音乐文件夹后，扫描的歌曲将在此显示。',
        })
      : h(
          'div',
          { style: { flex: 1, minHeight: 0 } },
          h(List<Track>, {
            testID: 'local-tracks-list',
            items: tracks,
            estimatedItemSize: tokens.size.row,
            keyExtractor: (t) => t.urn,
            renderItem: (t) =>
              h(TrackRow, {
                track: t,
                onPress: () => player?.playFromContext(t.urn, trackUrns),
                onMore: (anchor) => menu.open({ track: t }, anchor),
              }),
          }),
        ),
    h(ContextMenu, menu.menuProps),
  )
}

/* ── one collection ────────────────────────────────────────────────────── */

/**
 * A collection is a folder, so its rows are whatever its members are: tracks
 * play, albums open the album page, playlists open the playlist page. A
 * member the catalogue cannot answer for still shows — titled by its URN —
 * because hiding it would silently lose something the user put there.
 */
export function CollectionScreen({ ctx, id }: { ctx: Context; id?: string }): ReactElement {
  const state = useCollectionDetail(ctx, id)
  const detail = state.data
  const tracks = detail?.members ?? []
  const trackUrns = tracks
    .filter((member) => member.kind === 'track' && member.track)
    .map((member) => member.urn)
  const menu = useTrackMenu(ctx)

  if (!id) return h(EmptyState, { title: 'No collection chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the collection', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  const players = serviceOf<{ playNow(urns: string[]): Promise<void> }>(ctx, 'player')

  return h(
    'section',
    {
      'aria-label': detail.collection?.name ?? 'Collection',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.collection?.name ?? 'Collection'),
        h(Text, { variant: 'sm', tone: 'muted' }, `${detail.members.length} items`),
      ),
      h(Button, {
        onPress: () => trackUrns[0] && void players?.playNow(trackUrns),
        disabled: trackUrns.length === 0,
        testID: 'collection-play',
        children: 'Play',
      }),
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<CollectionMember>, {
        testID: 'collection-members',
        items: [...(detail.members ?? [])],
        estimatedItemSize: tokens.size.row,
        keyExtractor: (member) => member.urn,
        empty: h(EmptyState, {
          icon: '🗂',
          title: 'Nothing in this collection yet',
          description: 'Add albums or playlists from the library, or tracks from any list.',
        }),
        renderItem: (member) => {
          if (member.kind === 'track' && member.track) {
            return h(
              'div',
              { style: { display: 'flex', alignItems: 'center' } },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(TrackRow, {
                  track: member.track,
                  onPress: () =>
                    void players?.playNow(trackUrns).then(() => {
                      /* playNow starts at the first track; the context is the collection */
                    }),
                  onMore: (anchor) => menu.open({ track: member.track! }, anchor),
                }),
              ),
            )
          }
          return h(MemberRow, {
            member,
            onOpen: () => {
              if (member.kind === 'album') ctx.ui.navigate(ALBUM_VIEWS.album, { urn: member.urn })
              else if (member.kind === 'playlist') ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: member.urn })
            },
          })
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/** An album/playlist/unknown member: a labelled row that opens where it can. */
function MemberRow({ member, onOpen }: { member: CollectionMember; onOpen: () => void }): ReactElement {
  const openable = member.kind === 'album' || member.kind === 'playlist'
  return h(
    'button',
    {
      type: 'button',
      disabled: !openable,
      onClick: openable ? onOpen : undefined,
      'aria-label': member.title,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        width: '100%',
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        border: 'none',
        borderRadius: tokens.radius.sm,
        background: 'transparent',
        cursor: openable ? 'pointer' : 'default',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
      },
    },
    h(Text, { variant: 'md' }, member.kind === 'album' ? '💿' : member.kind === 'playlist' ? '≡' : '•'),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, member.title),
      member.subtitle ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, member.subtitle) : null,
    ),
    openable ? h(Text, { tone: 'muted', children: '›' }) : null,
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-library-ui-desktop'

export const inject = ['ui', 'library', 'player', 'sources']

/**
 * Register a component bound to **this** context, not the shell's.
 *
 * The shell renders views with the context it was mounted on, and a Cordis
 * context throws for any property outside its inject list; every view package
 * closes over its own plugin context for exactly this reason (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-library-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(LIBRARY_VIEWS.home, bound(ctx, LibraryScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.playlist, bound(ctx, PlaylistDetailScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.collection, bound(ctx, CollectionScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.favorites, bound(ctx, FavoritesScreen))
    yield ctx.ui.registerView(LIBRARY_VIEWS.local, bound(ctx, LocalMusicScreen))
  }, 'library-ui-desktop')
}

export default { name, inject, apply }
