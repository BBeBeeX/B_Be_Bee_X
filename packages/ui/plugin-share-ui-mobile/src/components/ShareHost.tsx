import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  PlayerService,
  ShareAlbumData,
  ShareLyricsData,
  ShareMetadataEnvelope,
  SharePlaylistData,
  ShareService,
  ShareTarget,
  ShareTrackData,
} from '@BBeBee/protocol'
import { useShareModalState } from '@BBeBee/plugin-share/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, EmptyState, Sheet, TextField, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

const TYPE_LABEL: Record<ShareTarget['type'], string> = {
  track: '歌曲',
  playlist: '歌单',
  lyrics: '歌词',
  album: '专辑',
}

/** One human line for an envelope, shared by the share and import panels. */
function describe(envelope: ShareMetadataEnvelope): string {
  switch (envelope.type) {
    case 'track': {
      const d = envelope.data as ShareTrackData
      return `${d.title} — ${d.artist}`
    }
    case 'playlist': {
      const d = envelope.data as SharePlaylistData
      return `${d.name}（${d.trackCount} 首）`
    }
    case 'album': {
      const d = envelope.data as ShareAlbumData
      return `${d.title}${d.artist ? ` — ${d.artist}` : ''}（${d.trackCount} 首）`
    }
    case 'lyrics': {
      const d = envelope.data as ShareLyricsData
      return `${d.title} — ${d.artist}（歌词）`
    }
  }
}

function payloadOf(
  target: ShareTarget,
): ShareTrackData | SharePlaylistData | ShareLyricsData | ShareAlbumData {
  switch (target.type) {
    case 'track':
      return target.track
    case 'playlist':
      return target.playlist
    case 'lyrics':
      return target.lyrics
    case 'album':
      return target.album
  }
}

/** URNs a decoded envelope can start playing, mirroring the desktop importer. */
function urnsOf(envelope: ShareMetadataEnvelope): string[] {
  switch (envelope.type) {
    case 'track':
      return [(envelope.data as ShareTrackData).urn]
    case 'playlist': {
      const d = envelope.data as SharePlaylistData
      return d.tracks?.map((t) => t.urn) ?? [d.urn]
    }
    case 'album': {
      const d = envelope.data as ShareAlbumData
      return d.tracks?.map((t) => t.urn) ?? [d.urn]
    }
    case 'lyrics':
      return []
  }
}

/**
 * Global host for the share sheet on mobile — the twin of the desktop
 * `ShareHost`, listening on the same `share/open` / `share/import` events.
 */
export function ShareHost({ ctx }: { ctx: Context }): ReactElement | null {
  const { isOpen, mode, target, close } = useShareModalState(ctx)

  if (!isOpen) return null

  return mode === 'import'
    ? h(ImportPanel, { ctx, onClose: close })
    : target
      ? h(SharePanel, { ctx, target, onClose: close })
      : null
}

function SharePanel({
  ctx,
  target,
  onClose,
}: {
  ctx: Context
  target: ShareTarget
  onClose: () => void
}): ReactElement {
  const native = nativePrimitives()
  const share = serviceOf<ShareService>(ctx, 'share')

  // The code is derived once per target — encoding is cheap, but a field that
  // rewrites itself on every render would fight the user's long-press.
  const code = useMemo(
    () => (share ? share.encodeMetadata(target.type, payloadOf(target)) : ''),
    [share, target],
  )

  const summary =
    target.type === 'track'
      ? `${target.track.title} — ${target.track.artist}`
      : target.type === 'playlist'
        ? `${target.playlist.name}（${target.playlist.trackCount} 首）`
        : target.type === 'album'
          ? `${target.album.title}${target.album.artist ? ` — ${target.album.artist}` : ''}`
          : `${target.lyrics.title} — ${target.lyrics.artist}（歌词）`

  return h(
    Sheet,
    { open: true, onClose, title: `分享${TYPE_LABEL[target.type]}` },
    h(
      native.View as never,
      { style: { gap: tokens.space[3], paddingBottom: tokens.space[4] } },
      h(Text, { variant: 'lg' }, summary),
      h(TextField, {
        value: code,
        onChange: () => {},
        multiline: true,
        rows: 4,
        disabled: true,
        placeholder: share ? undefined : '分享服务未就绪',
      }),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        share
          ? '长按分享码即可复制；图片卡片请使用桌面端生成。任意 BBeBee 端都可通过「读取分享卡片」粘贴导入。'
          : '分享服务尚未就绪，稍后再试。',
      ),
    ),
  )
}

function ImportPanel({ ctx, onClose }: { ctx: Context; onClose: () => void }): ReactElement {
  const native = nativePrimitives()
  const share = serviceOf<ShareService>(ctx, 'share')
  const [code, setCode] = useState('')
  const [decoded, setDecoded] = useState<ShareMetadataEnvelope | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decode = () => {
    if (!share) {
      setError('分享服务未就绪')
      return
    }
    const trimmed = code.trim()
    if (!trimmed) {
      setDecoded(null)
      setError('请先粘贴分享码')
      return
    }
    const envelope = share.decodeMetadata(trimmed)
    if (envelope) {
      setDecoded(envelope)
      setError(null)
    } else {
      setDecoded(null)
      setError('无法解析分享码：不是有效的 BBeBee 分享数据包')
    }
  }

  const handlePlayNow = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setError('播放器服务未就绪')
      return
    }
    try {
      await player.playNow(urnsOf(decoded))
      onClose()
    } catch (err) {
      ctx.logger.error(`plugin-share-ui-mobile: failed to play shared item: ${String(err)}`)
      setError(`播放失败: ${String(err)}`)
    }
  }

  const handleEnqueue = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setError('播放器服务未就绪')
      return
    }
    try {
      player.enqueueLast(urnsOf(decoded))
      onClose()
    } catch (err) {
      ctx.logger.error(`plugin-share-ui-mobile: failed to enqueue shared item: ${String(err)}`)
      setError(`加入队列失败: ${String(err)}`)
    }
  }

  return h(
    Sheet,
    { open: true, onClose, title: '读取分享卡片' },
    h(
      native.View as never,
      { style: { gap: tokens.space[3], paddingBottom: tokens.space[4] } },
      h(TextField, {
        value: code,
        onChange: (next) => {
          setCode(next)
          // A fresh paste invalidates the previous result; leaving it on
          // screen would let 播放 act on an envelope the user replaced.
          setDecoded(null)
        },
        multiline: true,
        rows: 4,
        placeholder: '粘贴 Base64 分享码',
        error: error ?? undefined,
      }),
      decoded
        ? h(Text, { variant: 'lg' }, `已识别${TYPE_LABEL[decoded.type]}：${describe(decoded)}`)
        : h(EmptyState, {
            icon: '⇪',
            title: '粘贴分享码',
            description: '从其他 BBeBee 端复制的分享码粘贴到上方即可导入。',
          }),
      decoded && decoded.type !== 'lyrics'
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', gap: tokens.space[3] } },
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(Button, {
                variant: 'primary',
                onPress: handlePlayNow,
                testID: 'share-import-play',
                children: '立即播放',
              }),
            ),
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(Button, {
                variant: 'secondary',
                onPress: handleEnqueue,
                testID: 'share-import-enqueue',
                children: '加入队列',
              }),
            ),
          )
        : null,
      h(Button, {
        variant: 'secondary',
        onPress: decode,
        testID: 'share-import-decode',
        children: '解析分享码',
      }),
    ),
  )
}
