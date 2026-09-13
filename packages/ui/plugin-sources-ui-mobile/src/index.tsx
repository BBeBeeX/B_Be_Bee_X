/**
 * React Native views for `plugin-sources`.
 *
 * Same hooks, same view ids, same three-state handling as the desktop twin —
 * only the elements differ. A tab bar of two buttons rather than a tablist,
 * a single-column list rather than a grid, because a phone has one column.
 */

import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, CatalogQuery, ImportReport, PlayerService, Track, TraceEvent, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  useAlbum,
  useAlbums,
  useSetLoved,
  useSourceEditor,
  useSourceImport,
  useSourceTrace,
  useTracks,
} from '@BBeBee/plugin-sources/hooks'
import {
  Artwork,
  Button,
  EmptyState,
  List,
  Text,
  TextField,
  TrackRow,
  nativePrimitives,
} from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

/** A failed read, said out loud — never a silently empty library. */
function Failed({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  return h(EmptyState, {
    icon: '⚠',
    title: 'Could not read the library',
    description: error.message,
    action: h(Button, { onPress: onRetry, variant: 'secondary', children: 'Try again' }),
  })
}

const SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'local', label: 'Local' },
  { id: 'favorites', label: 'Favorites' },
] as const

export type LibraryScope = (typeof SCOPES)[number]['id']

export function LibraryScreen({
  ctx,
  onOpenAlbum,
}: {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const native = nativePrimitives()
  const [scope, setScope] = useState<LibraryScope>('all')
  const [tab, setTab] = useState<'tracks' | 'albums'>('tracks')
  const setLoved = useSetLoved(ctx)

  const query = useMemo<CatalogQuery>(() => {
    const base: CatalogQuery = { sort: 'title' }
    if (scope === 'local') {
      return { ...base, sourceIds: ['local'] }
    }
    if (scope === 'favorites') {
      return { ...base, onlyLoved: true }
    }
    return base
  }, [scope])

  const tracks = useTracks(ctx, query)
  const albums = useAlbums(ctx, query)
  const active = tab === 'tracks' ? tracks : albums

  const handleOpenAlbum = (urn: string) => {
    onOpenAlbum?.(urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.album, { urn })
  }

  const trackEmpty =
    scope === 'favorites'
      ? h(EmptyState, {
          icon: '♥',
          title: 'No favorites yet',
          description: 'Tap the heart icon on any track to add it to your favorites.',
        })
      : scope === 'local'
        ? h(EmptyState, {
            icon: '📁',
            title: 'No local music',
            description: 'Add a folder in Settings and it will appear here as it is scanned.',
          })
        : h(EmptyState, {
            icon: '📁',
            title: 'No music yet',
            description: 'Add a folder in Settings and it will appear here as it is scanned.',
          })

  const albumEmpty =
    scope === 'favorites'
      ? h(EmptyState, { icon: '♥', title: 'No favorite albums yet' })
      : scope === 'local'
        ? h(EmptyState, { icon: '💿', title: 'No local albums' })
        : h(EmptyState, { icon: '💿', title: 'No albums yet' })

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[2],
        },
      },
      h(
        native.View as never,
        {
          accessibilityRole: 'tablist',
          style: { flexDirection: 'row', gap: tokens.space[2] },
        },
        SCOPES.map(({ id, label }) =>
          h(Button, {
            key: id,
            variant: scope === id ? 'primary' : 'ghost',
            onPress: () => setScope(id),
            accessibilityLabel: `Show ${label}`,
            children: label,
          }),
        ),
      ),
      h(
        native.View as never,
        {
          accessibilityRole: 'tablist',
          style: { flexDirection: 'row', gap: tokens.space[2] },
        },
        (['tracks', 'albums'] as const).map((id) =>
          h(Button, {
            key: id,
            variant: tab === id ? 'secondary' : 'ghost',
            onPress: () => setTab(id),
            accessibilityLabel: `Show ${id}`,
            children: id === 'tracks' ? 'Tracks' : 'Albums',
          }),
        ),
      ),
    ),
    active.status === 'error' && active.error
      ? h(Failed, { error: active.error, onRetry: active.reload })
      : active.status === 'loading' && active.items.length === 0
        ? h(Pending, { label: 'Loading your library…' })
        : tab === 'tracks'
          ? h(List<Track>, {
              items: tracks.items,
              accessibilityLabel: 'Tracks',
              estimatedItemSize: tokens.size.row,
              keyExtractor: (track) => track.urn,
              onEndReached: tracks.loadMore,
              empty: trackEmpty,
              renderItem: (track) =>
                h(TrackRow, {
                  track,
                  showAlbum: true,
                  onPress: () => {
                    void serviceOf<PlayerService>(ctx, 'player')?.playNow([track.urn])
                    serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
                  },
                  onToggleLoved: () => void setLoved(track.urn, !track.loved),
                }),
            })
          : h(List<Album>, {
              items: albums.items,
              accessibilityLabel: 'Albums',
              estimatedItemSize: tokens.size.row,
              keyExtractor: (album) => album.urn,
              onEndReached: albums.loadMore,
              empty: albumEmpty,
              renderItem: (album) =>
                h(
                  native.Pressable as never,
                  {
                    accessibilityRole: 'button',
                    accessibilityLabel: album.title,
                    onPress: () => handleOpenAlbum(album.urn),
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: tokens.space[3],
                      padding: tokens.space[2],
                    },
                  },
                  h(Artwork, {
                    artwork: album.artwork,
                    seed: album.urn,
                    size: tokens.size.artworkThumb,
                  }),
                  h(
                    native.View as never,
                    { style: { flex: 1, minWidth: 0 } },
                    h(Text, { numberOfLines: 1, children: album.title }),
                    album.year
                      ? h(Text, { variant: 'sm', tone: 'muted', children: String(album.year) })
                      : null,
                  ),
                ),
            }),
  )
}

