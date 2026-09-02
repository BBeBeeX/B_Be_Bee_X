/**
 * The catalogue cache against a real database.
 *
 * These queries *are* the behaviour — paging, sorting and diacritic folding
 * all happen in SQL — so a fake would test nothing worth knowing.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { tick } from '@BBeBee/kernel/testing'
import type { DbService } from '@BBeBee/protocol'
import plugin, { type Sources } from './index.js'
import { ftsQuery } from './catalog.js'

const INSTANCE = 'local'

async function fixture(): Promise<{ ctx: Context; sources: Sources; db: DbService }> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await mkdtemp(join(tmpdir(), 'bbebee-catalog-')) })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin, {})
  await tick()

  const db = ctx.db
  const now = Date.now()
  await db.exec(
    `INSERT INTO providers (instance_id, plugin_id, display_name, created_at) VALUES (?, ?, ?, ?)`,
    [INSTANCE, '@BBeBee/plugin-source-local', 'This device', now],
  )
  await db.exec(
    `INSERT INTO artworks (id, blurhash, dominant_color, fetched_at) VALUES (?, ?, ?, ?)`,
    ['art1', 'LKO2?U%2Tw=w]~RB', '#3a5f7d', now],
  )
  await db.exec(
    `INSERT INTO artists (urn, instance_id, remote_id, name, sort_name, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`BBeBee:${INSTANCE}:artist:bjork`, INSTANCE, 'bjork', 'Björk', 'Björk', now],
  )
  await db.exec(
    `INSERT INTO artists (urn, instance_id, remote_id, name, sort_name, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`BBeBee:${INSTANCE}:artist:aphex`, INSTANCE, 'aphex', 'Aphex Twin', 'Aphex Twin', now],
  )
  await db.exec(
    `INSERT INTO albums (urn, instance_id, remote_id, title, sort_title, year, artwork_id, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `BBeBee:${INSTANCE}:album:homogenic`,
      INSTANCE,
      'homogenic',
      'Homogenic',
      'Homogenic',
      1997,
      'art1',
      now,
    ],
  )
  await db.exec(
    `INSERT INTO album_artists (album_urn, artist_urn, ordinal) VALUES (?, ?, 0)`,
    [`BBeBee:${INSTANCE}:album:homogenic`, `BBeBee:${INSTANCE}:artist:bjork`],
  )

  const tracks: [string, string, number, string | null, number][] = [
    ['joga', 'Jóga', 1, `BBeBee:${INSTANCE}:album:homogenic`, 302_000],
    ['hunter', 'Hunter', 2, `BBeBee:${INSTANCE}:album:homogenic`, 244_000],
    ['xtal', 'Xtal', 1, null, 293_000],
  ]
  for (const [id, title, trackNo, albumUrn, durationMs] of tracks) {
    await db.exec(
      `INSERT INTO tracks (urn, instance_id, remote_id, title, sort_title, album_urn, track_no,
                           duration_ms, year, artwork_id, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `BBeBee:${INSTANCE}:track:${id}`,
        INSTANCE,
        id,
        title,
        title,
        albumUrn,
        trackNo,
        durationMs,
        1997,
        'art1',
        now,
      ],
    )
    await db.exec(
      `INSERT INTO track_artists (track_urn, artist_urn, role, ordinal) VALUES (?, ?, 'main', 0)`,
      [
        `BBeBee:${INSTANCE}:track:${id}`,
        id === 'xtal'
          ? `BBeBee:${INSTANCE}:artist:aphex`
          : `BBeBee:${INSTANCE}:artist:bjork`,
      ],
    )
  }

  return { ctx, sources: ctx.sources as Sources, db }
}

describe('catalogue reads', () => {
  it('lists tracks with their credits and artwork', async () => {
    const { sources } = await fixture()
    const page = await sources.listTracks()

    expect(page.items.map((t) => t.title)).toEqual(['Hunter', 'Jóga', 'Xtal'])
    expect(page.hasMore).toBe(false)

    const joga = page.items.find((t) => t.title === 'Jóga')!
    expect(joga.artists.map((a) => a.name)).toEqual(['Björk'])
    expect(joga.albumTitle).toBe('Homogenic')
    expect(joga.durationMs).toBe(302_000)
    // Computed once at import, so a list scroll never pays for it.
    expect(joga.artwork?.blurhash).toBe('LKO2?U%2Tw=w]~RB')
    expect(joga.artwork?.dominantColor).toBe('#3a5f7d')
  })

  it('sorts in SQL, in both directions', async () => {
    const { sources } = await fixture()
    expect((await sources.listTracks({ sort: 'duration' })).items.map((t) => t.title)).toEqual([
      'Hunter',
      'Xtal',
      'Jóga',
    ])
    expect(
      (await sources.listTracks({ sort: 'duration', desc: true })).items.map((t) => t.title),
    ).toEqual(['Jóga', 'Xtal', 'Hunter'])
    expect((await sources.listTracks({ sort: 'artist' })).items[0]!.title).toBe('Xtal')
  })

  it('pages with an opaque cursor', async () => {
    const { sources } = await fixture()
    const first = await sources.listTracks({ page: { limit: 2 } })
    expect(first.items).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    expect(first.cursor).toBeDefined()
    // `total` is deliberately absent: counting costs a scan and a progress bar
    // that lies is worse than none.
    expect(first.total).toBeUndefined()

    const second = await sources.listTracks({ page: { limit: 2, cursor: first.cursor } })
    expect(second.items).toHaveLength(1)
    expect(second.hasMore).toBe(false)
    expect(second.items[0]!.title).toBe('Xtal')
  })

  it('falls back to a known sort rather than building invalid SQL', async () => {
    // `sort` arrives from a UI and, later, from a smart-playlist rule tree.
    const { sources } = await fixture()
    const page = await sources.listTracks({ sort: 'nonsense' as never })
    expect(page.items).toHaveLength(3)
  })

  it('filters by provider instance', async () => {
    const { sources } = await fixture()
    expect((await sources.listTracks({ instanceIds: ['local'] })).items).toHaveLength(3)
    expect((await sources.listTracks({ instanceIds: ['navidrome-home'] })).items).toHaveLength(0)
  })

  it('returns an album with its tracks in disc and track order', async () => {
    const { sources } = await fixture()
    const album = await sources.getAlbum(`BBeBee:${INSTANCE}:album:homogenic`)
    expect(album?.title).toBe('Homogenic')
    expect(album?.year).toBe(1997)
    expect(album?.artists.map((a) => a.name)).toEqual(['Björk'])
    expect(album?.tracks.map((t) => t.title)).toEqual(['Jóga', 'Hunter'])
    expect(await sources.getAlbum('BBeBee:local:album:nope')).toBeUndefined()
  })

  it('returns an artist with their albums', async () => {
    const { sources } = await fixture()
    const artist = await sources.getArtist(`BBeBee:${INSTANCE}:artist:bjork`)
    expect(artist?.name).toBe('Björk')
    expect(artist?.albums.map((a) => a.title)).toEqual(['Homogenic'])
  })

  it('counts what is stored', async () => {
    const { sources } = await fixture()
    expect(await sources.counts()).toEqual({ tracks: 3, albums: 1, artists: 2 })
  })
})

describe('the FTS index', () => {
  it('indexes on library/changed and folds diacritics', async () => {
    // The exit criterion from docs/11 §4.6: typing `bjork` must find `Björk`.
    const { ctx, sources } = await fixture()
    ctx.emit('library/changed', 'track', [
      `BBeBee:${INSTANCE}:track:joga`,
      `BBeBee:${INSTANCE}:track:hunter`,
      `BBeBee:${INSTANCE}:track:xtal`,
    ])
    await tick()

    const hits = await sources.searchLocal('bjork')
    expect(hits.tracks?.items.map((t) => t.title).sort()).toEqual(['Hunter', 'Jóga'])

    expect((await sources.searchLocal('homogenic')).tracks?.items).toHaveLength(2)
    expect((await sources.searchLocal('xt')).tracks?.items.map((t) => t.title)).toEqual(['Xtal'])
    expect((await sources.searchLocal('nothing here')).tracks?.items ?? []).toHaveLength(0)
  })

  it('re-indexes a renamed track rather than leaving a stale hit', async () => {
    // A contentless FTS5 table refuses a partial UPDATE, so re-indexing is
    // DELETE + INSERT on the same rowid. Getting that wrong leaves the old
    // title matching forever with no remedy short of a full rebuild.
    const { sources, db } = await fixture()
    const urn = `BBeBee:${INSTANCE}:track:joga`
    await sources.reindex([urn])
    expect((await sources.searchLocal('joga')).tracks?.items).toHaveLength(1)

    await db.exec('UPDATE tracks SET title = ? WHERE urn = ?', ['Bachelorette', urn])
    await sources.reindex([urn])

    expect((await sources.searchLocal('joga')).tracks?.items ?? []).toHaveLength(0)
    expect((await sources.searchLocal('bachelorette')).tracks?.items).toHaveLength(1)

    const mapped = await db.query('SELECT rowid FROM tracks_fts_map WHERE urn = ?', [urn])
    expect(mapped, 'the rowid must be reused, not duplicated').toHaveLength(1)
  })

  it('drops the index entry when the track is gone', async () => {
    const { sources, db } = await fixture()
    const urn = `BBeBee:${INSTANCE}:track:xtal`
    await sources.reindex([urn])
    await db.exec('DELETE FROM tracks WHERE urn = ?', [urn])
    await sources.reindex([urn])

    expect((await sources.searchLocal('xtal')).tracks?.items ?? []).toHaveLength(0)
    expect(await db.query('SELECT rowid FROM tracks_fts_map WHERE urn = ?', [urn])).toHaveLength(0)
  })

  it('treats search text as text, not as FTS5 syntax', async () => {
    // An unquoted FTS5 query throws on the first apostrophe or asterisk a user
    // types into a search box.
    const { sources } = await fixture()
    await sources.reindex([`BBeBee:${INSTANCE}:track:joga`])
    for (const text of ['"', '*', 'AND', 'NEAR(a b)', "it's", '']) {
      await expect(sources.searchLocal(text), text).resolves.toBeDefined()
    }
  })
})

describe('ftsQuery', () => {
  it('makes each word a quoted prefix term', () => {
    expect(ftsQuery('bjork ho')).toBe('"bjork"* AND "ho"*')
    expect(ftsQuery('  spaced   out ')).toBe('"spaced"* AND "out"*')
    expect(ftsQuery('""')).toBeUndefined()
    expect(ftsQuery('')).toBeUndefined()
  })
})
