import { createElement as h, Fragment, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import { useRecommendShelf, useRecommendSources } from '@BBeBee/plugin-sources/hooks'
import { EmptyState, Text } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendCard } from '../components/RecommendCard.js'

/**
 * The recommendation shelf page.
 *
 * One section per recommend-capable source: the source's name, a "show all"
 * affordance, and the feed's first page as a horizontal card row — the
 * streaming-standard shelf. Each shelf asks its own source, so one slow or
 * broken backend collapses to its own section's error line while the others
 * render whole.
 */
export function RecommendScreen({
  ctx,
  onOpenAlbum,
}: {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const sources = useRecommendSources(ctx)

  const openCard = (entry: BrowseEntry) => {
    if (!entry.urn || entry.kind !== 'album') return
    onOpenAlbum?.(entry.urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate('album.view', { urn: entry.urn })
  }

  return h(
    'section',
    {
      'aria-label': 'Recommendations',
      'data-testid': 'recommend-screen',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[5], padding: tokens.space[4] },
    },
    sources.length === 0
      ? h(EmptyState, {
          title: '暂无推荐',
          description: '导入一个实现了推荐接口的音乐源后，这里会出现它的推荐歌单。',
        })
      : h(
          Fragment,
          null,
          ...sources.map((source) =>
            h(RecommendShelf, {
              key: source.sourceId,
              ctx,
              sourceId: source.sourceId,
              sourceName: source.displayName,
              onOpenCard: openCard,
            }),
          ),
        ),
  )
}

function RecommendShelf({
  ctx,
  sourceId,
  sourceName,
  onOpenCard,
}: {
  ctx: Context
  sourceId: string
  sourceName: string
  onOpenCard: (entry: BrowseEntry) => void
}): ReactElement {
  const shelf = useRecommendShelf(ctx, sourceId)

  const showAll = () => {
    serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.recommendAll, {
      sourceId,
      name: sourceName,
    })
  }

  return h(
    'section',
    {
      'aria-label': `${sourceName} 推荐歌单`,
      'data-testid': `recommend-shelf-${sourceId}`,
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3] },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
      h(Text, { variant: 'lg', testID: 'recommend-shelf-title' }, `${sourceName} · 推荐歌单`),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'recommend-show-all',
          onClick: showAll,
          style: {
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary, rgba(255,255,255,0.75))',
            fontSize: 13,
            cursor: 'pointer',
            padding: '2px 4px',
          },
        },
        '显示全部',
      ),
    ),
    shelf.status === 'loading'
      ? h(Text, { variant: 'sm', tone: 'muted' }, '加载中…')
      : shelf.status === 'error'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
            h(Text, { variant: 'sm', tone: 'error' }, `推荐加载失败：${shelf.error?.message ?? ''}`),
            h(
              'button',
              {
                type: 'button',
                onClick: shelf.reload,
                style: {
                  alignSelf: 'flex-start',
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary, #5F87FF)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 13,
                },
              },
              '重试',
            ),
          )
        : h(
            'div',
            {
              className: 'no-scrollbar',
              style: {
                display: 'flex',
                gap: tokens.space[3],
                overflowX: 'auto',
                paddingBottom: tokens.space[1],
              },
            },
            ...(shelf.data ?? []).map((entry) =>
              h(RecommendCard, { key: entry.id, ctx, entry, onPress: onOpenCard }),
            ),
          ),
  )
}
