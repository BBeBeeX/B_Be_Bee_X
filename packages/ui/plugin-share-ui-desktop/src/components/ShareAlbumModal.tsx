import { createElement as h, useState, useCallback, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareAlbumData } from '@BBeBee/protocol'
import { encodeMetadata } from '@BBeBee/plugin-share/metadata'
import { Button, Sheet, tablerIcon, useImageColor } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '../utils/useResolvedArtwork.js'
import { tokens } from '@BBeBee/ui-tokens'
import {
  type BackgroundMode,
  generateAlbumCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'

export interface ShareAlbumModalProps {
  ctx: Context
  album: ShareAlbumData
  open: boolean
  onClose: () => void
}

export function ShareAlbumModal({
  ctx,
  album,
  open,
  onClose,
}: ShareAlbumModalProps): ReactElement | null {
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('cover')
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [disabledReason, setDisabledReason] = useState<string | null>(null)

  // Resolve artwork via cache if available
  const artworkRef = useMemo(() => {
    return album.artwork ? { id: album.urn || album.title, sourceUrl: album.artwork } : undefined
  }, [album.artwork, album.urn, album.title])
  const resolvedArtworkRef = useResolvedArtwork(ctx, artworkRef)
  const resolvedArtwork = resolvedArtworkRef?.sourceUrl ?? album.artwork

  const extractedColor = useImageColor(resolvedArtwork)
  const themeColor = extractedColor ?? '#FF6B6B'

  const canCopy = Boolean(album && album.title && album.title.trim().length > 0)

  const handleCopyBase64 = useCallback(async () => {
    if (!canCopy) {
      setDisabledReason('无法复制：专辑缺少有效标题等元数据')
      setTimeout(() => setDisabledReason(null), 3500)
      return
    }
    try {
      const b64 = encodeMetadata('album', album)
      await navigator.clipboard.writeText(b64)
      setCopied(true)
      setDisabledReason(null)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      ctx.logger?.error(`Failed to copy base64: ${String(err)}`)
      setDisabledReason('无法复制：剪贴板写入失败，请检查系统权限')
      setTimeout(() => setDisabledReason(null), 3500)
    }
  }, [ctx, album, canCopy])

  const handleDownload = useCallback(async () => {
    try {
      setDownloading(true)
      const canvas = await generateAlbumCardCanvas({
        album: {
          ...album,
          artwork: resolvedArtwork,
        },
        themeColor,
        backgroundMode,
      })
      const filename = `${album.artist || '未知艺人'} - ${album.title} (BBeBee Album Share).png`
      downloadCanvasAsPng(canvas, filename)
    } catch (err) {
      ctx.logger?.error(`Failed to download share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, album, resolvedArtwork, themeColor, backgroundMode])

  if (!open) return null

  const subtitleParts = ['专辑']
  if (album.artist) subtitleParts.push(album.artist)
  if (album.trackCount > 0) subtitleParts.push(`${album.trackCount} 首歌曲`)
  if (album.year) subtitleParts.push(String(album.year))
  const subtitle = subtitleParts.join(' • ')

  return h(
    Sheet,
    { open, onClose },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          width: 320,
          margin: '0 auto',
        },
      },
      // Header
      h(
        'div',
        {
          style: {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          },
        },
        h(
          'span',
          { style: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #FFFFFF)' } },
          '分享专辑',
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: onClose,
            'aria-label': 'Close',
            style: {
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #8B95B0)',
              cursor: 'pointer',
              display: 'flex',
              padding: 4,
            },
          },
          tablerIcon('x', { size: 18 }),
        ),
      ),
      // Visual Card Preview
      h(ShareCardPreview, {
        title: album.title,
        subtitle,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
      }),
      // Background Control
      h(
        'div',
        {
          style: {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 4px',
            boxSizing: 'border-box',
          },
        },
        h(
          'span',
          { style: { fontSize: 12, color: 'var(--text-muted, #8B95B0)' } },
          '背景调节',
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: tokens.radius.pill,
              padding: 2,
              gap: 4,
            },
          },
          (['cover', 'gradient', 'black'] as const).map((mode) => {
            const labels = {
              cover: '纯主题色',
              gradient: '渐变',
              black: '纯黑',
            }
            const isActive = backgroundMode === mode
            return h(
              'button',
              {
                key: mode,
                type: 'button',
                onClick: () => setBackgroundMode(mode),
                style: {
                  background: isActive ? 'var(--button-primary-bg, #4D8BFF)' : 'transparent',
                  color: isActive ? '#FFFFFF' : 'var(--text-secondary, #C5CAD8)',
                  border: 'none',
                  borderRadius: tokens.radius.pill,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                },
              },
              labels[mode],
            )
          }),
        ),
      ),
      // Disabled Reason Popup Toast
      disabledReason
        ? h(
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
            h('span', null, disabledReason),
          )
        : null,
      // Action Buttons
      h(
        'div',
        {
          style: {
            display: 'flex',
            gap: 10,
            width: '100%',
            marginTop: 8,
          },
        },
        h(
          'div',
          { style: { flex: 1, display: 'flex' } },
          canCopy
            ? h(Button, {
                variant: 'secondary',
                onPress: handleCopyBase64,
                children: copied ? '已复制 Base64' : '复制 Base64',
              })
            : h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'copy-base64-disabled-btn',
                  onClick: () => {
                    setDisabledReason('无法复制：专辑缺少有效标题等元数据')
                    setTimeout(() => setDisabledReason(null), 3500)
                  },
                  style: {
                    width: '100%',
                    height: 38,
                    borderRadius: tokens.radius.pill,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.35)',
                    cursor: 'not-allowed',
                    fontSize: 13,
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 16px',
                  },
                },
                '复制 Base64',
              ),
        ),
        h(
          'div',
          { style: { flex: 1, display: 'flex' } },
          h(Button, {
            variant: 'primary',
            onPress: handleDownload,
            disabled: downloading,
            children: downloading ? '生成中…' : '下载图片',
          }),
        ),
      ),
    ),
  )
}
