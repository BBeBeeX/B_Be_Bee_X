import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  HttpService,
  JsService,
  Lyrics,
  LyricSearchQuery,
  LyricSourceDefinition,
  LyricSourcesService,
  LyricSourceTestResult,
  StoreService,
} from '@BBeBee/protocol'
import { executeLyricSource } from './sandbox.js'
import { normalizeToLyrics } from './normalizer.js'

export * from './sandbox.js'
export * from './normalizer.js'

export const STORE_LYRIC_SOURCES_KEY = 'lyric-sources.custom-sources'

/**
 * Built-in open-source LRCLIB provider
 */
export const BUILTIN_LRCLIB_SOURCE: LyricSourceDefinition = {
  id: 'builtin-lrclib',
  name: 'LRCLIB (默认歌词源)',
  description: '基于公开开放的 LRCLIB 歌词数据库，支持全球海量百万同步 LRC 歌词搜索',
  version: '1.1.0',
  author: 'LRCLIB Community / BBeBee',
  enabled: true,
  sortOrder: 0,
  allowedHosts: ['lrclib.net'],
  script: `
async function searchLyrics(query) {
  const { title, artist, duration } = query;
  if (!title || typeof title !== 'string') return null;

  const trimmedTitle = title.trim();
  const trimmedArtist = (artist || '').trim();
  const durationSec = duration && duration > 0 ? Math.round(duration / 1000) : 0;

  const headers = {
    'User-Agent': 'BBeBee-MusicPlayer/1.0.0 (https://github.com/BBeBee)',
    'Lrclib-Client': 'BBeBee-MusicPlayer/1.0.0',
  };

  async function parseBody(res) {
    if (!res) return null;
    try {
      if (typeof res.json === 'function') return await res.json();
      if (typeof res.body === 'string' && res.body) return JSON.parse(res.body);
    } catch (_) {}
    return null;
  }

  // 1. Try exact match get endpoint
  if (trimmedTitle && trimmedArtist) {
    try {
      const getParams = new URLSearchParams({
        track_name: trimmedTitle,
        artist_name: trimmedArtist,
      });
      if (durationSec > 0) {
        getParams.set('duration', String(durationSec));
      }

      const res = await httpFetch('https://lrclib.net/api/get?' + getParams.toString(), {
        headers,
      });

      if (res && res.status === 200) {
        const data = await parseBody(res);
        if (data) {
          if (data.syncedLyrics && data.syncedLyrics.trim()) {
            return data.syncedLyrics;
          }
          if (data.plainLyrics && data.plainLyrics.trim()) {
            return data.plainLyrics;
          }
          if (data.instrumental) {
            return '[00:00.00]纯音乐，请欣赏';
          }
        }
      }
    } catch (_) {
      // Continue to search endpoint on failure
    }
  }

  // 2. Try keyword search endpoint
  try {
    const searchUrl = 'https://lrclib.net/api/search?' + new URLSearchParams({
      q: trimmedArtist ? (trimmedArtist + ' ' + trimmedTitle) : trimmedTitle,
    }).toString();

    const res = await httpFetch(searchUrl, { headers });
    if (res && res.status === 200) {
      const list = await parseBody(res);
      if (Array.isArray(list) && list.length > 0) {
        let match = null;

        if (durationSec > 0) {
          match = list.find((it) => it && it.syncedLyrics && Math.abs((it.duration || 0) - durationSec) <= 3);
          if (!match) {
            match = list.find((it) => it && it.syncedLyrics && Math.abs((it.duration || 0) - durationSec) <= 6);
          }
          if (!match) {
            match = list.find((it) => it && it.plainLyrics && Math.abs((it.duration || 0) - durationSec) <= 4);
          }
        }

        if (!match) {
          match = list.find((it) => it && it.syncedLyrics);
        }
        if (!match) {
          match = list.find((it) => it && it.plainLyrics);
        }

        if (match) {
          if (match.syncedLyrics && match.syncedLyrics.trim()) {
            return match.syncedLyrics;
          }
          if (match.plainLyrics && match.plainLyrics.trim()) {
            return match.plainLyrics;
          }
          if (match.instrumental) {
            return '[00:00.00]纯音乐，请欣赏';
          }
        }
      }
    }
  } catch (_) {
    return null;
  }

  return null;
}
`,
}

export class LyricSourcesPlugin extends Service implements LyricSourcesService {
  static override readonly name = 'lyricSources'

  private readonly ownCtx: Context
  private sources: LyricSourceDefinition[] = [BUILTIN_LRCLIB_SOURCE]
  private storeService?: StoreService
  private jsService?: JsService
  private httpService?: HttpService
  private loaded = false

  constructor(ctx: Context) {
    super(ctx, 'lyricSources')
    this.ownCtx = ctx

    // Optional injection of store
    this.ownCtx.inject(['store'], (scoped: Context) => {
      this.storeService = scoped.store
      void this.loadSourcesFromStore()
      return () => {
        this.storeService = undefined
      }
    })

    // Optional injection of js sandbox
    this.ownCtx.inject(['js'], (scoped: Context) => {
      this.jsService = scoped.js
      return () => {
        this.jsService = undefined
      }
    })

    // Optional injection of http
    this.ownCtx.inject(['http'], (scoped: Context) => {
      this.httpService = scoped.http
      return () => {
        this.httpService = undefined
      }
    })
  }

