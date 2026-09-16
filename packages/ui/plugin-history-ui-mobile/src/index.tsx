/**
 * React Native views for `@BBeBee/plugin-history`.
 *
 * One screen: playback history and activity statistics.
 */

import { createElement as h, Fragment } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { PlayRecord, Track } from '@BBeBee/protocol'
import { HISTORY_VIEWS } from '@BBeBee/plugin-history/views'
import {
  usePlayHistory,
  usePlayHistoryStats,
  useTracksByUrn,
  useTransport,
} from '@BBeBee/plugin-player/hooks'
import { ContextMenu, EmptyState, List, Text, TrackRow } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import type { TrackRowProps } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

function fallbackTrack(urn: string): Track {
  return { urn, title: '加载中…', artists: [] }
}

function formatPlayDuration(ms: number): string {
  if (ms <= 0) return '0 分钟'
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes === 0) return '< 1 分钟'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分钟`
}

export function HistoryScreen({ ctx }: { ctx: Context }): ReactElement {
  const { records, loading } = usePlayHistory(ctx, { limit: 100 })
  const { stats } = usePlayHistoryStats(ctx)
  const transport = useTransport(ctx)
  const tracks = useTracksByUrn(
    ctx,
    records.map((r) => r.trackUrn),
  )
  const menu = useTrackMenu(ctx)

  if (records.length === 0 && !loading) {
    return h(EmptyState, {
      icon: '🎵',
      title: '暂无播放记录',
      description: '从曲库播放音乐后，播放历史与统计将显示在这里。',
    })
  }

  return h(
    Fragment,
    null,
    // Mobile Header Stats Summary
    h(
      'div',
      {
        style: {
          padding: '16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        },
      },
      h(Text, { variant: 'lg', children: '播放历史' }),
      h(
        'div',
        {
          style: {
            display: 'flex',
            gap: 16,
            marginTop: 8,
            fontSize: 12,
            color: '#8e8e93',
          },
        },
        h('span', null, `总播放: ${stats.totalPlays} 次`),
        h('span', null, `累计时长: ${formatPlayDuration(stats.totalMsPlayed)}`),
        h('span', null, `今日: ${stats.todayPlays} 首`),
      ),
    ),
    h(List<PlayRecord>, {
      items: records,
      accessibilityLabel: '播放历史',
      estimatedItemSize: tokens.size.row,
      keyExtractor: (item) => item.id,
      renderItem: (item) => {
        const track = tracks.get(item.trackUrn) ?? fallbackTrack(item.trackUrn)
        const isActive = transport.trackUrn === item.trackUrn
        return h(CachedTrackRow, {
          ctx,
          track,
          active: isActive,
          showArtwork: true,
          onPress: () => {
            void ctx.player?.playNow?.([item.trackUrn])
          },
          onMore: (anchor) => menu.open({ track }, anchor),
        })
      },
    }),
    h(ContextMenu, menu.menuProps),
  )
}

export const name = 'plugin-history-ui-mobile'
export const inject = ['ui', 'player', 'sources']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-history-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(HISTORY_VIEWS.history, bound(ctx, HistoryScreen))
  }, 'history-ui-mobile')
}

export default { name, inject, apply }
