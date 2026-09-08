/**
 * `plugin-source-local` — the files on this device, as a provider like any
 * other.
 *
 * The local library is deliberately *not* privileged: it goes through the same
 * SPI, the same URN scheme and the same resolve path as a server would. Only
 * `resolveStream` differs, in that it answers `kind: 'local'` immediately —
 * which is also why M3's downloads slot in without the player noticing, since
 * a downloaded track is the same shape with a different `origin`.
 *
 * Its `auth` is the trivial `flow: 'none'` implementation, and it is four
 * lines: precisely the case that proves requiring `auth` of every provider
 * costs nothing (docs/06 §1.1).
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { NotFoundError, ProviderError, parseUrn, tryParseUrn } from '@BBeBee/protocol'
import type {
  AlbumDetail,
  ArtistDetail,
  AuthStatus,
  BrowseEntry,
  Capabilities,
  Disposable,
  MediaProvider,
  PageRequest,
  Paged,
  ProviderAuth,
  SearchQuery,
  SearchResult,
  StreamHandle,
  StreamPrefs,
  Track,
  Uri,
} from '@BBeBee/protocol'

export interface SourceLocalConfig {
  /** The source these tracks belong to. Matches the scanner's. */
  sourceId?: string
  displayName?: string
}

const CAPABILITIES: Capabilities = {
  // Search is answered from the catalogue's FTS index, which is why fullText
  // is true here while nothing here builds an index.
  search: { tracks: true, albums: false, artists: false, playlists: false, fullText: true },
  browse: true,
  lyrics: false,
  artwork: true,
  library: { read: true, save: false, playlistWrite: false, playlistReorder: false },
  streaming: {
    qualities: ['lossless'],
    transcoding: false,
    // A file on disk is always seekable and never expires. Saying so is what
    // lets the UI offer a scrubber without trying it first.
    seekable: true,
    urlExpiry: false,
  },
  regional: false,
}

/**
 * `flow: 'none'` auth.
 *
 * Nothing to sign in to, so `signIn` resolves and `signOut` clears what this
 * source cached. Both are still implemented, because "remove this source and
 * forget everything it stored" has to mean something uniformly (docs/06 §1.1).
 */
class NoAuth implements ProviderAuth {
  readonly flow = { kind: 'none' } as const
  status: AuthStatus = { state: 'authenticated' }
  private readonly listeners = new Set<(s: AuthStatus) => void>()

  constructor(private readonly onSignOut: () => Promise<void>) {}

  async signIn(): Promise<void> {
    this.status = { state: 'authenticated' }
    for (const listener of this.listeners) listener(this.status)
  }

  async signOut(): Promise<void> {
    await this.onSignOut()
    this.status = { state: 'anonymous' }
    for (const listener of this.listeners) listener(this.status)
  }