  async [Service.init](): Promise<void> {
    await this.loadSourcesFromStore()
  }

  private async loadSourcesFromStore(): Promise<void> {
    if (!this.storeService || this.loaded) return
    try {
      const saved = await this.storeService.get<LyricSourceDefinition[]>(STORE_LYRIC_SOURCES_KEY)
      if (Array.isArray(saved) && saved.length > 0) {
        // Merge or replace; ensure builtin exists if not explicitly removed
        const hasBuiltin = saved.some((s) => s.id === BUILTIN_LRCLIB_SOURCE.id)
        this.sources = hasBuiltin ? saved : [BUILTIN_LRCLIB_SOURCE, ...saved]
      } else {
        this.sources = [BUILTIN_LRCLIB_SOURCE]
      }
      this.loaded = true
      this.emitChanged()
    } catch (e) {
      this.ownCtx.logger.warn(`lyricSources: failed to load from store: ${String(e)}`)
    }
  }

  private async persistSources(): Promise<void> {
    if (this.storeService) {
      try {
        await this.storeService.set(STORE_LYRIC_SOURCES_KEY, this.sources)
      } catch (e) {
        this.ownCtx.logger.warn(`lyricSources: failed to persist to store: ${String(e)}`)
      }
    }
    this.emitChanged()
  }

  private emitChanged(): void {
    const list = this.getSourcesSnapshot()
    this.ownCtx.emit('lyric-sources/changed', list)
  }

  private getSourcesSnapshot(): readonly LyricSourceDefinition[] {
    return [...this.sources].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  getSources(): readonly LyricSourceDefinition[] {
    return this.getSourcesSnapshot()
  }

  getSource(id: string): LyricSourceDefinition | undefined {
    return this.sources.find((s) => s.id === id)
  }

  async registerSource(source: LyricSourceDefinition): Promise<void> {
    if (!source.id || !source.name || !source.script) {
      throw new Error('Lyric source must contain id, name, and script')
    }

    const index = this.sources.findIndex((s) => s.id === source.id)
    if (index >= 0) {
      this.sources[index] = { ...source }
    } else {
      const maxOrder = this.sources.reduce((max, s) => Math.max(max, s.sortOrder), -1)
      this.sources.push({
        ...source,
        sortOrder: source.sortOrder ?? maxOrder + 1,
      })
    }

    await this.persistSources()
    this.ownCtx.logger.info(`lyricSources: registered source "${source.id}" (${source.name})`)
  }

  async removeSource(id: string): Promise<boolean> {
    const prevLen = this.sources.length
    this.sources = this.sources.filter((s) => s.id !== id)
    if (this.sources.length !== prevLen) {
      await this.persistSources()
      this.ownCtx.logger.info(`lyricSources: removed source "${id}"`)
      return true
    }
    return false
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const src = this.sources.find((s) => s.id === id)
    if (src) {
      src.enabled = enabled
      await this.persistSources()
      this.ownCtx.logger.info(`lyricSources: source "${id}" enabled=${enabled}`)
    }
  }

  async reorder(sourceIds: string[]): Promise<void> {
    const orderMap = new Map<string, number>()
    sourceIds.forEach((id, index) => orderMap.set(id, index))

    for (const src of this.sources) {
      if (orderMap.has(src.id)) {
        src.sortOrder = orderMap.get(src.id)!
      }
    }

    this.sources.sort((a, b) => a.sortOrder - b.sortOrder)
    await this.persistSources()
    this.ownCtx.logger.info(`lyricSources: reordered sources (${sourceIds.join(', ')})`)
  }

  async searchLyrics(query: LyricSearchQuery): Promise<Lyrics | undefined> {
    const enabledSources = this.sources
      .filter((s) => s.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    for (const source of enabledSources) {
      try {
        const raw = await executeLyricSource(source, query, {
          js: this.jsService,
          http: this.httpService,
        })
        const lyrics = normalizeToLyrics(raw)
        if (lyrics && lyrics.content.trim()) {
          this.ownCtx.logger.info(
            `lyricSources: found lyrics for "${query.title}" via source "${source.id}"`,
          )
          return lyrics
        }
      } catch (err) {
        this.ownCtx.logger.debug(
          `lyricSources: source "${source.id}" failed for "${query.title}": ${String(err)}`,
        )
      }
    }

    return undefined
  }

  async testSource(id: string, query: LyricSearchQuery): Promise<LyricSourceTestResult> {
    const source = this.sources.find((s) => s.id === id)
    if (!source) {
      return {
        ok: false,
        durationMs: 0,
        error: `Lyric source "${id}" not found`,
      }
    }

    const start = Date.now()
    try {
      const raw = await executeLyricSource(source, query, {
        js: this.jsService,
        http: this.httpService,
      })
      const durationMs = Date.now() - start
      const lyrics = normalizeToLyrics(raw)

      if (lyrics && lyrics.content.trim()) {
        return {
          ok: true,
          durationMs,
          lyrics,
        }
      }

      return {
        ok: false,
        durationMs,
        error: 'Lyric source executed successfully but returned empty or unrecognized lyrics format',
      }
    } catch (err) {
      const durationMs = Date.now() - start
      return {
        ok: false,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

export const name = 'plugin-lyric-sources'

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-lyric-sources: loaded')
  await ctx.plugin(LyricSourcesPlugin)
}

export default LyricSourcesPlugin

