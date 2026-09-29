import { createElement as h, useState, useCallback, useMemo } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ShareLyricsData } from '@BBeBee/protocol'
import { Button, Sheet, tablerIcon, useImageColor } from '@BBeBee/ui-kit-desktop'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { tokens } from '@BBeBee/ui-tokens'
import {
  type BackgroundMode,
  generateLyricsCardCanvas,
  downloadCanvasAsPng,
} from '../utils/canvasRenderer.js'
import { ShareCardPreview } from './ShareCardPreview.js'

export interface ShareLyricsModalProps {
  ctx: Context
  lyrics: ShareLyricsData
  open: boolean
  onClose: () => void
}

export function ShareLyricsModal({
  ctx,
  lyrics,
  open,
  onClose,
}: ShareLyricsModalProps): ReactElement | null {
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('cover')
  const [selectedIndices, setSelectedIndices] = useState<number[]>(() => {
    // Default to first 4 lines or whatever was passed
    return lyrics.lines.slice(0, 4).map((_, i) => i)
  })
  const [copiedText, setCopiedText] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [disabledReason, setDisabledReason] = useState<string | null>(null)

  // Resolve artwork via cache if available
  const artworkRef = useMemo(() => {
    return lyrics.artwork ? { id: lyrics.trackUrn || lyrics.title, sourceUrl: lyrics.artwork } : undefined
  }, [lyrics.artwork, lyrics.trackUrn, lyrics.title])
  const resolvedArtworkRef = useResolvedArtwork(ctx, artworkRef)
  const resolvedArtwork = resolvedArtworkRef?.sourceUrl ?? lyrics.artwork

  const extractedColor = useImageColor(resolvedArtwork)
  const themeColor = extractedColor ?? '#79486D'

  const activeLines = useMemo(() => {
    return selectedIndices
      .sort((a, b) => a - b)
      .map((idx) => lyrics.lines[idx]!)
      .filter(Boolean)
  }, [lyrics.lines, selectedIndices])

  const toggleLine = (index: number) => {
    setSelectedIndices((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index)
      }
      if (prev.length >= 6) return prev // Limit to max 6 lines for visual balance
      return [...prev, index]
    })
  }

  const canCopy = activeLines.length > 0

  const handleCopyText = useCallback(async () => {
    if (!canCopy) {
      setDisabledReason('无法复制歌词：请至少勾选一行歌词')
      setTimeout(() => setDisabledReason(null), 3500)
      return
    }
    try {
      const textToCopy = `${activeLines.join('\n')}\n\n—— ${lyrics.artist}《${lyrics.title}》`
      await navigator.clipboard.writeText(textToCopy)
      setCopiedText(true)
      setDisabledReason(null)
      setTimeout(() => setCopiedText(false), 2000)
    } catch (err) {
      ctx.logger?.error(`Failed to copy lyrics: ${String(err)}`)
      setDisabledReason('无法复制：剪贴板写入失败，请检查系统权限')
      setTimeout(() => setDisabledReason(null), 3500)
    }
  }, [ctx, activeLines, lyrics.artist, lyrics.title, canCopy])

  const handleDownload = useCallback(async () => {
    try {
      setDownloading(true)
      const lyricsData: ShareLyricsData = {
        ...lyrics,
        artwork: resolvedArtwork,
        lines: activeLines,
      }
      const canvas = await generateLyricsCardCanvas({
        lyrics: lyricsData,
        themeColor,
        backgroundMode,
      })
      const filename = `${lyrics.artist} - ${lyrics.title} (歌词分享).png`
      downloadCanvasAsPng(canvas, filename)
    } catch (err) {
      ctx.logger?.error(`Failed to download lyrics share image: ${String(err)}`)
    } finally {
      setDownloading(false)
    }
  }, [ctx, lyrics, resolvedArtwork, activeLines, themeColor, backgroundMode])

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
          gap: 14,
          width: 340,
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
            marginBottom: 2,
          },
        },
        h(
          'span',
          { style: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #FFFFFF)' } },
          '分享歌词',
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
      // Card Preview (matches Image 2)
      h(ShareCardPreview, {
        title: lyrics.title,
        subtitle: lyrics.artist,
        artwork: resolvedArtwork,
        themeColor,
        backgroundMode,
        lyrics: activeLines,
      }),
      // Line selection chips if more than 1 line exists
      lyrics.lines.length > 1
        ? h(
            'div',
            {
              style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              },
            },
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: 'var(--text-muted, #8B95B0)',
                  display: 'flex',
                  justifyContent: 'space-between',
                },
              },
              h('span', null, '点击歌词选择分享行 (最多6行)'),
              h('span', null, `${activeLines.length} 行已选`),
            ),
            h(
              'div',
              {
                style: {
                  maxHeight: 110,
                  overflowY: 'auto',
                  background: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: 8,
                  padding: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                },
              },
              lyrics.lines.map((line, idx) => {
                const isSelected = selectedIndices.includes(idx)
                return h(
                  'div',
                  {
                    key: idx,
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => toggleLine(idx),
                    style: {
                      padding: '5px 8px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                      background: isSelected
                        ? 'var(--surface-selected, rgba(95, 135, 255, 0.2))'
                        : 'transparent',
                      color: isSelected
                        ? '#FFFFFF'
                        : 'var(--text-secondary, #8B95B0)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    },
                  },
                  tablerIcon(isSelected ? 'check' : 'circle', {
                    size: 14,
                    color: isSelected ? '#4D8BFF' : 'rgba(255, 255, 255, 0.3)',
                  }),
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, line),
                )
              }),
            ),
          )
        : null,
      // Background Selector
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
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
              gap: 2,
            },
          },
          (['cover', 'gradient', 'black'] as const).map((mode) => {
            const labels = { cover: '主题色', gradient: '渐变', black: '纯黑' }
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
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
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
      // Bottom Buttons
      h(
        'div',
        {
          style: {
            display: 'flex',
            gap: 10,
            width: '100%',
            marginTop: 4,
          },
        },
        h(
          'div',
          { style: { flex: 1, display: 'flex' } },
          canCopy
            ? h(Button, {
                variant: 'secondary',
                onPress: handleCopyText,
                children: copiedText ? '已复制歌词' : '复制歌词',
              })
            : h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'copy-lyrics-disabled-btn',
                  onClick: () => {
                    setDisabledReason('无法复制歌词：请至少勾选一行歌词')
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
                '复制歌词',
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
