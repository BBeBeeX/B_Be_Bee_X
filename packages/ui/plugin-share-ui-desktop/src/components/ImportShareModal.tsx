import { createElement as h, useState, useCallback, useRef } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  PlayerService,
  LibraryService,
  ShareMetadataEnvelope,
  ShareTrackData,
  SharePlaylistData,
  ShareLyricsData,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, Sheet, tablerIcon, TextField } from '@BBeBee/ui-kit-desktop'
import { decodeSteganography } from '@BBeBee/plugin-share/steganography'
import { decodeMetadata } from '@BBeBee/plugin-share/metadata'

export interface ImportShareModalProps {
  ctx: Context
  open: boolean
  onClose: () => void
}

export function ImportShareModal({ ctx, open, onClose }: ImportShareModalProps): ReactElement | null {
  const [pastedText, setPastedText] = useState('')
  const [decoded, setDecoded] = useState<ShareMetadataEnvelope | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isDecoding, setIsDecoding] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetState = () => {
    setPastedText('')
    setDecoded(null)
    setErrorMsg(null)
    setIsDecoding(false)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  // Decode from raw Base64 string
  const tryDecodeBase64 = useCallback((b64: string) => {
    setErrorMsg(null)
    const envelope = decodeMetadata(b64)
    if (envelope) {
      setDecoded(envelope)
    } else {
      setErrorMsg('无法解析 Base64 数据：非有效的 BBeBee 分享数据包')
    }
  }, [])

  // Decode from an image file using HTML5 canvas
  const handleImageFile = useCallback((file: File) => {
    setErrorMsg(null)
    setIsDecoding(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (!dataUrl) {
        setIsDecoding(false)
        setErrorMsg('文件读取失败')
        return
      }
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const canvasCtx = canvas.getContext('2d', { willReadFrequently: true })
          if (!canvasCtx) {
            setIsDecoding(false)
            setErrorMsg('创建 Canvas 失败')
            return
          }
          canvasCtx.drawImage(img, 0, 0)
          const imgData = canvasCtx.getImageData(0, 0, img.width, img.height)
          const hiddenPayload = decodeSteganography(imgData)

          if (!hiddenPayload) {
            setIsDecoding(false)
            setErrorMsg('未在该图片中检测到 BBeBee 隐写分享数据')
            return
          }

          const envelope = decodeMetadata(hiddenPayload)
          setIsDecoding(false)
          if (envelope) {
            setDecoded(envelope)
          } else {
            setErrorMsg('图片中的隐写数据格式损坏或不匹配')
          }
        } catch (err) {
          setIsDecoding(false)
          setErrorMsg(`解析隐写失败: ${String(err)}`)
        }
      }
      img.onerror = () => {
        setIsDecoding(false)
        setErrorMsg('图片加载解码失败')
      }
      img.src = dataUrl
    }
    reader.onerror = () => {
      setIsDecoding(false)
      setErrorMsg('文件读取失败')
    }
    reader.readAsDataURL(file)
  }, [])

  const handlePlayNow = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) return

    if (decoded.type === 'track') {
      const track = decoded.data as ShareTrackData
      await player.enqueueLast([track.urn])
      await player.play()
      handleClose()
    } else if (decoded.type === 'playlist') {
      const pl = decoded.data as SharePlaylistData
      const urns = pl.tracks?.map((t) => t.urn) ?? [pl.urn]
      await player.enqueueLast(urns)
      await player.play()
      handleClose()
    }
  }

  const handleEnqueue = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) return

    if (decoded.type === 'track') {
      const track = decoded.data as ShareTrackData
      await player.enqueueLast([track.urn])
      handleClose()
    } else if (decoded.type === 'playlist') {
      const pl = decoded.data as SharePlaylistData
      const urns = pl.tracks?.map((t) => t.urn) ?? [pl.urn]
      await player.enqueueLast(urns)
      handleClose()
    }
  }

  const handleSaveToLibrary = async () => {
    if (!decoded) return
    const library = serviceOf<LibraryService>(ctx, 'library')
    if (!library) return

    if (decoded.type === 'track') {
      const track = decoded.data as ShareTrackData
      await library.setSaved(track.urn, true)
    } else if (decoded.type === 'playlist') {
      const pl = decoded.data as SharePlaylistData
      await library.setSaved(pl.urn, true)
    }
    handleClose()
  }

  if (!open) return null

  return h(
    Sheet,
    { open, onClose: handleClose },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: 360,
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
          },
        },
        h(
          'span',
          { style: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #FFFFFF)' } },
          '读取 / 导入分享',
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: handleClose,
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

      !decoded
        ? [
            // Upload Drop Area
            h(
              'div',
              {
                key: 'dropzone',
                onDragOver: (e: React.DragEvent) => e.preventDefault(),
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) handleImageFile(file)
                },
                onClick: () => fileInputRef.current?.click(),
                style: {
                  border: '1.5px dashed var(--border-focus, rgba(95, 135, 255, 0.4))',
                  borderRadius: 12,
                  padding: '24px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.02)',
                  transition: 'all 0.2s ease',
                },
              },
              h('input', {
                type: 'file',
                ref: fileInputRef,
                accept: 'image/png,image/*',
                style: { display: 'none' },
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0]
                  if (file) handleImageFile(file)
                },
              }),
              tablerIcon('photo', { size: 36, color: '#4D8BFF' }),
              h(
                'div',
                { style: { fontSize: 13, fontWeight: 600, color: '#FFFFFF' } },
                isDecoding ? '正在读取隐写数据…' : '拖放分享图片至此，或点击上传',
              ),
              h(
                'div',
                { style: { fontSize: 11, color: 'var(--text-muted, #8B95B0)' } },
                '自动解析 PNG 图片中隐写的歌曲或歌单',
              ),
            ),
            // Or Paste Base64
            h(
              'div',
              {
                key: 'paste-section',
                style: { display: 'flex', flexDirection: 'column', gap: 8 },
              },
              h(
                'div',
                { style: { fontSize: 12, color: 'var(--text-muted, #8B95B0)' } },
                '或者直接粘贴 Base64 数据：',
              ),
              h(TextField, {
                value: pastedText,
                placeholder: '粘贴 Base64 分享数据…',
                onChange: (val: string) => {
                  setPastedText(val)
                  if (val.trim().length > 10) {
                    tryDecodeBase64(val)
                  }
                },
              }),
            ),
            // Error Message
            errorMsg
              ? h(
                  'div',
                  {
                    key: 'error',
                    style: {
                      padding: '8px 12px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      borderRadius: 8,
                      color: '#F87171',
                      fontSize: 12,
                    },
                  },
                  errorMsg,
                )
              : null,
          ]
        : [
            // Successfully Decoded View
            h(
              'div',
              {
                key: 'result',
                style: {
                  background: 'var(--surface-selected, rgba(95, 135, 255, 0.12))',
                  border: '1px solid rgba(95, 135, 255, 0.3)',
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                },
              },
              h(
                'div',
                {
                  style: {
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: '#1a1e2b',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                },
                (() => {
                  const artwork = (decoded.data as { artwork?: string }).artwork
                  return artwork
                    ? h('img', {
                        src: artwork,
                        alt: 'artwork',
                        style: { width: '100%', height: '100%', objectFit: 'cover' },
                      })
                    : h(
                        'span',
                        { style: { fontSize: 24, color: 'rgba(255,255,255,0.4)' } },
                        decoded.type === 'playlist' ? '♫' : '♪',
                      )
                })(),
              ),
              h(
                'div',
                { style: { minWidth: 0, flex: 1 } },
                h(
                  'div',
                  {
                    style: {
                      fontSize: 14,
                      fontWeight: 700,
                      color: '#FFFFFF',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  decoded.type === 'track'
                    ? (decoded.data as ShareTrackData).title
                    : decoded.type === 'playlist'
                      ? (decoded.data as SharePlaylistData).name
                      : (decoded.data as ShareLyricsData).title,
                ),
                h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      color: 'var(--text-muted, #8B95B0)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: 2,
                    },
                  },
                  decoded.type === 'track'
                    ? (decoded.data as ShareTrackData).artist
                    : decoded.type === 'playlist'
                      ? `歌单 • ${(decoded.data as SharePlaylistData).trackCount} 首歌曲`
                      : `歌词 • ${(decoded.data as ShareLyricsData).artist}`,
                ),
                h(
                  'div',
                  {
                    style: {
                      fontSize: 10,
                      color: '#4D8BFF',
                      marginTop: 4,
                      fontWeight: 600,
                    },
                  },
                  `类型：${decoded.type.toUpperCase()} • 隐写校验成功`,
                ),
              ),
            ),
            // Actions
            h(
              'div',
              {
                key: 'actions',
                style: { display: 'flex', gap: 10, marginTop: 4 },
              },
              h(
                'div',
                { style: { flex: 1, display: 'flex' } },
                h(Button, {
                  variant: 'secondary',
                  onPress: resetState,
                  children: '重新选择',
                }),
              ),
              decoded.type !== 'lyrics'
                ? h(
                    'div',
                    { style: { flex: 1, display: 'flex' } },
                    h(Button, {
                      variant: 'primary',
                      onPress: handlePlayNow,
                      children: '立即播放',
                    }),
                  )
                : null,
              decoded.type !== 'lyrics'
                ? h(
                    'div',
                    { style: { flex: 1, display: 'flex' } },
                    h(Button, {
                      variant: 'secondary',
                      onPress: handleEnqueue,
                      children: '加入队列',
                    }),
                  )
                : null,
              decoded.type !== 'lyrics'
                ? h(
                    'div',
                    { style: { flex: 1, display: 'flex' } },
                    h(Button, {
                      variant: 'secondary',
                      onPress: handleSaveToLibrary,
                      children: '收藏',
                    }),
                  )
                : null,
            ),
          ],
    ),
  )
}