export function AlbumScreen({
  ctx,
  urn,
  onBack,
}: {
  ctx: Context
  urn?: string
  onBack?: () => void
}): ReactElement {
  const native = nativePrimitives()
  const album = useAlbum(ctx, urn)

  const handleBack = () => {
    if (onBack) onBack()
    else serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.library)
  }

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: 'Loading album…' })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: '⚠',
      title: 'Album unavailable',
      description: album.error?.message,
      action: h(Button, { onPress: handleBack, variant: 'secondary', children: 'Back to library' }),
    })
  }

  const detail = album.data
  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[2],
        },
      },
      h(
        native.Pressable as never,
        {
          accessibilityRole: 'button',
          accessibilityLabel: 'Back to library',
          onPress: handleBack,
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: tokens.space[1],
            paddingHorizontal: tokens.space[2],
          },
        },
        h(Text, { variant: 'sm', tone: 'accent', children: '‹ Library' }),
      ),
    ),
    h(
      native.View as never,
      { style: { alignItems: 'center', gap: tokens.space[2], padding: tokens.space[4] } },
      h(Artwork, { artwork: detail.artwork, seed: detail.urn, size: 200, radius: tokens.radius.md }),
      h(Text, { variant: 'xl', numberOfLines: 2, children: detail.title }),
      h(Text, {
        tone: 'muted',
        children: detail.artists?.map((a) => a.name).join(', ') ?? '',
      }),
      h(Button, {
        onPress: () => {
          void serviceOf<PlayerService>(ctx, 'player')?.playNow(detail.tracks.map((t) => t.urn))
          serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
        },
        children: 'Play album',
        disabled: detail.tracks.length === 0,
      }),
    ),
    h(List<Track>, {
      items: detail.tracks,
      accessibilityLabel: `Tracks on ${detail.title}`,
      estimatedItemSize: tokens.size.row,
      keyExtractor: (track) => track.urn,
      empty: h(EmptyState, { title: 'This album has no tracks' }),
      renderItem: (track, index) =>
        h(TrackRow, {
          track,
          showArtwork: false,
          // Playing from an album plays the album from that point.
          onPress: () => {
            void serviceOf<PlayerService>(ctx, 'player')?.playNow(
              detail.tracks.map((t) => t.urn),
              { startIndex: index },
            )
            serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
          },
        }),
    }),
  )
}


/* ── importing ──────────────────────────────────────────────────────────── */

/**
 * Paste a source string.
 *
 * Same screen as desktop, same hook, different primitives — which is the whole
 * arrangement in docs/08 §1. The preview exists for the same reason too: a set
 * pasted from a forum is opaque, and an import that silently adds eleven
 * sources is one the user cannot undo without knowing which eleven.
 */
export function ImportScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Import a source'),
    h(
      Text,
      { variant: 'sm', tone: 'muted' },
      'Paste a source string — one document or a whole set. Nothing is written until you import.',
    ),
    h(TextField, {
      value: state.text,
      onChange: state.setText,
      multiline: true,
      rows: 10,
      placeholder: '{ "sourceUrl": "https://…", "sourceName": "…" }',
      accessibilityLabel: 'Source string',
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          native.View as never,
          {
            accessibilityLabel: 'What will be imported',
            style: {
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              backgroundColor: scheme.bg.raised,
              gap: tokens.space[1],
            },
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            `${state.preview.count} source${state.preview.count === 1 ? '' : 's'} in this string`,
          ),
          ...state.preview.names.map((name) => h(Text, { key: name, variant: 'sm' }, name)),
        )
      : null,
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2] } },
      h(Button, {
        onPress: state.submit,
        disabled: state.busy || !state.preview,
        loading: state.busy,
        testID: 'source-import-submit',
        children: 'Import',
      }),
      h(Button, {
        variant: 'ghost',
        onPress: state.reset,
        disabled: state.busy,
        children: 'Clear',
      }),
    ),
    state.report ? h(Text, { variant: 'sm', tone: 'muted' }, summariseImport(state.report)) : null,
  )
}

