/**
 * React DOM views for `plugin-sources`.
 *
 * Library and album detail. Every value comes from a hook in the headless
 * package — `useTracks`, `useAlbums`, `useAlbum` — and this file is layout,
 * gestures and event wiring only (docs/08 1).
 *
 * The one thing worth doing carefully here is the *three* states a catalogue
 * read has. A screen that treats loading, empty and failed the same shows a
 * blank pane and tells the user nothing about which one they are looking at.
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
} from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/** What a screen shows while it does not yet have an answer. */
function Pending({ label }: { label: string }): ReactElement {
  return h(EmptyState, { title: label, accessibilityLabel: label })
}

/**
 * A failed read, said out loud.
 *
 * Never silently empty: "your library is empty" and "the catalogue could not
 * be read" look identical to a user, and only one of them is their problem.
 */
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

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: tokens.space[3],
          padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        },
      },
      h(
        'div',
        {
          role: 'tablist',
          'aria-label': 'Library Scope',
          style: { display: 'flex', gap: tokens.space[2] },
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
        'div',
        {
          role: 'tablist',
          'aria-label': 'Library View',
          style: { display: 'flex', gap: tokens.space[2] },
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
          ? h(TrackList, {
              ctx,
              tracks: tracks.items,
              scope,
              onToggleLoved: (urn, loved) => void setLoved(urn, loved),
              onEndReached: tracks.loadMore,
            })
          : h(AlbumGrid, {
              albums: albums.items,
              scope,
              onOpenAlbum,
              onEndReached: albums.loadMore,
            }),
  )
}

function TrackList({
  ctx,
  tracks,
  scope,
  onToggleLoved,
  onEndReached,
}: {
  ctx: Context
  tracks: readonly Track[]
  scope: LibraryScope
  onToggleLoved: (urn: string, loved: boolean) => void
  onEndReached: () => void
}): ReactElement {
  const empty =
    scope === 'favorites'
      ? h(EmptyState, {
          icon: '♥',
          title: 'No favorites yet',
          description: 'Click the heart icon on any track to add it to your favorites.',
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

  return h(List<Track>, {
    items: tracks,
    accessibilityLabel: 'Tracks',
    estimatedItemSize: tokens.size.row,
    keyExtractor: (track) => track.urn,
    onEndReached,
    empty,
    renderItem: (track) =>
      h(TrackRow, {
        track,
        showAlbum: true,
        // Playing one track queues just that track; queueing the whole list
        // is a decision for the album screen, where "the rest" has a meaning.
        onPress: () => {
          void serviceOf<PlayerService>(ctx, 'player')?.playNow([track.urn])
          serviceOf<UiService>(ctx, 'ui')?.navigate('player.now-playing')
        },
        onToggleLoved: () => onToggleLoved(track.urn, !track.loved),
      }),
  })
}

function AlbumGrid({
  albums,
  scope,
  onOpenAlbum,
  onEndReached,
}: {
  albums: readonly Album[]
  scope: LibraryScope
  onOpenAlbum?: (urn: string) => void
  onEndReached: () => void
}): ReactElement {
  const empty =
    scope === 'favorites'
      ? h(EmptyState, { icon: '♥', title: 'No favorite albums yet' })
      : scope === 'local'
        ? h(EmptyState, { icon: '💿', title: 'No local albums' })
        : h(EmptyState, { icon: '💿', title: 'No albums yet' })

  return h(List<Album>, {
    items: albums,
    accessibilityLabel: 'Albums',
    estimatedItemSize: 220,
    keyExtractor: (album) => album.urn,
    onEndReached,
    empty,
    renderItem: (album) =>
      h(
        'button',
        {
          type: 'button',
          onClick: () => onOpenAlbum?.(album.urn),
          'aria-label': album.title,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
            width: '100%',
            padding: tokens.space[2],
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: p().text.primary,
          },
        },
        h(Artwork, { artwork: album.artwork, size: tokens.size.artworkThumb }),
        h(
          'span',
          { style: { textAlign: 'left', minWidth: 0 } },
          h(Text, { numberOfLines: 1, children: album.title }),
          album.year
            ? h(Text, { variant: 'sm', tone: 'muted', children: String(album.year) })
            : null,
        ),
      ),
  })
}

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const album = useAlbum(ctx, urn)

  if (album.status === 'loading' || album.status === 'idle') {
    return h(Pending, { label: 'Loading album…' })
  }
  if (album.status === 'error' || !album.data) {
    return h(EmptyState, {
      icon: '⚠',
      title: 'Album unavailable',
      description: album.error?.message,
    })
  }

  const detail = album.data
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h(
      'header',
      {
        style: {
          display: 'flex',
          gap: tokens.space[4],
          padding: tokens.space[4],
          alignItems: 'flex-end',
        },
      },
      h(Artwork, { artwork: detail.artwork, size: 160, radius: tokens.radius.md }),
      h(
        'div',
        null,
        h(Text, { variant: 'xl', children: detail.title }),
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
          // Disabled rather than absent: an album with no playable tracks is
          // a real state, and hiding the control hides the reason.
          disabled: detail.tracks.length === 0,
        }),
      ),
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
          // Playing from an album plays the album from that point, which is
          // what "play this track" means in an album context.
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
 * The preview is the screen's reason for existing. A set pasted from a forum
 * is opaque — the user cannot read JSON at a glance, and an import that
 * silently adds eleven sources is one they cannot undo without knowing which
 * eleven. So what *would* be imported is named before the button is pressed.
 */
export function ImportScreen({ ctx }: { ctx: Context }): ReactElement {
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
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
      rows: 14,
      placeholder: '{ "sourceUrl": "https://…", "sourceName": "…", "ruleStream": { … } }',
      accessibilityLabel: 'Source string',
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          'ul',
          {
            style: {
              margin: 0,
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              background: scheme.bg.raised,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[1],
            },
            'aria-label': 'What will be imported',
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            `${state.preview.count} source${state.preview.count === 1 ? '' : 's'} in this string`,
          ),
          ...state.preview.names.map((name) => h('li', { key: name }, h(Text, { variant: 'sm' }, name))),
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
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
    state.report
      ? h(
          Text,
          { variant: 'sm', tone: state.report.added.length + state.report.updated.length > 0 ? 'accent' : 'muted' },
          summariseImport(state.report),
        )
      : null,
  )
}

