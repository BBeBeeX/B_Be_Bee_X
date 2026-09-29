import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef, CacheService, Uri } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'

function isLocalUri(uri: string | undefined): boolean {
  return uri === undefined || /^(file|content|data|bbebee-file):/i.test(uri)
}

interface Resolution {
  id: string
  uri?: Uri
  settled: boolean
}

/**
 * Resolves an artwork reference through `ctx.cache` if available,
 * avoiding a duplicate network request when cached locally.
 */
export function useResolvedArtwork(ctx: Context, artwork?: ArtworkRef): ArtworkRef | undefined {
  const [resolution, setResolution] = useState<Resolution | undefined>(undefined)
  const id = artwork?.id
  const sourceUrl = artwork?.sourceUrl

  useEffect(() => {
    if (!id) {
      setResolution(undefined)
      return
    }
    const cache = serviceOf<CacheService>(ctx, 'cache')
    if (!cache) {
      setResolution(undefined)
      return
    }

    let active = true
    setResolution({ id, settled: false })
    void cache.artwork(sourceUrl ? { id, sourceUrl } : { id }).then(
      (uri) => {
        if (active) setResolution({ id, ...(uri ? { uri } : {}), settled: true })
      },
      () => {
        if (active) setResolution({ id, settled: true })
      },
    )
    return () => {
      active = false
    }
  }, [ctx, id, sourceUrl])

  if (!artwork) return undefined
  const cache = serviceOf<CacheService>(ctx, 'cache')
  if (!cache) return artwork

  const current = resolution?.id === id ? resolution : undefined
  if (current?.uri) {
    return current.uri === artwork.sourceUrl ? artwork : { ...artwork, sourceUrl: current.uri }
  }
  if (current?.settled) return artwork
  if (isLocalUri(artwork.sourceUrl)) return artwork
  return { ...artwork, sourceUrl: undefined }
}
