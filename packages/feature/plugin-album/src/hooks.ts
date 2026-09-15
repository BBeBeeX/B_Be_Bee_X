/**
 * View hooks for `plugin-album`.
 *
 * One read, written once for both shells (docs/08 §4). The album's data is a
 * catalogue row, so the read goes to `ctx.sources` — this hook exists so the
 * two view packages cannot grow two different ideas of what "album not found"
 * means.
 */

import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { AlbumDetail } from '@BBeBee/protocol'
import type { AsyncState } from '@BBeBee/ui-core'

/**
 * One album with its tracks. `undefined` data means "no such album".
 *
 * `error` is used for a missing album as well as a failed read, deliberately:
 * a screen has the same thing to say either way — this album cannot be shown —
 * and a distinct empty state for a URN nobody has would be a distinction
 * without a difference.
 */
export function useAlbum(ctx: Context, urn: string | undefined): AsyncState<AlbumDetail> {
  const [state, setState] = useState<AsyncState<AlbumDetail>>({ status: 'idle' })

  useEffect(() => {
    if (!urn) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    ctx.sources
      .getAlbum(urn)
      .then((album) => {
        if (cancelled) return
        setState(
          album
            ? { status: 'ready', data: album }
            : { status: 'error', error: new Error(`no album ${urn}`) },
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })
    return () => void (cancelled = true)
  }, [ctx, urn])

  return state
}
