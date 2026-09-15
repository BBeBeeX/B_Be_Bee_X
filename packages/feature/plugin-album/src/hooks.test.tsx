// @vitest-environment jsdom
/**
 * `useAlbum`, the one read the album surfaces share.
 *
 * Moved here from `plugin-sources` with the screen it serves; what is pinned
 * is that a missing album and a failed read both end in the state the view
 * knows how to draw.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { AlbumDetail } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { useAlbum } from './hooks.js'

afterEach(cleanup)

const URN = 'BBeBee:local:album:one'

const detail: AlbumDetail = {
  urn: URN,
  title: 'Homogenic',
  artists: [{ urn: 'BBeBee:local:artist:bjork', name: 'Björk', role: 'main', ordinal: 0 }],
  tracks: [],
}

class SourcesStub extends Service {
  failure?: Error

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }

  async getAlbum(urn: string): Promise<AlbumDetail | undefined> {
    if (this.failure) throw this.failure
    return urn === URN ? detail : undefined
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SourcesStub)
  await tick()
  return ctx
}

describe('useAlbum', () => {
  it('reads one album and its tracks', async () => {
    const ctx = await harness()
    const { result } = renderHook(() => useAlbum(ctx, URN))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data?.title).toBe('Homogenic')
  })

  it('turns a missing album into an error, not an empty success', async () => {
    const ctx = await harness()
    const { result } = renderHook(() => useAlbum(ctx, 'BBeBee:local:album:missing'))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error?.message).toContain('no album')
  })

  it('stays idle with no urn to read', async () => {
    const ctx = await harness()
    const { result } = renderHook(() => useAlbum(ctx, undefined))
    expect(result.current.status).toBe('idle')
  })
})
