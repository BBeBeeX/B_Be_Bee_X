// @vitest-environment jsdom
/**
 * The desktop album screen, rendered and pressed.
 *
 * What is pinned is the playback contract the screen exists to express:
 * "Play album" replaces the queue outright, a row tap carries the whole album
 * as its context, a download button reaches the queue, and a missing album is
 * said out loud rather than shown as an empty page.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { AlbumDetail, DownloadTask } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { AlbumScreen } from './index.js'

afterEach(cleanup)

const ALBUM_URN = 'BBeBee:remote:album:one'
const TRACK_A = 'BBeBee:remote:track:a'
const TRACK_B = 'BBeBee:remote:track:b'

const detail: AlbumDetail = {
  urn: ALBUM_URN,
  title: 'Homogenic',
  artists: [{ urn: 'BBeBee:remote:artist:bjork', name: 'Björk', role: 'main', ordinal: 0 }],
  tracks: [
    { urn: TRACK_A, title: 'Hunter', artists: [] },
    { urn: TRACK_B, title: 'Jóga', artists: [] },
  ],
}

class SourcesStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getAlbum(urn: string): Promise<AlbumDetail | undefined> {
    return urn === ALBUM_URN ? detail : undefined
  }
}

class PlayerStub extends Service {
  readonly calls: { method: string; urn?: string; urns?: readonly string[]; context?: unknown }[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  async playNow(urns: string[]): Promise<void> {
    this.calls.push({ method: 'playNow', urns })
  }
  async playFromContext(
    urn: string,
    urns?: readonly string[],
    opts?: { context?: unknown },
  ): Promise<void> {
    this.calls.push({ method: 'playFromContext', urn, urns, context: opts?.context })
  }
}

class DownloadsStub extends Service {
  readonly queued: string[][] = []
  constructor(ctx: Context) {
    super(ctx, 'downloads')
  }
  async enqueue(urns: string[]): Promise<DownloadTask[]> {
    this.queued.push(urns)
    return []
  }
}

class UiStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  navigate(): void {}
}

async function harness() {
  const root = new Context()
  await root.plugin(SourcesStub)
  await root.plugin(PlayerStub)
  await root.plugin(DownloadsStub)
  await root.plugin(UiStub)
  let scoped: Context | undefined
  root.inject(['ui', 'sources', 'player', 'downloads'], (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('no scoped context')
  return {
    ctx: scoped,
    player: root.player as unknown as PlayerStub,
    downloads: root.downloads as unknown as DownloadsStub,
  }
}

describe('AlbumScreen', () => {
  it('draws the album and plays it from the top', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      expect(getByText('Homogenic')).toBeTruthy()
      await act(async () => {
        getByText('Play album').click()
        await tick()
      })
    })

    expect(player.calls).toEqual([{ method: 'playNow', urns: [TRACK_A, TRACK_B] }])
  })

  it('plays a tapped row with the whole album as its context', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })
      await act(async () => {
        getByText('Jóga').click()
        await tick()
      })
    })

    expect(player.calls).toEqual([
      {
        method: 'playFromContext',
        urn: TRACK_B,
        urns: [TRACK_A, TRACK_B],
        context: { kind: 'album', urn: ALBUM_URN, label: 'Homogenic' },
      },
    ])
  })

  it('queues a download from a row without touching playback', async () => {
    const { ctx, player, downloads } = await harness()
    await withListLayout(async () => {
      const { getAllByLabelText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })
      await act(async () => {
        getAllByLabelText('Download')[0]!.click()
        await tick()
      })
    })

    expect(downloads.queued).toEqual([[TRACK_A]])
    expect(player.calls).toEqual([])
  })

  it('says an album is unavailable rather than drawing an empty one', async () => {
    const { ctx } = await harness()
    const { container } = render(h(AlbumScreen, { ctx, urn: 'BBeBee:local:album:missing' }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Album unavailable')
    expect(container.textContent).toContain('no album')
  })

  it('supports sorting tracks by clicking headers', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByTestId, getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      // Clicking '#' toggles trackNo to desc
      await act(async () => {
        getByTestId('album-sort-trackNo').click()
        await tick()
      })

      // Now "Play album" should play in reversed order [TRACK_B, TRACK_A]
      await act(async () => {
        getByText('Play album').click()
        await tick()
      })
    })

    expect(player.calls).toEqual([{ method: 'playNow', urns: [TRACK_B, TRACK_A] }])
  })

  it('supports sorting tracks via sort menu trigger', async () => {
    const { ctx, player } = await harness()
    await withListLayout(async () => {
      const { getByTestId, getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
      await act(async () => {
        await tick()
      })

      // Click sort trigger to open ContextMenu
      await act(async () => {
        getByTestId('album-sort-trigger').click()
        await tick()
      })

      // Click "降序" in the menu
      await act(async () => {
        getByText('降序').click()
        await tick()
      })

      // Play Jóga row, context should be [TRACK_B, TRACK_A]
      await act(async () => {
        getByText('Jóga').click()
        await tick()
      })
    })

    expect(player.calls).toEqual([
      {
        method: 'playFromContext',
        urn: TRACK_B,
        urns: [TRACK_B, TRACK_A],
        context: { kind: 'album', urn: ALBUM_URN, label: 'Homogenic' },
      },
    ])
  })
})
