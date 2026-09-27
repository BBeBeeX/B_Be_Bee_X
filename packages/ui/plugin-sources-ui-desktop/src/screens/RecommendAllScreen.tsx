import { createElement as h, Fragment, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, UiService } from '@BBeBee/protocol'
import { useRecommendFeed } from '@BBeBee/plugin-sources/hooks'
import { Button, EmptyState, Text } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendCard } from '../components/RecommendCard.js'

/**
 * One source's whole recommendation feed, as a grid.
 *
 * The page "显示全部" lands on. Twenty cards per step — two of the feed's
 * ten-card pages — and a show-more control beneath, until a short page says
 * the curated list has run out and the control stands down.
 */
export function RecommendAllScreen({
  ctx,
  sourceId,
  name,
  onOpenAlbum,
}: {
  ctx: Context
  sourceId?: string
  name?: string
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const feed = useRecommendFeed(ctx, sourceId)

  const openCard = (entry: BrowseEntry) => {
    if (!entry.urn || entry.kind !== 'album') return
    onOpenAlbum?.(entry.urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate('album.view', { urn: entry.urn })
  }

  return h(
    'section',
    {
      'aria-label': 'All recommendations',
      'data-testid': 'recommend-all-screen',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] },
    },
    h(Text, { variant: 'lg', testID: 'recommend-all-title' }, `${name ?? '推荐'} · 全部推荐歌单`),
    !sourceId
      ? h(EmptyState, { title: '未选择音乐源', description: '从推荐页的“显示全部”进入。' })
      : feed.items.length === 0 && feed.loading
        ? h(Text, { variant: 'sm', tone: 'muted' }, '加载中…')
        : feed.items.length === 0 && feed.error
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
              h(Text, { variant: 'sm', tone: 'error' }, `推荐加载失败：${feed.error.message}`),
              h(Button, { onPress: feed.loadMore, testID: 'recommend-retry', children: '重试' }),
            )
          : feed.items.length === 0
            ? h(EmptyState, { title: '这个源暂时没有推荐', description: '它实现了推荐接口，但推荐列表是空的。' })
            : h(
                Fragment,
                null,
                h(
                  'div',
                  {
                    'data-testid': 'recommend-grid',
                    style: {
                      display: 'grid',
                      // Fixed tracks matching the card's fixed size: the kit's
                      // Artwork takes a numeric size, so the grid flows the
                      // cells rather than stretching the card.
                      gridTemplateColumns: 'repeat(auto-fill, 160px)',
                      gap: tokens.space[4],
                    },
                  },
                  ...feed.items.map((entry) =>
                    h(RecommendCard, {
                      key: entry.id,
                      ctx,
                      entry,
                      onPress: openCard,
                    }),
                  ),
                ),
                feed.error
                  ? h(Text, { variant: 'sm', tone: 'error' }, `加载失败：${feed.error.message}`)
                  : null,
                feed.hasMore
                  ? h(
                      'div',
                      { style: { display: 'flex', justifyContent: 'center', padding: tokens.space[2] } },
                      h(Button, {
                        onPress: feed.loadMore,
                        testID: 'recommend-show-more',
                        disabled: feed.loading,
                        loading: feed.loading,
                        children: feed.loading ? '加载中…' : '显示更多',
                      }),
                    )
                  : null,
              ),
  )
}