/** What an import did, in a sentence. */
function summariseImport(report: ImportReport): string {
  const parts: string[] = []
  if (report.added.length) parts.push(`${report.added.length} added`)
  if (report.updated.length) parts.push(`${report.updated.length} updated`)
  if (report.unchanged.length) parts.push(`${report.unchanged.length} unchanged`)
  if (report.rejected.length) parts.push(`${report.rejected.length} rejected`)
  // Never an empty string: "nothing happened" reads as a button that did not
  // work, which is the one thing it must not look like.
  return parts.length > 0 ? parts.join(', ') : 'nothing to import'
}

/* ── diagnosing ─────────────────────────────────────────────────────────── */

/**
 * One source, traced and edited in the same place.
 *
 * docs/06 §10: the debug screen *is* the editor. The loop that repairs a
 * rotted source is run a step, see which rule failed, change it, run it again
 * — and splitting that across two screens turns a seconds-long fix into a
 * navigation exercise.
 */
export function DebugScreen({ ctx, sourceId }: { ctx: Context; sourceId: string }): ReactElement {
  const trace = useSourceTrace(ctx, sourceId)
  const editor = useSourceEditor(ctx, sourceId)
  const [query, setQuery] = useState('test')

  return h(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Diagnose'),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2], alignItems: 'flex-start' } },
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
    ),
    h(TraceList, { events: trace.events, running: trace.running }),

    h(Text, { variant: 'md' }, 'The document'),
    h(TextField, {
      value: editor.text,
      onChange: editor.setText,
      multiline: true,
      rows: 16,
      accessibilityLabel: 'Source document',
      testID: 'source-editor',
      ...(editor.error ? { error: editor.error } : {}),
    }),
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
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

/**
 * The trace, as lines.
 *
 * Every step, including the ones that worked — the failure is usually two
 * steps before the empty result, and a list of failures alone hides it.
 */
function TraceList({
  events,
  running,
}: {
  events: readonly TraceEvent[]
  running: boolean
}): ReactElement {
  const scheme = p()
  if (events.length === 0) {
    return h(EmptyState, {
      title: running ? 'Running…' : 'No trace yet',
      description: running ? undefined : 'Run a step to see what each rule receives and produces.',
    })
  }
  return h(
    'ol',
    {
      'aria-label': 'Trace',
      'aria-live': 'polite',
      style: {
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[1],
        fontFamily: tokens.font.family.mono,
        fontSize: tokens.font.size.sm,
      },
    },
    ...events.map((event, i) =>
      h(
        'li',
        {
          key: i,
          style: {
            padding: tokens.space[2],
            borderRadius: tokens.radius.sm,
            background: scheme.bg.raised,
            borderLeft: `3px solid ${event.kind === 'error' ? scheme.state.error : scheme.border.subtle}`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        },
        traceLine(event),
      ),
    ),
  )
}

/** One event as text. Redacted upstream; this only lays it out. */
function traceLine(event: TraceEvent): string {
  switch (event.kind) {
    case 'http':
      // Status 0 means the request never came back — which is the diagnosis,
      // so it is spelled out rather than shown as a zero.
      return `${event.method} ${event.url} → ${event.status === 0 ? 'no response' : event.status} (${event.ms}ms)`
    case 'rule':
      return `${event.block}.${event.field} [${event.engine}] ${event.rule}\n  → ${event.output}`
    case 'error':
      return `✗ ${event.block ? `${event.block}.${event.field ?? ''} ` : ''}${event.message}`
    case 'result':
      return `✓ ${event.summary}`
  }
}

export const name = 'plugin-sources-ui-desktop'

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
  }, 'sources-ui-desktop')
}

export default { name, inject, apply }