  onStatusChange(cb: (s: AuthStatus) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

export class SourceLocal extends Service {
  static inject = ['db', 'fs', 'sources']

  private readonly sourceId: string
  private readonly displayName: string
  /** Held rather than re-injected per call — see the note in plugin-player. */
  private scannerCtx?: Context

  constructor(ctx: Context, config: SourceLocalConfig = {}) {
    super(ctx, 'sourceLocal')
    this.sourceId = config.sourceId ?? 'local'
    this.displayName = config.displayName ?? 'This device'
  }

  async [Service.init]() {
    this.ctx.inject(['scanner'], (scoped) => {
      this.scannerCtx = scoped
      return () => void (this.scannerCtx = undefined)
    })

    // Registration is a disposer, so unloading this plugin — or signing out —
    // removes the provider and everything downstream stops seeing it. Wrapped
    // rather than returned directly: a disposer handed back through a service
    // proxy is not the function the fiber collects, and returning it leaves
    // the provider behind (docs/03 §2).
    const off = this.ctx.sources.register(this.provider())

    // One line per source at startup is what makes "my local music is gone"
    // answerable from a log file: either this is here and the provider
    // registered, or it is not and the failure is upstream of the library
    // screen that rendered empty (docs/04 §16).
    this.ctx.logger.info(`source-local: registered '${this.sourceId}' as ${this.displayName}`)
    return () => off()
  }

  /** The provider object handed to `ctx.sources`. */
  provider(): MediaProvider {
    return {
      sourceId: this.sourceId,
      displayName: this.displayName,
      capabilities: CAPABILITIES,
      auth: new NoAuth(() => this.forgetEverything()),

      getTrack: (id) => this.getTrack(id),
      getTracks: (ids) => this.getTracks(ids),
      resolveStream: (id, prefs) => this.resolveStream(id, prefs),
      ping: () => this.ping(),

      search: (query, page) => this.search(query, page),
      browse: (nodeId, page) => this.browse(nodeId, page),
      getAlbum: (id) => this.getAlbum(id),
      getArtist: (id) => this.getArtist(id),
      getArtwork: (ref) => this.getArtwork(ref.id),
    }
  }

  private urn(kind: string, id: string): string {
    return `BBeBee:${this.sourceId}:${kind}:${id}`
  }

  /* ── the required core ─────────────────────────────────────────────── */

  async getTrack(id: string): Promise<Track> {
    // Straight to the row. An earlier version listed the first page of the
    // whole catalogue — credits hydration and all — and only fell back to this
    // when the track was not in it: two queries and a wasted page for every
    // lookup, on the path the player calls per track.
    const track = await this.trackByUrn(this.urn('track', id))
    if (!track) throw new NotFoundError(`no local track ${id}`, this.sourceId)
    return track
  }

  /**
   * Batched, which is the whole reason the SPI has this member: the fallback
   * `ids.map(getTrack)` is N round trips, and a queue restore asks for the
   * whole queue at once.
   */
  async getTracks(ids: string[]): Promise<Track[]> {
    if (ids.length === 0) return []
    const urns = ids.map((id) => this.urn('track', id))
    const byUrn = await this.tracksByUrn(urns)
    return urns.map((urn) => byUrn.get(urn)).filter((t): t is Track => t !== undefined)
  }

  /**
   * The moment a URN becomes bytes — and the only method that differs from a
   * remote provider.
   *
   * `toPlayableUri` is the Android SAF leak made explicit: a user-picked
   * folder is a `content://` tree URI that a decoder cannot open, and this is
   * where it becomes something that can be (docs/04 §1).
   */
  async resolveStream(id: string, _prefs: StreamPrefs): Promise<StreamHandle> {
    const trackUrn = this.urn('track', id)
    const binding = await this.ctx.db.get<{
      uri: string
      format: string | null
      bitrate_kbps: number | null
      sample_rate: number | null
      size_bytes: number | null
    }>(
      `SELECT uri, format, bitrate_kbps, sample_rate, size_bytes
         FROM media_bindings WHERE track_urn = ? ORDER BY created_at DESC LIMIT 1`,
      [trackUrn],
    )
    if (!binding) throw new NotFoundError(`no file for ${trackUrn}`, this.sourceId)

    if (!(await this.ctx.fs.exists(binding.uri))) {
      // The file went while we were not looking. Say so in the taxonomy the
      // player branches on rather than failing at decode time.
      throw new NotFoundError(`file missing for ${trackUrn}`, this.sourceId)
    }

    return {
      kind: 'local',
      target: await this.ctx.fs.toPlayableUri(binding.uri),
      seekable: true,
      quality: 'lossless',
      ...(binding.format ? { codec: binding.format } : {}),
      ...(binding.bitrate_kbps ? { bitrateKbps: binding.bitrate_kbps } : {}),
      ...(binding.sample_rate ? { sampleRate: binding.sample_rate } : {}),
      ...(binding.size_bytes ? { byteLength: binding.size_bytes } : {}),
    }
  }

  /** Cheap by contract: the roots exist and are readable, nothing more. */
  async ping(): Promise<boolean> {
    const roots = this.scannerCtx?.scanner.roots ?? []
    if (roots.length === 0) return true
    for (const root of roots) {
      if (root.enabled && (await this.ctx.fs.exists(root.uri))) return true
    }
    return false
  }

  /* ── the optional surface ──────────────────────────────────────────── */

  /**
   * Answered from the FTS index `ctx.sources` maintains, scoped to this
   * source. One index, two entry points — this and `searchLocal` — rather
   * than two tokeniser configurations that drift apart.
   */
  async search(query: SearchQuery, page?: PageRequest): Promise<SearchResult> {
    return this.ctx.sources.searchLocal(query.text, {
      sourceIds: [this.sourceId],
      ...(page?.limit ? { limit: page.limit } : {}),
    })
  }

  /**
   * The folder tree, which is what a local library's "explore" surface is.
   *
   * Directories come from `ctx.fs`, and a file becomes a leaf only if the
   * scanner has actually imported it — so a folder full of unsupported files
   * browses as empty rather than as tracks that cannot play.
   */
  async browse(nodeId?: string, _page?: PageRequest): Promise<Paged<BrowseEntry>> {
    const roots = this.scannerCtx?.scanner.roots.filter((r) => r.enabled) ?? []

    if (!nodeId) {
      if (roots.length === 1) return this.browseFolder(roots[0]!.uri)
      return {
        items: roots.map((root) => ({
          id: root.uri,
          title: lastSegment(root.uri),
          subtitle: root.uri,
          kind: 'folder' as const,
          leaf: false,
        })),
        hasMore: false,
      }
    }
    return this.browseFolder(nodeId)
  }

  private async browseFolder(uri: Uri): Promise<Paged<BrowseEntry>> {
    let listing
    try {
      listing = await this.ctx.fs.list(uri)
    } catch (error) {
      // Logged as well as thrown: the throw becomes a message on a screen the
      // user may not be looking at, and by the time they report "the folder is
      // empty" the only durable record is this line. Which folder failed is
      // the whole diagnosis — a revoked SAF permission looks exactly like a
      // removed drive from the UI.
      this.ctx.logger.warn(`source-local: cannot read ${uri}: ${String(error)}`)
      throw new ProviderError(`cannot read ${uri}: ${String(error)}`, this.sourceId)
    }

    const items: BrowseEntry[] = []
    const files = listing.filter((entry) => !entry.isDirectory)

    // Two queries for the whole folder rather than two per file. A directory
    // of 300 tracks was 600 round trips.
    const urnByUri = new Map<string, string>()
    if (files.length > 0) {
      const holes = files.map(() => '?').join(', ')
      const rows = await this.ctx.db.query<{ uri: string; track_urn: string | null }>(
        `SELECT uri, track_urn FROM scan_entries
          WHERE status = 'ok' AND track_urn IS NOT NULL AND uri IN (${holes})`,
        files.map((f) => f.uri),
      )
      for (const row of rows) if (row.track_urn) urnByUri.set(row.uri, row.track_urn)
    }
    const tracks = await this.tracksByUrn([...urnByUri.values()])

    for (const entry of listing) {
      if (entry.isDirectory) {
        items.push({ id: entry.uri, title: entry.name, kind: 'folder', leaf: false })
        continue
      }
      const trackUrn = urnByUri.get(entry.uri)
      if (!trackUrn) continue
      const track = tracks.get(trackUrn)
      items.push({
        id: entry.uri,
        title: track?.title ?? entry.name,
        ...(track?.artists[0]?.name ? { subtitle: track.artists[0].name } : {}),
        kind: 'track',
        leaf: true,
        urn: trackUrn,
      })
    }

    items.sort((a, b) =>
      a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'folder' ? -1 : 1,
    )
    return { items, hasMore: false }
  }

  async getAlbum(id: string): Promise<AlbumDetail> {
    const album = await this.ctx.sources.getAlbum(this.urn('album', id))
    if (!album) throw new NotFoundError(`no local album ${id}`, this.sourceId)
    return album
  }

  async getArtist(id: string): Promise<ArtistDetail> {
    const artist = await this.ctx.sources.getArtist(this.urn('artist', id))
    if (!artist) throw new NotFoundError(`no local artist ${id}`, this.sourceId)
    return artist
  }

  /** Artwork is already on disk; the id is the row that knows where. */
  async getArtwork(id: string): Promise<Uri> {
    const row = await this.ctx.db.get<{ local_uri: string | null }>(
      'SELECT local_uri FROM artworks WHERE id = ?',
      [id],
    )
    if (!row?.local_uri) throw new NotFoundError(`no artwork ${id}`, this.sourceId)
    return row.local_uri
  }

  /* ── sign-out ──────────────────────────────────────────────────────── */

  /**
   * "Remove this source and forget everything it stored."
   *
   * There are no credentials, so this is the catalogue rows and the scan
   * bookkeeping — the local equivalent of clearing a cookie jar. The files
   * themselves are the user's and are never touched.
   */
  private async forgetEverything(): Promise<void> {
    const tracks = await this.ctx.db.query<{ urn: string }>(
      'SELECT urn FROM tracks WHERE source_id = ?',
      [this.sourceId],
    )
    await this.ctx.db.transaction(async (tx) => {
      await tx.exec('DELETE FROM scan_entries WHERE track_urn IN (SELECT urn FROM tracks WHERE source_id = ?)', [
        this.sourceId,
      ])
      await tx.exec(
        'DELETE FROM media_bindings WHERE track_urn IN (SELECT urn FROM tracks WHERE source_id = ?)',
        [this.sourceId],
      )
      await tx.exec('DELETE FROM tracks WHERE source_id = ?', [this.sourceId])
      await tx.exec('DELETE FROM albums WHERE source_id = ?', [this.sourceId])
      await tx.exec('DELETE FROM artists WHERE source_id = ?', [this.sourceId])
    })
    if (tracks.length > 0) {
      this.ctx.emit(
        'library/changed',
        'track',
        tracks.map((t) => t.urn),
      )
    }
    await this.ctx.parallel('source/signed-out', this.sourceId)
  }

  private async trackByUrn(urn: string): Promise<Track | undefined> {
    return (await this.tracksByUrn([urn])).get(urn)
  }

  /** Two queries for any number of tracks: the rows, then all their credits. */
  private async tracksByUrn(urns: string[]): Promise<Map<string, Track>> {
    const mine = urns.filter((urn) => tryParseUrn(urn)?.sourceId === this.sourceId)
    const out = new Map<string, Track>()
    if (mine.length === 0) return out

    const holes = mine.map(() => '?').join(', ')
    const rows = await this.ctx.db.query<{
      urn: string
      title: string
      album_urn: string | null
      album_title: string | null
      track_no: number | null
      disc_no: number | null
      duration_ms: number | null
      year: number | null
      available: number
    }>(
      `SELECT t.urn, t.title, t.album_urn, al.title AS album_title, t.track_no, t.disc_no,
              t.duration_ms, t.year, t.available
         FROM tracks t LEFT JOIN albums al ON al.urn = t.album_urn
        WHERE t.urn IN (${holes})`,
      mine,
    )
    if (rows.length === 0) return out

    const credits = await this.ctx.db.query<{
      track_urn: string
      urn: string
      name: string
      ordinal: number
    }>(
      `SELECT ta.track_urn, a.urn, a.name, ta.ordinal FROM track_artists ta
         JOIN artists a ON a.urn = ta.artist_urn
        WHERE ta.track_urn IN (${rows.map(() => '?').join(', ')})
        ORDER BY ta.ordinal`,
      rows.map((r) => r.urn),
    )

    const byTrack = new Map<string, Track['artists']>()
    for (const credit of credits) {
      const list = byTrack.get(credit.track_urn) ?? []
      list.push({ urn: credit.urn, name: credit.name, role: 'main', ordinal: credit.ordinal })
      byTrack.set(credit.track_urn, list)
    }

    for (const row of rows) {
      out.set(row.urn, {
        urn: row.urn,
        title: row.title,
        artists: byTrack.get(row.urn) ?? [],
        ...(row.album_urn ? { albumUrn: row.album_urn } : {}),
        ...(row.album_title ? { albumTitle: row.album_title } : {}),
        ...(row.track_no !== null ? { trackNo: row.track_no } : {}),
        ...(row.disc_no !== null ? { discNo: row.disc_no } : {}),
        ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
        ...(row.year !== null ? { year: row.year } : {}),
        available: row.available === 1,
      })
    }
    return out
  }
}

function lastSegment(uri: string): string {
  const parts = uri.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? uri)
}

declare module 'cordis' {
  interface Context {
    /** The provider itself; consumers reach it through `ctx.sources`. */
    sourceLocal: SourceLocal
  }
}

export const name = 'plugin-source-local'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so a caller could observe `ctx.sources` before this provider has
 * registered itself.
 */
export async function apply(ctx: Context, config: SourceLocalConfig = {}) {
  const fiber = await ctx.plugin(SourceLocal, config)
  return () => void fiber.dispose()
}

export default { name, apply }
export { parseUrn }
