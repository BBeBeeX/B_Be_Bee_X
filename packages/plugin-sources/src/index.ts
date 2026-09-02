/**
 * `ctx.sources` — the provider registry.
 *
 * One responsibility: **which music backends exist, and what they hold.**
 * Registration, lookup by instance or URN, the search fan-out, and — landing
 * with the first real provider — the catalogue cache those answers are stored
 * in (docs/06 §1). Playlists, favourites and collections belong to
 * `ctx.library`; transport, queue and history belong to `ctx.player`.
 *
 * What is here today is the registry half, and it is deliberately dumb: it
 * stores, resolves, and asks. Every decision about what a provider *can* do
 * lives in that provider's `capabilities`, and every decision about what to
 * show lives in a shell.
 *
 * See docs/06-music-sources.md §2 and docs/11-roadmap-M1.md §4.6.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
// Pulls the service and event augmentations (`ctx.sources`, `source/*`) into
// this program. Without it a consumer compiling in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import { ProviderError, SourceError, tryParseUrn } from '@BBeBee/protocol'
import type {
  AggregatedSearch,
  AggregatedSearchEntry,
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  CatalogCounts,
  CatalogQuery,
  Disposable,
  MediaProvider,
  Paged,
  SearchQuery,
  SearchResult,
  SourcesService,
  Track,
} from '@BBeBee/protocol'
import { Catalog } from './catalog.js'

export interface SourcesConfig {
  /**
   * How long `searchAll` waits for a provider before reporting it as pending.
   *
   * A slow backend must not hold the whole result set: the search returns what
   * it has and says which providers are still running (docs/06 §2).
   */
  searchTimeoutMs?: number
}

const DEFAULT_SEARCH_TIMEOUT_MS = 10_000

/** Whether a provider can answer a search at all — method *and* declaration. */
function canSearch(provider: MediaProvider): boolean {
  if (typeof provider.search !== 'function') return false
  const { search } = provider.capabilities
  return search.tracks || search.albums || search.artists || search.playlists
}

/**
 * Map anything a provider throws onto the taxonomy.
 *
 * Providers are supposed to do this themselves (docs/06 §6), but the registry
 * is the boundary where a misbehaving one would otherwise take down a whole
 * fan-out, so it fails soft and attributes the error to its instance.
 */
function asSourceError(error: unknown, instanceId: string): SourceError {
  if (error instanceof SourceError) return error
  return new ProviderError(
    error instanceof Error ? error.message : String(error),
    instanceId,
    { cause: error },
  )
}

export class Sources extends Service implements SourcesService {
  // The catalogue cache is half of what this service is (docs/11 MD-3), and
  // it is stored in SQL.
  static inject = ['db']

  /** Insertion-ordered, which is the order `searchAll` reports in. */
  private readonly registry = new Map<string, MediaProvider>()
  private catalog!: Catalog

  constructor(
    ctx: Context,
    private readonly config: SourcesConfig = {},
  ) {
    super(ctx, 'sources')
  }

  async [Service.init]() {
    this.catalog = new Catalog(this.ctx.db)

    // Any provider's rows get indexed without the writer knowing an index
    // exists — the scanner emits this, and so will M2's caching path.
    return this.ctx.on('library/changed', (kind, urns) => {
      if (kind !== 'track') return
      void this.catalog.index(urns).catch((error: unknown) => {
        this.ctx.logger.warn(`sources: could not index ${urns.length} track(s): ${String(error)}`)
      })
    })
  }

  /**
   * Register a provider instance.
   *
   * Returns a disposer, so a provider plugin that unloads — or a user who
   * signs out — takes its registration with it and everything downstream
   * simply stops seeing it. No invalidation protocol, no stale rows.
   */
  register(provider: MediaProvider): Disposable {
    const { instanceId } = provider
    if (!instanceId) throw new Error('sources: a provider must have an instanceId')

    if (this.registry.has(instanceId)) {
      // Two providers claiming one instance id would make URNs ambiguous —
      // the one thing the URN scheme exists to prevent (docs/07 §1).
      this.ctx.logger.warn(
        `sources: instance "${instanceId}" is already registered; ignoring the duplicate`,
      )
      return () => {}
    }

    this.registry.set(instanceId, provider)
    this.ctx.emit('source/registered', instanceId)

    return () => {
      // Identity-checked so a late disposer cannot unregister its replacement.
      if (this.registry.get(instanceId) !== provider) return
      this.registry.delete(instanceId)
      this.ctx.emit('source/unregistered', instanceId)
    }
  }

