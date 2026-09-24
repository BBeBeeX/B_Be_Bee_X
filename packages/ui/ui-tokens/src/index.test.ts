/**
 * The tokens, and the contrast gate.
 *
 * docs/08 §8 makes WCAG AA a CI check rather than a design review note. This
 * is that check — and the colour maths under it, because a wrong luminance
 * formula produces a gate that passes everything.
 */

import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  cssVariables,
  luminance,
  meetsAA,
  paletteContrastIssues,
  palettes,
  parseHex,
  tokens,
  builtInThemes,
  defaultTheme,
  midnightPurpleTheme,
  themeToCssVariables,
} from './index.js'

describe('parseHex', () => {
  it('reads the long and short forms', () => {
    expect(parseHex('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseHex('FF8000')).toEqual({ r: 255, g: 128, b: 0 })
  })

  it('ignores an alpha channel rather than misreading it', () => {
    expect(parseHex('#ff8000cc')).toEqual({ r: 255, g: 128, b: 0 })
  })

  it('refuses something that is not a colour', () => {
    for (const bad of ['#gg0000', 'rebeccapurple', '#12345', '']) {
      expect(() => parseHex(bad), bad).toThrow(/not a hex colour/)
    }
  })
})

describe('luminance and contrast', () => {
  it('matches the WCAG reference points', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      10,
    )
  })

  it('applies the sRGB→linear step', () => {
    // Mid grey is *not* half the luminance of white. A naive channel average
    // would report 0.5 here, and would wave through grey-on-white text.
    expect(luminance('#808080')).toBeCloseTo(0.2159, 3)
  })

  it('knows the AA thresholds apart', () => {
    // #767676 on white is the canonical 4.54:1 — the colour that passes body
    // text by a hair, and the one a broken formula gets wrong.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1)
    expect(meetsAA('#767676', '#ffffff')).toBe(true)
    expect(meetsAA('#8a8a8a', '#ffffff')).toBe(false)
    expect(meetsAA('#8a8a8a', '#ffffff', true), 'passes as large text').toBe(true)
  })
})

describe('the shipped palettes', () => {
  it('meet WCAG AA in both schemes', () => {
    // The gate from docs/08 §8. If this fails, the failing pair and its actual
    // ratio are in the message — "contrast failed" sends someone hunting.
    const issues = paletteContrastIssues()
    expect(
      issues,
      issues.map((i) => `${i.scheme}: ${i.pair} is ${i.ratio}:1, needs ${i.required}:1`).join('\n'),
    ).toEqual([])
  })

  it('define the same keys in light and dark', () => {
    // A dark theme is not a light theme with the lightness flipped, but it is
    // the same *shape* — a key present in one and missing in the other is a
    // component that renders `undefined` on one scheme only.
    const keys = (p: object): string[] =>
      Object.entries(p)
        .flatMap(([group, values]) => Object.keys(values as object).map((k) => `${group}.${k}`))
        .sort()
    expect(keys(palettes.light)).toEqual(keys(palettes.dark))
  })

  it('uses valid hex throughout', () => {
    for (const [scheme, palette] of Object.entries(palettes)) {
      for (const [group, values] of Object.entries(palette)) {
        for (const [name, value] of Object.entries(values as Record<string, string>)) {
          expect(() => parseHex(value), `${scheme}.${group}.${name}`).not.toThrow()
        }
      }
    }
  })

  it('keeps light and dark genuinely different', () => {
    // A copy-paste that left one scheme identical to the other would pass
    // every other check here.
    expect(palettes.light.bg.base).not.toBe(palettes.dark.bg.base)
    expect(palettes.light.text.primary).not.toBe(palettes.dark.text.primary)
  })
})

