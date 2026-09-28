import { createElement as h, useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareTrackData } from '@BBeBee/protocol'
import { encodeMetadata } from '@BBeBee/plugin-share/metadata'
import { Button, Sheet, tablerIcon, useImageColor } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import {
  type BackgroundMode,
  generateTrackCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'

export interface ShareTrackModalProps {
  ctx: Context
  track: ShareTrackData
  open: boolean
  onClose: () => void
}

export function ShareTrackModal({
  ctx,
  track,
  open,
  onClose,
}: ShareTrackModalProps): ReactElement | null {
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('cover')
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Extract cover theme color or default to vibrant brand accent
  const extractedColor = useImageColor(track.artwork)
  const themeColor = extractedColor ?? '#4D6BFE'

  const handleCopyBase64 = useCallback(async () => {
    try {
      const b64 = encodeMetadata('track', track)
      await navigator.clipboard.writeText(b64)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      ctx.logger?.error(`Failed to copy base64: ${String(err)}`)
    }
  }, [ctx, track])

  const handleDownload = useCallback(async () => {
    try {
      setDownloading(true)
      const canvas = await generateTrackCardCanvas({
        track,
        themeColor,
        backgroundMode,
      })
      const filename = `${track.artist} - ${track.title} (BBeBee Share).png`
      downloadCanvasAsPng(canvas, filename)
    } catch (err) {
      ctx.logger?.error(`Failed to download share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, track, themeColor, backgroundMode])

  if (!open) return null

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
          '分享歌曲',
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
        title: track.title,
        subtitle: track.artist,
        artwork: track.artwork,
        themeColor,
        backgroundMode,
      }),
      // Background Mode Selector
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            marginTop: 6,
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
              padding: 3,
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
          h(Button, {
            variant: 'secondary',
            onPress: handleCopyBase64,
            children: copied ? '已复制 Base64' : '复制 Base64',
          }),
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
