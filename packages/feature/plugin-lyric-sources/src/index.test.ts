import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import {
  formatLrcTimestamp,
  normalizeToLyrics,
} from './normalizer.js'
import { checkAllowedHost, executeLyricSource } from './sandbox.js'
import { LyricSourcesPlugin } from './index.js'
import type { LyricSourceDefinition } from '@BBeBee/protocol'

describe('Lyrics Normalizer', () => {
  it('formats milliseconds into standard LRC timestamp', () => {
    expect(formatLrcTimestamp(0)).toBe('[00:00.00]')
    expect(formatLrcTimestamp(65430)).toBe('[01:05.43]')
    expect(formatLrcTimestamp(125890)).toBe('[02:05.89]')
  })

  it('normalizes standard LRC string', () => {
    const raw = `[00:10.50]Hello world\n[00:15.00]Second line`
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toContain('[00:10.50]Hello world')
  })

  it('normalizes LRCLIB JSON structure', () => {
    const raw = {
      id: 123,
      trackName: 'Test Song',
      syncedLyrics: `[00:05.00]Synced test\n[00:10.00]Another line`,
      plainLyrics: 'Synced test\nAnother line',
    }
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toBe(raw.syncedLyrics)
  })

  it('normalizes Netease dual-lyric structure with translations', () => {
    const raw = {
      lrc: { lyric: `[00:01.00]Hello\n[00:05.00]World` },
      tlyric: { lyric: `[00:01.00]你好\n[00:05.00]世界` },
    }
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toContain('[00:01.00]Hello')
    expect(lyrics?.content).toContain('[00:01.00]你好')
    expect(lyrics?.content).toContain('[00:05.00]World')
    expect(lyrics?.content).toContain('[00:05.00]世界')
  })

  it('normalizes line arrays with millisecond timestamps', () => {
    const raw = [
      { timeMs: 12000, text: 'First line' },
      { timeMs: 18500, text: 'Second line', translation: '第二行' },
    ]
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('lrc')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.content).toContain('[00:12.00]First line')
    expect(lyrics?.content).toContain('[00:18.50]Second line')
    expect(lyrics?.content).toContain('[00:18.50]第二行')
  })

  it('handles TTML markup', () => {
    const raw = `<?xml version="1.0" encoding="utf-8"?><tt><body><div><p begin="00:01.00">Lyric</p></div></body></tt>`
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('ttml')
    expect(lyrics?.synced).toBe(true)
  })

  it('handles plain text lyrics without timestamps', () => {
    const raw = `Just some plain lyrics\nNo timestamps here\nEnjoy the song`
    const lyrics = normalizeToLyrics(raw)
    expect(lyrics).toBeDefined()
    expect(lyrics?.format).toBe('plain')
    expect(lyrics?.synced).toBe(false)
  })
})

describe('Sandbox & Security Boundaries', () => {
  it('strictly passes ONLY title, artist, and duration to the script', async () => {
    const source: LyricSourceDefinition = {
      id: 'test-sandbox-props',
      name: 'Sandbox Test',
      enabled: true,
      sortOrder: 0,
      script: `
        async function searchLyrics(query) {
          // Check that only title, artist, and duration are accessible
          const keys = Object.keys(query).sort();
          return JSON.stringify({
            keys,
            title: query.title,
            artist: query.artist,
            duration: query.duration,
            extra: query.sensitiveToken,
          });
        }
      `,
    }

    // Pass extra sensitive fields that must NOT leak
    const leakAttempt: any = {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      duration: 354000,
      sensitiveToken: 'secret_token_123',
      filePath: '/etc/passwd',
      urn: 'BBeBee:track:123',
    }

    const raw = await executeLyricSource(source, leakAttempt)
    const parsed = JSON.parse(raw as string)

    expect(parsed.keys).toEqual(['artist', 'duration', 'title'])
    expect(parsed.title).toBe('Bohemian Rhapsody')
    expect(parsed.artist).toBe('Queen')
    expect(parsed.duration).toBe(354000)
    expect(parsed.extra).toBeUndefined()
  })

  it('blocks host access to window, document, and process', async () => {
    const source: LyricSourceDefinition = {
      id: 'test-host-access',
      name: 'Host Access Test',
      enabled: true,
      sortOrder: 0,
      script: `
        async function searchLyrics(query) {
          const hasProcess = typeof process !== 'undefined';
          const hasWindow = typeof window !== 'undefined';
          const hasDoc = typeof document !== 'undefined';
          return JSON.stringify({ hasProcess, hasWindow, hasDoc });
        }
      `,
    }

    const raw = await executeLyricSource(source, { title: 'T', artist: 'A', duration: 100 })
    const parsed = JSON.parse(raw as string)
    expect(parsed.hasProcess).toBe(false)
    expect(parsed.hasWindow).toBe(false)
    expect(parsed.hasDoc).toBe(false)
  })

  it('enforces allowedHosts whitelist', () => {
    expect(() => {
      checkAllowedHost('https://api.evil.com/leak', ['lrclib.net', 'music.163.com'])
    }).toThrow(/blocked: not in allowedHosts/)

    expect(() => {
      checkAllowedHost('https://lrclib.net/api/get', ['lrclib.net'])
    }).not.toThrow()

    expect(() => {
      checkAllowedHost('https://sub.lrclib.net/api/get', ['lrclib.net'])
    }).not.toThrow()
  })
})

describe('LyricSourcesPlugin Service', () => {
  it('manages sources and priority execution', async () => {
    const ctx = new Context()
    await ctx.plugin(LyricSourcesPlugin)

    const sources = ctx.lyricSources.getSources()
    expect(sources.length).toBeGreaterThanOrEqual(1)
    expect(sources[0]?.id).toBe('builtin-lrclib')

    // Register a custom mock source with higher priority (sortOrder = -1)
    const customSource: LyricSourceDefinition = {
      id: 'custom-priority',
      name: 'Custom High Priority Source',
      enabled: true,
      sortOrder: -1,
      script: `
        async function searchLyrics(query) {
          if (query.title === 'PrioritySong') {
            return '[00:01.00]Priority Lyric';
          }
          return null;
        }
      `,
    }

    await ctx.lyricSources.registerSource(customSource)

    const list = ctx.lyricSources.getSources()
    expect(list[0]?.id).toBe('custom-priority')

    // Search lyrics should hit the custom source
    const result = await ctx.lyricSources.searchLyrics({
      title: 'PrioritySong',
      artist: 'Singer',
      duration: 180000,
    })

    expect(result).toBeDefined()
    expect(result?.content).toBe('[00:01.00]Priority Lyric')
    expect(result?.synced).toBe(true)

    // Disable custom source
    await ctx.lyricSources.setEnabled('custom-priority', false)
    const disabledList = ctx.lyricSources.getSources()
    const foundDisabled = disabledList.find((s) => s.id === 'custom-priority')
    expect(foundDisabled?.enabled).toBe(false)

    // Test source directly
    const testResult = await ctx.lyricSources.testSource('custom-priority', {
      title: 'PrioritySong',
      artist: 'Singer',
      duration: 180000,
    })
    expect(testResult.ok).toBe(true)
    expect(testResult.lyrics?.content).toBe('[00:01.00]Priority Lyric')

    // Remove source
    const removed = await ctx.lyricSources.removeSource('custom-priority')
    expect(removed).toBe(true)
    const afterRemove = await ctx.lyricSources.getSources()
    expect(afterRemove.some((s) => s.id === 'custom-priority')).toBe(false)
  })
})
