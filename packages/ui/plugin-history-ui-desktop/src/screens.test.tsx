// @vitest-environment jsdom
/**
 * Desktop Play History view tests.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { PlayHistoryHeatmapDay, PlayHistoryStats, PlayRecord, Track, TransportState } from '@BBeBee/protocol'
import { HistoryScreen } from './HistoryScreen.js'
import { PlayHeatmap, getHeatmapLevel, formatPlayDuration } from './PlayHeatmap.js'

afterEach(() => {
  cleanup()
})

const IDLE: TransportState = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  playMode: 'sequence',
}

describe('PlayHeatmap logic', () => {
  it('computes correct heatmap level', () => {
    expect(getHeatmapLevel(0)).toBe(0)
    expect(getHeatmapLevel(1)).toBe(1)
    expect(getHeatmapLevel(2)).toBe(1)
    expect(getHeatmapLevel(4)).toBe(2)
    expect(getHeatmapLevel(8)).toBe(3)
    expect(getHeatmapLevel(15)).toBe(4)
  })

  it('formats play duration correctly', () => {
    expect(formatPlayDuration(0)).toBe('0 分钟')
    expect(formatPlayDuration(30000)).toBe('< 1 分钟')
    expect(formatPlayDuration(180000)).toBe('3 分钟')
    expect(formatPlayDuration(3600000)).toBe('1 小时')
    expect(formatPlayDuration(5400000)).toBe('1 小时 30 分钟')
  })

  it('renders days and handles cell click', () => {
    const days: PlayHistoryHeatmapDay[] = [
      { date: '2026-09-14', count: 0, msPlayed: 0 },
      { date: '2026-09-15', count: 5, msPlayed: 1200000 },
      { date: '2026-09-16', count: 12, msPlayed: 3600000 },
    ]
    const onSelect = vi.fn()
    const { getByTestId } = render(
      h(PlayHeatmap, {
        heatmap: days,
        selectedDate: null,
        onSelectDate: onSelect,
      }),
    )

    const cell = getByTestId('heatmap-cell-2026-09-15')
    expect(cell).toBeTruthy()
    fireEvent.click(cell)
    expect(onSelect).toHaveBeenCalledWith('2026-09-15')
  })
})

async function harness(options: {
  records?: PlayRecord[]
  stats?: PlayHistoryStats
  heatmap?: PlayHistoryHeatmapDay[]
  tracks?: Record<string, Track>
} = {}) {
  const calls: string[] = []
  const records = options.records ?? []
  const stats = options.stats ?? {
    totalPlays: records.length,
    totalMsPlayed: records.reduce((sum, r) => sum + r.msPlayed, 0),
    todayPlays: records.length,
    completedPlays: records.filter((r) => r.completed).length,
  }
  const heatmap = options.heatmap ?? []
  const tracks = options.tracks ?? {}

  class PlayerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return IDLE
    }
    getHistory = async (opts?: { limit?: number; date?: string }) => {
      calls.push(`getHistory:${opts?.date ?? 'all'}`)
      if (opts?.date) {
        return records.filter((r) => {
          const d = new Date(r.startedAt)
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          return iso === opts.date
        })
      }
      return records
    }
    getHistoryStats = async () => stats
    getHistoryHeatmap = async () => heatmap
    clearHistory = async () => {
      calls.push('clearHistory')
    }
    playNow = async (urns: string | string[]) => {
      calls.push(`playNow:${Array.isArray(urns) ? urns.join(',') : urns}`)
    }
  }

  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    getTracks = async (urns: readonly string[]) =>
      urns.map((urn) => tracks[urn]).filter((t): t is Track => t !== undefined)
  }

  const ctx = new Context()
  await ctx.plugin(PlayerStub)
  await ctx.plugin(SourcesStub)

  return { ctx, calls }
}

describe('HistoryScreen', () => {
  it('shows empty state when no history exists', async () => {
    const { ctx } = await harness({ records: [] })
    const { findByText } = render(h(HistoryScreen, { ctx }))
    expect(await findByText('暂无播放记录')).toBeTruthy()
  })

  it('renders stats cards and track records', async () => {
    const now = Date.now()
    const records: PlayRecord[] = [
      {
        id: '1',
        trackUrn: 'BBeBee:local:track:1',
        startedAt: now,
        msPlayed: 180000,
        completed: true,
        skipped: false,
      },
    ]
    const tracks: Record<string, Track> = {
      'BBeBee:local:track:1': {
        urn: 'BBeBee:local:track:1',
        title: 'Song One',
        artists: [{ name: 'Artist A', urn: 'BBeBee:local:artist:1', role: 'main', ordinal: 0 }],
      },
    }

    const { ctx, calls } = await harness({ records, tracks })
    const { findByText } = render(h(HistoryScreen, { ctx }))

    expect(await findByText('播放历史')).toBeTruthy()
    expect(await findByText('总播放次数')).toBeTruthy()
    expect(await findByText('Song One')).toBeTruthy()
    expect(await findByText('完播')).toBeTruthy()

    // Test clicking track to play
    const trackTitle = await findByText('Song One')
    fireEvent.click(trackTitle)
    expect(calls).toContain('playNow:BBeBee:local:track:1')
  })

  it('handles clear history with confirmation', async () => {
    const records: PlayRecord[] = [
      {
        id: '1',
        trackUrn: 'BBeBee:local:track:1',
        startedAt: Date.now(),
        msPlayed: 1000,
        completed: false,
        skipped: true,
      },
    ]
    const { ctx, calls } = await harness({ records })
    const { findByText } = render(h(HistoryScreen, { ctx }))

    const clearBtn = await findByText('清空历史')
    fireEvent.click(clearBtn)

    const confirmBtn = await findByText('确定')
    fireEvent.click(confirmBtn)
    expect(calls).toContain('clearHistory')
  })
})
