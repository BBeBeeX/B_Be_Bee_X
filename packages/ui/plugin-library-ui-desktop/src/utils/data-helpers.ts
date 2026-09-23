import type { Context } from 'cordis'
import type { Album, AlbumDetail, Collection, SourcesService, Track } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function formatTotalDuration(tracks: readonly (Track | undefined)[]): string {
  const totalMs = tracks.reduce((sum, t) => sum + (t?.durationMs || 0), 0)
  if (totalMs <= 0) return ''
  const totalSeconds = Math.floor(totalMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  return `${minutes} 分钟 ${seconds} 秒`
}

export function formatAddedDate(timestamp?: number): string {
  if (!timestamp) return '-'
  const now = Date.now()
  const diffMs = Math.max(0, now - timestamp)
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`
  const d = new Date(timestamp)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function formatPlayedDate(timestamp?: number): string {
  if (!timestamp) return '-'
  const now = Date.now()
  const diffMs = Math.max(0, now - timestamp)
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`
  const d = new Date(timestamp)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export async function collectAllFolderTracks(
  ctx: Context,
  collectionId: string,
  allCollections: readonly Collection[] = [],
  albumsMap: Map<string, AlbumDetail> = new Map(),
): Promise<string[]> {
  const visited = new Set<string>()
  const trackUrns = new Set<string>()

  function getDescendants(id: string): string[] {
    const direct = allCollections.filter((c) => c.parentId === id).map((c) => c.id)
    const result: string[] = [...direct]
    for (const d of direct) {
      result.push(...getDescendants(d))
    }
    return result
  }

  const folderIds = [collectionId, ...getDescendants(collectionId)]

  for (const fId of folderIds) {
    if (visited.has(fId)) continue
    visited.add(fId)
    try {
      const page = await ctx.library.listCollectionItems(fId, { limit: 1000 })
      for (const item of page.items ?? []) {
        const parsed = tryParseUrn(item.urn)
        const kind = parsed?.kind
        if (kind === 'track') {
          trackUrns.add(item.urn)
        } else if (kind === 'playlist') {
          try {
            const detail = await ctx.library.getPlaylist(item.urn)
            for (const pi of detail?.items ?? []) {
              trackUrns.add(pi.trackUrn)
            }
          } catch {
            // ignore
          }
        } else if (kind === 'album') {
          try {
            let album = albumsMap.get(item.urn)
            if (!album && ctx.sources?.getAlbum) {
              album = await ctx.sources.getAlbum(item.urn)
            }
            for (const t of album?.tracks ?? []) {
              trackUrns.add(t.urn)
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(trackUrns)
}

export async function fetchAllLocalTracks(sources: SourcesService): Promise<Track[]> {
  const all: Track[] = []
  let cursor: string | undefined
  do {
    const page = await sources.listTracks({
      sourceIds: ['local'],
      page: cursor ? { cursor, limit: 500 } : { limit: 500 },
    })
    all.push(...page.items)
    cursor = page.hasMore && page.cursor ? page.cursor : undefined
  } while (cursor)
  return all
}

export async function fetchAllLocalAlbums(sources: SourcesService): Promise<Album[]> {
  if (!sources.listAlbums) return []
  const all: Album[] = []
  let cursor: string | undefined
  do {
    const page = await sources.listAlbums({
      sourceIds: ['local'],
      page: cursor ? { cursor, limit: 500 } : { limit: 500 },
    })
    all.push(...page.items)
    cursor = page.hasMore && page.cursor ? page.cursor : undefined
  } while (cursor)
  return all
}
