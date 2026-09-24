import { describe, expect, it } from 'vitest'
import { Context } from '@BBeBee/kernel'
import { ThemePlugin } from './index.js'
import { midnightPurpleTheme } from '@BBeBee/ui-tokens'
import type { ThemeDefinition } from '@BBeBee/protocol'

describe('ThemePlugin', () => {
  it('initializes with default midnight-purple theme', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    expect(ctx.theme.getCurrentTheme().id).toBe('midnight-purple')
    expect(ctx.theme.getThemes().length).toBeGreaterThanOrEqual(2)
  })

  it('switches between built-in themes and fires event', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    let changedTo: ThemeDefinition | undefined
    ctx.theme.onThemeChange((t) => {
      changedTo = t
    })

    await ctx.theme.setTheme('spotify')
    expect(ctx.theme.getCurrentTheme().id).toBe('spotify')
    expect(changedTo?.id).toBe('spotify')
    expect(ctx.theme.getCurrentTheme().tokens.brand.primary).toBe('#1DB954')
  })

  it('supports runtime dynamic theme registration and deregistration', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    const customTheme: ThemeDefinition = {
      id: 'custom-neon',
      name: '自定义霓虹',
      isDark: true,
      tokens: {
        ...midnightPurpleTheme.tokens,
        brand: {
          ...midnightPurpleTheme.tokens.brand,
          primary: '#00F0FF',
        },
      },
    }

    const unregister = ctx.theme.registerTheme(customTheme)
    expect(ctx.theme.getThemes().some((t) => t.id === 'custom-neon')).toBe(true)

    await ctx.theme.setTheme('custom-neon')
    expect(ctx.theme.getCurrentTheme().id).toBe('custom-neon')
    expect(ctx.theme.getCurrentTheme().tokens.brand.primary).toBe('#00F0FF')

    // Disposing unregisters the theme and falls back to default
    unregister()
    expect(ctx.theme.getThemes().some((t) => t.id === 'custom-neon')).toBe(false)
    expect(ctx.theme.getCurrentTheme().id).toBe('midnight-purple')
  })

  it('supports removeTheme explicitly and prevents removing built-in themes', async () => {
    const ctx = new Context()
    await ctx.plugin(ThemePlugin)

    expect(ctx.theme.removeTheme('midnight-purple')).toBe(false)
    expect(ctx.theme.removeTheme('spotify')).toBe(false)

    const customTheme: ThemeDefinition = {
      id: 'custom-solar',
      name: '暖阳金',
      isDark: true,
      tokens: {
        ...midnightPurpleTheme.tokens,
        brand: { ...midnightPurpleTheme.tokens.brand, primary: '#FFAA00' },
      },
    }

    ctx.theme.registerTheme(customTheme)
    await ctx.theme.setTheme('custom-solar')
    expect(ctx.theme.getCurrentTheme().id).toBe('custom-solar')

    const removed = ctx.theme.removeTheme('custom-solar')
    expect(removed).toBe(true)
    expect(ctx.theme.getThemes().some((t) => t.id === 'custom-solar')).toBe(false)
    expect(ctx.theme.getCurrentTheme().id).toBe('midnight-purple')
  })
})