  get providers(): readonly MediaProvider[] {
    return [...this.registry.values()]
  }

  get(instanceId: string): MediaProvider | undefined {
    return this.registry.get(instanceId)
  }

  /**
   * Resolve a URN to the provider that owns it.
   *
   * Keyed on the URN's *instance*, not its plugin: two Navidrome servers are
   * two providers, and a row from one must never resolve to the other.
   */
  forUrn(urn: string): MediaProvider | undefined {
    const parsed = tryParseUrn(urn)
    return parsed && this.registry.get(parsed.instanceId)
  }

  /**
   * Fan out across every provider that supports search.
   *
   * Returns per-provider results *and* per-provider errors. It never rejects
   * and never merges into one list, because a merged list silently drops a
   * failing backend and the UI then cannot say "Navidrome: 12 results ·
   * Jellyfin: unreachable" — which is the honest thing to show (docs/06 §2).
   */
  async searchAll(
    query: SearchQuery,
    opts: { instanceIds?: string[]; timeoutMs?: number } = {},
  ): Promise<AggregatedSearch> {
    const timeoutMs = opts.timeoutMs ?? this.config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
    const wanted = opts.instanceIds && new Set(opts.instanceIds)

    const asked = this.providers.filter(
      (p) => (!wanted || wanted.has(p.instanceId)) && canSearch(p),
    )

    const byProvider = await Promise.all(
      asked.map((provider) => this.searchOne(provider, query, timeoutMs)),
    )
    return { byProvider }
  }

  private async searchOne(
    provider: MediaProvider,
    query: SearchQuery,
    timeoutMs: number,
  ): Promise<AggregatedSearchEntry> {
    const { instanceId } = provider
    const startedAt = Date.now()

    // `search` is optional on the SPI; `canSearch` established it is here.
    const inFlight = Promise.resolve(provider.search!(query)).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error: asSourceError(error, instanceId) }),
    )

    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<{ ok: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: 'timeout' }), timeoutMs)
    })

    try {
      const outcome = await Promise.race([inFlight, timedOut])
      const tookMs = Date.now() - startedAt

      // A provider that ran long is reported as still running, not cancelled:
      // cancelling it would throw away a result the user may still want, and
      // the SPI has no cancellation channel to do it politely.
      if (outcome.ok === 'timeout') return { instanceId, pending: true, tookMs }
      if (outcome.ok) return { instanceId, result: outcome.result, pending: false, tookMs }
      return { instanceId, error: outcome.error, pending: false, tookMs }
    } finally {
      clearTimeout(timer)
    }
  }

  /* ── the catalogue cache ───────────────────────────────────────────── */

  listTracks(query?: CatalogQuery): Promise<Paged<Track>> {
    return this.catalog.listTracks(query)
  }

  listAlbums(query?: CatalogQuery): Promise<Paged<Album>> {
    return this.catalog.listAlbums(query)
  }

  listArtists(query?: CatalogQuery): Promise<Paged<Artist>> {
    return this.catalog.listArtists(query)
  }

  getAlbum(urn: string): Promise<AlbumDetail | undefined> {
    return this.catalog.getAlbum(urn)
  }

  getArtist(urn: string): Promise<ArtistDetail | undefined> {
    return this.catalog.getArtist(urn)
  }

  searchLocal(
    text: string,
    opts?: { limit?: number; instanceIds?: string[] },
  ): Promise<SearchResult> {
    return this.catalog.searchLocal(text, opts)
  }

  counts(): Promise<CatalogCounts> {
    return this.catalog.counts()
  }

  /** Re-index tracks directly. `library/changed` is the usual route. */
  reindex(urns: string[]): Promise<void> {
    return this.catalog.index(urns)
  }
}

export { Catalog } from './catalog.js'

export const name = 'plugin-sources'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.sources` is usable.
 */
export async function apply(ctx: Context, config: SourcesConfig = {}) {
  const fiber = await ctx.plugin(Sources, config)
  return () => void fiber.dispose()
}

export default { name, apply }