describe('scales', () => {
  it('spaces ascend from zero', () => {
    expect(tokens.space[0]).toBe(0)
    const ascending = [...tokens.space].every((v, i, all) => i === 0 || v > all[i - 1]!)
    expect(ascending).toBe(true)
  })

  it('font sizes ascend', () => {
    const sizes = Object.values(tokens.font.size)
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
  })

  it('keeps a touch target both platforms consider reliable', () => {
    expect(tokens.size.touchTarget).toBeGreaterThanOrEqual(44)
  })
})

describe('cssVariables', () => {
  it('emits every palette entry as a custom property', () => {
    const vars = cssVariables('dark')
    expect(vars['--bb-bg-base']).toBe(palettes.dark.bg.base)
    expect(vars['--bb-text-primary']).toBe(palettes.dark.text.primary)
    expect(vars['--bb-accent-on']).toBe(palettes.dark.accent.on)
  })

  it('emits scales with their units, so a stylesheet can use them directly', () => {
    const vars = cssVariables('light')
    expect(vars['--bb-radius-md']).toBe('8px')
    expect(vars['--bb-duration-fast']).toBe('120ms')
    expect(vars['--bb-space-4']).toBe('16px')
  })

  it('differs between schemes', () => {
    expect(cssVariables('light')['--bb-bg-base']).not.toBe(cssVariables('dark')['--bb-bg-base'])
  })
})

describe('Color Token System & Theme Management', () => {
  it('provides built-in midnight-purple and spotify themes', () => {
    expect(builtInThemes['midnight-purple']).toBeDefined()
    expect(builtInThemes['spotify']).toBeDefined()
    expect(defaultTheme.id).toBe('midnight-purple')
  })

  it('midnight-purple matches user specified color requirements', () => {
    const t = midnightPurpleTheme.tokens
    expect(t.bg.app).toBe('#05060B')
    expect(t.bg.primary).toBe('#080A12')
    expect(t.bg.secondary).toBe('#0B0E18')
    expect(t.bg.tertiary).toBe('#0F1322')

    expect(t.surface.s1).toBe('#0D101A')
    expect(t.surface.s2).toBe('#111522')
    expect(t.surface.s3).toBe('#151927')
    expect(t.surface.hover).toBe('#191E30')
    expect(t.surface.active).toBe('#1D2140')

    expect(t.brand.primary).toBe('#6366F1')
    expect(t.brand.primaryActive).toBe('#5865F2')
    expect(t.brand.primaryHover).toBe('#818CF8')
    expect(t.brand.accent).toBe('#A855F7')

    expect(t.text.primary).toBe('#F5F7FF')
    expect(t.text.secondary).toBe('#C5CAD8')

    expect(t.semantic.success).toBe('#22C55E')
    expect(t.semantic.warning).toBe('#F59E0B')
    expect(t.semantic.error).toBe('#EF4444')
    expect(t.semantic.info).toBe('#38BDF8')

    expect(t.music.playing).toBe('#7C6CFF')
    expect(t.music.lyrics).toBe('#B7AFFF')
    expect(t.music.waveform).toBe('#6575FF')
  })

  it('emits unified CSS custom properties via themeToCssVariables', () => {
    const vars = themeToCssVariables(midnightPurpleTheme)
    expect(vars['--bg-app']).toBe('#05060B')
    expect(vars['--bg-primary']).toBe('#080A12')
    expect(vars['--primary']).toBe('#6366F1')
    expect(vars['--accent']).toBe('#A855F7')
    expect(vars['--text-primary']).toBe('#F5F7FF')
    expect(vars['--border-subtle']).toBe('rgba(148,163,184,0.08)')
    expect(vars['--glow-sm']).toBe('0 0 10px rgba(99,102,241,0.16)')
    expect(vars['--gradient-brand']).toContain('#5865F2')
    expect(vars['--gradient-progress']).toContain('#4F6BFF')

    // Also ensures backwards compatibility with legacy --bb-*
    expect(vars['--bb-bg-sunken']).toBe('#05060B')
    expect(vars['--bb-bg-base']).toBe('#080A12')
    expect(vars['--bb-accent-base']).toBe('#6366F1')
  })
})
