// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest'
import { createElement as h } from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { TrackInfoModal } from './TrackInfoModal.js'

afterEach(() => {
  cleanup()
})

class DbStub extends Service {
  public data: Record<string, any> = {}

  constructor(ctx: Context) {
    super(ctx, 'db')
  }

  async get(query: string, _params: any[]) {
    if (query.includes('media_bindings')) {
      return this.data['binding']
    }
    if (query.includes('scan_entries')) {
      return this.data['scan']
    }
    return undefined
  }
}

class CodecStub extends Service {
  public meta: any = null

  constructor(ctx: Context) {
    super(ctx, 'codec')
  }

  async readMetadata(_uri: string) {
    return this.meta
  }
}

class PlayerStub extends Service {
  public currentStream: any = null
  public state: any = { durationMs: 180000 }

  constructor(ctx: Context) {
    super(ctx, 'player')
  }
}

const makeArtists = (name: string) => [
  { urn: `BBeBee:local:artist:${name}`, name, role: 'main' as const, ordinal: 0 },
]

describe('TrackInfoModal', () => {
  it('renders nothing when not open or track is null', () => {
    const ctx = new Context()
    const { container, rerender } = render(
      h(TrackInfoModal, { ctx, track: null, open: false, onClose: () => {} }),
    )
    expect(container.firstChild).toBeNull()

    const track: Track = {
      urn: 'BBeBee:local:track:1',
      title: 'Local Track',
      artists: makeArtists('Local Artist'),
    }
    rerender(h(TrackInfoModal, { ctx, track, open: false, onClose: () => {} }))
    expect(container.firstChild).toBeNull()
  })

  it('renders local file info and audio specifications', async () => {
    const ctx = new Context()
    const db = new DbStub(ctx)
    db.data['binding'] = {
      uri: 'file:///Music/Eagles/Hotel%20California.flac',
      format: 'flac',
      codec: 'FLAC',
      bitrate_kbps: 920,
      sample_rate: 44100,
      channels: 2,
      bit_depth: 16,
      size_bytes: 42000000,
    }
    db.data['scan'] = {
      uri: 'file:///Music/Eagles/Hotel%20California.flac',
      size: 42000000,
      mtime: 1700000000000,
    }

    const codec = new CodecStub(ctx)
    codec.meta = {
      tagTypes: ['Vorbis', 'ID3v2.3'],
      sampleRate: 44100,
      channels: 2,
      bitrateKbps: 920,
      codec: 'FLAC',
    }
    new PlayerStub(ctx)

    const track: Track = {
      urn: 'BBeBee:local:track:1',
      title: 'Hotel California',
      artists: makeArtists('Eagles'),
      albumTitle: 'Hotel California',
      durationMs: 391000,
    }

    const { getByText, getAllByText, findByText, queryByText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    expect(await findByText('播放内容详情')).toBeTruthy()
    expect(getAllByText('Hotel California').length).toBe(2)
    expect(getByText('Eagles')).toBeTruthy()
    expect(getByText('本地音乐文件')).toBeTruthy()
    expect(getByText('Hotel California.flac')).toBeTruthy()
    expect(getByText('/Music/Eagles/Hotel California.flac')).toBeTruthy()
    expect(getByText('40.05 MB')).toBeTruthy()
    expect(getByText('6:31')).toBeTruthy()
    expect(getByText('44,100 Hz')).toBeTruthy()
    expect(getByText('2 (立体声 Stereo)')).toBeTruthy()
    expect(getByText('920 kbps')).toBeTruthy()
    expect(getByText('FLAC')).toBeTruthy()
    expect(getByText('Vorbis, ID3v2.3')).toBeTruthy()

    // Third party fields should not be present
    expect(queryByText('第三方源 ID')).toBeNull()
  })

  it('renders third-party source details', async () => {
    const ctx = new Context()
    const player = new PlayerStub(ctx)
    player.currentStream = {
      format: 'm4a',
      sampleRate: 48000,
      channels: 2,
      bitrateKbps: 320,
    }

    const track: Track = {
      urn: 'BBeBee:bilibili:track:BV1xx411c7mD',
      title: 'Bilibili Audio',
      artists: makeArtists('UP Master'),
      durationMs: 125000,
    }

    let closed = false
    const { getByText, findByText, queryByText, getByLabelText } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => { closed = true } }),
    )

    expect(await findByText('播放内容详情')).toBeTruthy()
    expect(getByText('Bilibili Audio')).toBeTruthy()
    expect(getByText('UP Master')).toBeTruthy()
    expect(getByText('第三方网络音乐源')).toBeTruthy()
    expect(getByText('第三方源 ID')).toBeTruthy()
    expect(getByText('bilibili')).toBeTruthy()
    expect(getByText('当前歌曲源 ID')).toBeTruthy()
    expect(getByText('BV1xx411c7mD')).toBeTruthy()
    expect(getByText('48,000 Hz')).toBeTruthy()
    expect(getByText('320 kbps')).toBeTruthy()
    expect(getByText('M4A')).toBeTruthy()

    // Local fields should not be present
    expect(queryByText('文件路径')).toBeNull()

    // Test close button
    const closeBtn = getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(closed).toBe(true)
  })

  it('copies file path when clicking copy button', async () => {
    const ctx = new Context()
    const db = new DbStub(ctx)
    db.data['binding'] = {
      uri: 'file:///Music/test.mp3',
    }
    new PlayerStub(ctx)

    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    const track: Track = {
      urn: 'BBeBee:local:track:1',
      title: 'Test',
      artists: makeArtists('Artist'),
    }

    const { findByTitle } = render(
      h(TrackInfoModal, { ctx, track, open: true, onClose: () => {} }),
    )

    const copyBtn = await findByTitle('复制')
    fireEvent.click(copyBtn)
    expect(writeTextMock).toHaveBeenCalledWith('/Music/test.mp3')
  })
})
