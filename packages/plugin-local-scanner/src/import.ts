/**
 * Turning one file's tags into catalogue rows.
 *
 * Kept apart from the walk so that "what a file becomes" is readable on its
 * own: the walk decides *which* files to look at, this decides what they mean.
 *
 * Everything here writes through the same transaction the batch owns, so a
 * suspend mid-scan costs one batch and never half a track.
 */

import type { AudioMetadata, DbService, SqlValue, Uri } from '@BBeBee/protocol'
import { albumId, artistId, artworkId, trackId } from './ids.js'

export interface ImportContext {
  sourceId: string
  /** Everything in one transaction; the caller owns it. */
  tx: Pick<DbService, 'exec' | 'get' | 'query'>
  now: number
}

export interface ImportInput {
  uri: Uri
  size: number
  mtime: number
  metadata: AudioMetadata
  artwork?: Uint8Array
  /** Where a cached copy of the artwork was written, if it was. */
  artworkUri?: Uri
  format?: string
}

export interface ImportResult {
  trackUrn: string
  albumUrn?: string
}

const urn = (source: string, kind: string, id: string) => `BBeBee:${source}:${kind}:${id}`

/** A sort key that files "The Beatles" under B and drops leading punctuation. */
export function sortKey(value: string | undefined): string | undefined {
  if (!value) return undefined
  const stripped = value.trim().replace(/^["'“”‘’([]+/, '')
  return stripped.replace(/^(the|a|an)\s+/i, '').toLowerCase()
}

/**
 * Split a tag that names several artists, which most taggers write inline.
 *
 * The separators fall into two shapes: punctuation, which needs no
 * surrounding space, and words, which do — `\bfeat\.?\b` does not match
 * "feat. " because the boundary after `.` is not a word boundary, and the
 * leftover "." then rides along on the next name.
 */
export function splitArtists(value: string | undefined): string[] {
  if (!value) return []
  return value
    // `/` only counts as a separator with whitespace around it: AC/DC is one
    // band, "Simon / Garfunkel" is two.
    .split(/\s*[;,]\s*|\s+\/\s+|\s+(?:feat\.?|ft\.?|with)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

export async function importTrack(
  ctx: ImportContext,
  input: ImportInput,
): Promise<ImportResult> {
  const { tx, sourceId, now } = ctx
  const meta = input.metadata

  const title = meta.title?.trim() || fileNameOf(input.uri)
  const artistNames = splitArtists(meta.artist)
  const albumArtist = meta.albumArtist?.trim() || artistNames[0]

  let artworkRef: string | undefined
  if (input.artwork && input.artwork.length > 0) {
    artworkRef = artworkId(input.artwork)
    // Computed once, here, rather than per render: doing it during a list
    // scroll costs a frame (docs/07 §4.2).
    await tx.exec(
      `INSERT INTO artworks (id, local_uri, blurhash, dominant_color, bytes, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET local_uri = COALESCE(excluded.local_uri, artworks.local_uri)`,
      // ⚠️ `blurhash` and `dominant_color` are left NULL. Both need decoded
      // pixels, and `ctx.codec` decodes audio, not images — an image decoder
      // is a platform capability M1 does not have. The columns exist and the
      // UI already treats them as optional (it renders the image directly when
      // there is no placeholder), so this degrades rather than breaks. See
      // docs/11 §4.7.
      [artworkRef, input.artworkUri ?? null, null, null, input.artwork.length, now],
    )
  }

  let albumUrn: string | undefined
  if (meta.album) {
    albumUrn = urn(sourceId, 'album', albumId(meta.album, albumArtist))
    await tx.exec(
      `INSERT INTO albums (urn, source_id, remote_id, title, sort_title, year, track_count,
                           disc_count, artwork_id, is_various, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?)
       ON CONFLICT(urn) DO UPDATE SET
         title      = excluded.title,
         sort_title = excluded.sort_title,
         year       = COALESCE(excluded.year, albums.year),
         artwork_id = COALESCE(excluded.artwork_id, albums.artwork_id),
         fetched_at = excluded.fetched_at`,
      [
        albumUrn,
        sourceId,
        albumId(meta.album, albumArtist),
        meta.album,
        sortKey(meta.album) ?? null,
        meta.year ?? null,
        artworkRef ?? null,
        now,
      ],
    )
  }

  const trackUrn = urn(sourceId, 'track', trackId(input.uri))
  await tx.exec(
    `INSERT INTO tracks (urn, source_id, remote_id, title, sort_title, album_urn, track_no,
                         disc_no, duration_ms, year, replay_gain_track, replay_gain_album,
                         available, artwork_id, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(urn) DO UPDATE SET
       title             = excluded.title,
       sort_title        = excluded.sort_title,
       album_urn         = excluded.album_urn,
       track_no          = excluded.track_no,
       disc_no           = excluded.disc_no,
       duration_ms       = excluded.duration_ms,
       year              = excluded.year,
       replay_gain_track = excluded.replay_gain_track,
       replay_gain_album = excluded.replay_gain_album,
       available         = 1,
       artwork_id        = COALESCE(excluded.artwork_id, tracks.artwork_id),
       fetched_at        = excluded.fetched_at`,
    [
      trackUrn,
      sourceId,
      trackId(input.uri),
      title,
      sortKey(title) ?? null,
      albumUrn ?? null,
      meta.trackNo ?? null,
      meta.discNo ?? null,
      meta.durationMs ?? null,
      meta.year ?? null,
      meta.replayGainTrack ?? null,
      meta.replayGainAlbum ?? null,
      artworkRef ?? null,
      now,
    ],
  )

  // A join with a role, not a string: "Artist feat. Other" as free text makes
  // the featured artist unbrowsable (docs/07 §4.3).
  await tx.exec('DELETE FROM track_artists WHERE track_urn = ?', [trackUrn])
  for (const [ordinal, name] of artistNames.entries()) {
    const id = artistId(name)
    const artistUrn = urn(sourceId, 'artist', id)
    await tx.exec(
      `INSERT INTO artists (urn, source_id, remote_id, name, sort_name, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(urn) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at`,
      [artistUrn, sourceId, id, name, sortKey(name) ?? null, now],
    )
    await tx.exec(
      `INSERT INTO track_artists (track_urn, artist_urn, role, ordinal)
       VALUES (?, ?, 'main', ?)
       ON CONFLICT(track_urn, artist_urn, role) DO UPDATE SET ordinal = excluded.ordinal`,
      [trackUrn, artistUrn, ordinal],
    )
    if (albumUrn && ordinal === 0 && albumArtist) {
      const albumArtistUrn = urn(sourceId, 'artist', artistId(albumArtist))
      await tx.exec(
        `INSERT INTO artists (urn, source_id, remote_id, name, sort_name, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(urn) DO UPDATE SET name = excluded.name`,
        [
          albumArtistUrn,
          sourceId,
          artistId(albumArtist),
          albumArtist,
          sortKey(albumArtist) ?? null,
          now,
        ],
      )
      await tx.exec(
        `INSERT INTO album_artists (album_urn, artist_urn, ordinal) VALUES (?, ?, 0)
         ON CONFLICT(album_urn, artist_urn) DO NOTHING`,
        [albumUrn, albumArtistUrn],
      )
    }
  }

  for (const genre of meta.genre ?? []) {
    const id = genre.trim().toLowerCase()
    if (!id) continue
    await tx.exec(`INSERT INTO genres (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`, [
      id,
      genre.trim(),
    ])
    await tx.exec(
      `INSERT INTO track_genres (track_urn, genre_id) VALUES (?, ?)
       ON CONFLICT(track_urn, genre_id) DO NOTHING`,
      [trackUrn, id],
    )
  }

  if (meta.isrc || meta.musicbrainzTrackId) {
    for (const [namespace, value] of [
      ['isrc', meta.isrc],
      ['mbid', meta.musicbrainzTrackId],
    ] as const) {
      if (!value) continue
      // What M2's identity linking joins on. Cheap to record now, expensive to
      // backfill later.
      await tx.exec(
        `INSERT INTO external_ids (urn, namespace, value) VALUES (?, ?, ?)
         ON CONFLICT(urn, namespace, value) DO NOTHING`,
        [trackUrn, namespace, value],
      )
    }
  }

  // The binding *is* what "this track is a file on disk" means. The download
  // plugin writes the same shape at M3 with origin 'download', which is why
  // the player needs no concept of either (docs/07 §4.5).
  await tx.exec(
    `INSERT INTO media_bindings (id, track_urn, uri, format, bitrate_kbps, sample_rate, channels,
                                 bit_depth, size_bytes, origin, verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scan', ?, ?)
     ON CONFLICT(uri) DO UPDATE SET
       track_urn    = excluded.track_urn,
       format       = excluded.format,
       bitrate_kbps = excluded.bitrate_kbps,
       sample_rate  = excluded.sample_rate,
       channels     = excluded.channels,
       bit_depth    = excluded.bit_depth,
       size_bytes   = excluded.size_bytes,
       verified_at  = excluded.verified_at`,
    [
      `b_${trackId(input.uri)}`,
      trackUrn,
      input.uri,
      input.format ?? meta.codec ?? null,
      meta.bitrateKbps ?? null,
      meta.sampleRate ?? null,
      meta.channels ?? null,
      meta.bitDepth ?? null,
      input.size,
      now,
      now,
    ],
  )

  return { trackUrn, ...(albumUrn ? { albumUrn } : {}) }
}

/**
 * Remove a file's rows.
 *
 * A binding whose file is missing is deleted rather than left to fail at play
 * time, and a local track with no binding left is deleted too — for instance
 * `local`, the file *is* the track (docs/07 §4.5).
 */
export async function forgetFile(
  ctx: ImportContext,
  uri: Uri,
): Promise<{ removedTrackUrn?: string }> {
  const { tx } = ctx
  const binding = await tx.get<{ id: string; track_urn: string }>(
    'SELECT id, track_urn FROM media_bindings WHERE uri = ?',
    [uri],
  )
  await tx.exec('DELETE FROM media_bindings WHERE uri = ?', [uri])
  if (!binding) return {}

  const remaining = await tx.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM media_bindings WHERE track_urn = ?',
    [binding.track_urn],
  )
  if ((remaining?.n ?? 0) > 0) return {}

  await tx.exec('DELETE FROM tracks WHERE urn = ?', [binding.track_urn])
  return { removedTrackUrn: binding.track_urn }
}

function fileNameOf(uri: string): string {
  const last = uri.split('/').pop() ?? uri
  return decodeURIComponent(last.replace(/\.[^.]+$/, ''))
}

export type { SqlValue }
