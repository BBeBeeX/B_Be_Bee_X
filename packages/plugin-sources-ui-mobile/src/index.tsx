/**
 * React Native views for `plugin-sources`.
 *
 * Same hooks, same view ids, same three-state handling as the desktop twin —
 * only the elements differ. A tab bar of two buttons rather than a tablist,
 * a single-column list rather than a grid, because a phone has one column.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { Album, ImportReport, Track, TraceEvent } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  useAlbum,
  useAlbums,
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

export function LibraryScreen({
  ctx,
  onOpenAlbum,
}: {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const native = nativePrimitives()
  const [tab, setTab] = useState<'tracks' | 'albums'>('tracks')
  const tracks = useTracks(ctx, { sort: 'title' })
  const albums = useAlbums(ctx, { sort: 'title' })
  const active = tab === 'tracks' ? tracks : albums

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      {
        accessibilityRole: 'tablist',
        style: { flexDirection: 'row', gap: tokens.space[2], padding: tokens.space[3] },
      },
      (['tracks', 'albums'] as const).map((id) =>
        h(Button, {
          key: id,
          variant: tab === id ? 'primary' : 'ghost',
          onPress: () => setTab(id),
          accessibilityLabel: `Show ${id}`,
          children: id === 'tracks' ? 'Tracks' : 'Albums',
        }),
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
              empty: h(EmptyState, {
                icon: '📁',
                title: 'No music yet',
                description: 'Add a folder in Settings and it will appear here as it is scanned.',
              }),
              renderItem: (track) =>
                h(TrackRow, {
                  track,
                  showAlbum: true,
                  onPress: () => void ctx.player?.playNow([track.urn]),
                }),
            })
          : h(List<Album>, {
              items: albums.items,
              accessibilityLabel: 'Albums',
              estimatedItemSize: tokens.size.row,
              keyExtractor: (album) => album.urn,
              onEndReached: albums.loadMore,
              empty: h(EmptyState, { icon: '💿', title: 'No albums yet' }),
              renderItem: (album) =>
                h(
                  native.Pressable as never,
                  {
                    accessibilityRole: 'button',
                    accessibilityLabel: album.title,
                    onPress: () => onOpenAlbum?.(album.urn),
                    style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: tokens.space[3],
                      padding: tokens.space[2],
                    },
                  },
                  h(Artwork, { artwork: album.artwork, size: tokens.size.artworkThumb }),
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

export function AlbumScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const native = nativePrimitives()
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
    native.View as never,
    { style: { flex: 1, backgroundColor: p().bg.base } },
    h(
      native.View as never,
      { style: { alignItems: 'center', gap: tokens.space[2], padding: tokens.space[4] } },
      h(Artwork, { artwork: detail.artwork, size: 200, radius: tokens.radius.md }),
      h(Text, { variant: 'xl', numberOfLines: 2, children: detail.title }),
      h(Text, {
        tone: 'muted',
        children: detail.artists?.map((a) => a.name).join(', ') ?? '',
      }),
      h(Button, {
        onPress: () => void ctx.player?.playNow(detail.tracks.map((t) => t.urn)),
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
          onPress: () =>
            void ctx.player?.playNow(
              detail.tracks.map((t) => t.urn),
              { startIndex: index },
            ),
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
export const inject = ['ui']

export async function apply(ctx: Context) {
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.library, LibraryScreen)
    yield ctx.ui.registerView(SOURCES_VIEWS.album, AlbumScreen)
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, ImportScreen)
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceDebug, DebugScreen)
  }, 'sources-ui-mobile')
}

export default { name, inject, apply }