/** What an import did, in a sentence. Never empty — see the desktop twin. */
function summariseImport(report: ImportReport): string {
  const parts: string[] = []
  if (report.added.length) parts.push(`${report.added.length} added`)
  if (report.updated.length) parts.push(`${report.updated.length} updated`)
  if (report.unchanged.length) parts.push(`${report.unchanged.length} unchanged`)
  if (report.rejected.length) parts.push(`${report.rejected.length} rejected`)
  return parts.length > 0 ? parts.join(', ') : 'nothing to import'
}

/* ── diagnosing ─────────────────────────────────────────────────────────── */

/**
 * One source, traced and edited in the same place (docs/06 §10).
 *
 * On a phone this is the screen that matters most: a source pasted from a
 * forum breaks on a device, far from any editor, and the whole point of the
 * string model is that the fix is possible there.
 */
export function DebugScreen({ ctx, sourceId }: { ctx: Context; sourceId: string }): ReactElement {
  const native = nativePrimitives()
  const trace = useSourceTrace(ctx, sourceId)
  const editor = useSourceEditor(ctx, sourceId)
  const [query, setQuery] = useState('test')

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Diagnose'),
    h(TextField, {
      value: query,
      onChange: setQuery,
      placeholder: 'Search text',
      accessibilityLabel: 'Search text to trace',
      testID: 'trace-query',
    }),
    h(Button, {
      onPress: () => trace.run({ kind: 'search', text: query }),
      disabled: trace.running,
      loading: trace.running,
      testID: 'trace-run',
      children: 'Run search',
    }),
    h(TraceList, { events: trace.events, running: trace.running }),
    h(Text, { variant: 'md' }, 'The document'),
    h(TextField, {
      value: editor.text,
      onChange: editor.setText,
      multiline: true,
      rows: 10,
      accessibilityLabel: 'Source document',
      testID: 'source-editor',
      ...(editor.error ? { error: editor.error } : {}),
    }),
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2] } },
      h(Button, {
        onPress: editor.save,
        disabled: !editor.dirty || editor.saving,
        loading: editor.saving,
        testID: 'source-save',
        children: 'Save and re-run',
      }),
      h(Button, {
        variant: 'ghost',
        onPress: editor.revert,
        disabled: !editor.dirty,
        children: 'Revert',
      }),
    ),
  )
}

/** Every step, including the ones that worked. See the desktop twin. */
function TraceList({
  events,
  running,
}: {
  events: readonly TraceEvent[]
  running: boolean
}): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  if (events.length === 0) {
    return h(EmptyState, {
      title: running ? 'Running…' : 'No trace yet',
      description: running ? undefined : 'Run a step to see what each rule receives and produces.',
    })
  }
  return h(
    native.View as never,
    { accessibilityLabel: 'Trace', style: { gap: tokens.space[1] } },
    ...events.map((event, i) =>
      h(
        native.View as never,
        {
          key: i,
          style: {
            padding: tokens.space[2],
            borderRadius: tokens.radius.sm,
            backgroundColor: scheme.bg.raised,
            borderLeftWidth: 3,
            borderLeftColor: event.kind === 'error' ? scheme.state.error : scheme.border.subtle,
          },
        },
        h(Text, { variant: 'sm' }, traceLine(event)),
      ),
    ),
  )
}

/** One event as text. Redacted upstream; this only lays it out. */
function traceLine(event: TraceEvent): string {
  switch (event.kind) {
    case 'http':
      return `${event.method} ${event.url} → ${event.status === 0 ? 'no response' : event.status} (${event.ms}ms)`
    case 'rule':
      return `${event.block}.${event.field} [${event.engine}] ${event.rule}\n  → ${event.output}`
    case 'error':
      return `✗ ${event.block ? `${event.block}.${event.field ?? ''} ` : ''}${event.message}`
    case 'result':
      return `✓ ${event.summary}`
  }
}

export const name = 'plugin-sources-ui-mobile'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.sources` through its hooks threw
 * `cannot get property "sources" without inject` on a device while every
 * test passed, because tests built a root context where that read answers
 * `undefined` instead.
 *
 * Registering a closure over the context this plugin was applied with is the
 * fix, and it is what every view package here does: the screen runs on a
 * context with exactly what this package's `inject` declares. The shell's
 * props are still forwarded, so a view that takes more than `ctx` keeps
 * working.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  // `h(Screen, …)`, not `Screen(…)`: calling a component as a function splices
  // its hooks into this one's list, which works right up until someone renders
  // it conditionally. An element keeps them separate.
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export const inject = ['ui', 'sources']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.library, bound(ctx, LibraryScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.album, bound(ctx, AlbumScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, bound(ctx, ImportScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceDebug, bound(ctx, DebugScreen))
  }, 'sources-ui-mobile')
}

export default { name, inject, apply }
