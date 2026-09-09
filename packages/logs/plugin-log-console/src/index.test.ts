import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import pluginLogConsole from './index.js'

describe('plugin-log-console', () => {
  it('formats %s, %d and formats errors cleanly', async () => {
    const ctx = new Context()
    const logs: string[] = []
    const originalLog = console.log
    const originalError = console.error

    console.log = vi.fn((line: string) => {
      logs.push(line)
    })
    console.error = vi.fn((line: string) => {
      logs.push(line)
    })

    try {
      await ctx.plugin(pluginLogConsole, { level: 3 })
      ctx.logger.info('Directory selected: %s, count: %d', 'file:///music', 42)
      ctx.logger.error('failed with error: %s', new Error('disk full'))

      expect(logs[0]).toContain('INFO  [root] Directory selected: file:///music, count: 42')
      expect(logs[1]).toContain('ERROR [root] failed with error: Error: disk full')
    } finally {
      console.log = originalLog
      console.error = originalError
    }
  })

  it('respects log level', async () => {
    const ctx = new Context()
    const logs: string[] = []
    const originalLog = console.log

    console.log = vi.fn((line: string) => {
      logs.push(line)
    })

    try {
      // level 1 = warn only, info (2) should be filtered
      await ctx.plugin(pluginLogConsole, { level: 1 })
      ctx.logger.info('should not appear')
      expect(logs).toHaveLength(0)
    } finally {
      console.log = originalLog
    }
  })
})
