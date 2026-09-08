/**
 * `@BBeBee/ui-tokens` — the design system as plain data.
 *
 * Values, not components, and no framework import anywhere: this is the only
 * way two view layers that share no component code end up looking like one
 * product (docs/08 §6). `ui-kit-mobile` consumes these as `StyleSheet`
 * values; `ui-kit-desktop` emits them as CSS custom properties.
 *
 * The palette is defined **per scheme** rather than as one set of colours
 * with a dark override. A dark theme is not a light theme with the lightness
 * flipped — the contrast relationships differ, and expressing dark as a patch
 * is how a palette drifts into being unreadable in one of its two modes with
 * nobody noticing.
 */

import { AA_LARGE, AA_TEXT, contrastRatio } from './color.js'

export * from './color.js'

export type Scheme = 'light' | 'dark'

export interface Palette {
  /**
   * `sunken` is the chrome the app sits *in* — the desktop rail and the
   * transport bar — and it is deliberately darker than `base` rather than
   * lighter. The layout reads as panels floating on a backdrop, which is what
   * makes a sidebar feel like furniture instead of another card.
   */
  bg: { sunken: string; base: string; raised: string; overlay: string }
  text: { primary: string; secondary: string; disabled: string }
  accent: { base: string; hover: string; muted: string; on: string }
  state: { error: string; warn: string; ok: string }
  /**
   * `subtle` separates surfaces and is decorative; `strong` outlines a control
   * or draws a focus ring, so it is held to WCAG 1.4.11's 3:1 against the
   * surface behind it and is checked (`paletteContrastIssues`).
   */
  border: { subtle: string; strong: string }
}

/**
 * Dark first, because it is the mode a music player is used in.
 *
 * Every foreground here clears WCAG AA against the surface it is specified
 * for; `paletteContrastIssues` is what proves it, and the parity test is what
 * runs that on every change.
 */
const dark: Palette = {
  bg: { sunken: '#000000', base: '#121212', raised: '#181818', overlay: '#282828' },
  text: { primary: '#FFFFFF', secondary: '#B3B3B3', disabled: '#6A6A6A' },
  /**
   * A green accent on near-black, and `on` is **black**.
   *
   * The accent is a fill first and a text colour second: it is the play
   * button, the active row, the progress that has already played. Light text
   * on a saturated green never clears AA — black on it clears 8:1 — which is
   * why `on` is the darkest value in the palette rather than the lightest.
   */
  accent: { base: '#1DB954', hover: '#1ED760', muted: '#1B3D2B', on: '#000000' },
  state: { error: '#F15E6C', warn: '#FFA42B', ok: '#1ED760' },
  border: { subtle: '#282828', strong: '#7A7A7A' },
}

/**
 * The same design, inverted — not the same hues lightened.
 *
 * The accent is the one value that cannot survive the trip: `#1DB954` on white
 * is 2.6:1, so it fails as a boundary *and* as a fill under white text. The
 * light scheme therefore uses a deeper green of the same family, which is what
 * keeps "the accent" one idea across two schemes instead of one idea and one
 * illegible souvenir of it.
 */
const light: Palette = {
  bg: { sunken: '#F1F1F1', base: '#FFFFFF', raised: '#F6F6F6', overlay: '#EDEDED' },
  text: { primary: '#000000', secondary: '#5E5E5E', disabled: '#8C8C8C' },
  accent: { base: '#12833C', hover: '#0D6E36', muted: '#D7F2E2', on: '#FFFFFF' },
  state: { error: '#C1291F', warn: '#8A5A00', ok: '#0E7A3D' },
  border: { subtle: '#E5E5E5', strong: '#767676' },
}

export const palettes: Record<Scheme, Palette> = { light, dark }

/**
 * Everything that is not a colour.
 *
 * Scales rather than free values: a spacing that is not on the scale is a
 * decision made twice, and the second one will not match.
 */
export const tokens = {
  /** Index into this, never a raw pixel value. */
  space: [0, 4, 8, 12, 16, 24, 32, 48, 64] as const,
  radius: { sm: 4, md: 8, lg: 16, pill: 999 } as const,
  font: {
    family: {
      /**
       * A geometric grotesque, then whatever the machine actually has.
       *
       * The named faces are looked up, never shipped: the renderer's CSP
       * allows no foreign fonts, and a typeface is licensed to whoever
       * installed it, not to this app. So the stack degrades to the system UI
       * font, which is why the type scale below carries the weight of the
       * design rather than the family does.
       */
      ui: '"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    /** Relative on mobile, so the OS text-size setting is honoured (docs/08 §8). */
    size: { xs: 11, sm: 13, md: 15, lg: 20, xl: 28, display: 40 } as const,
    /**
     * `heavy` is not decoration: the display sizes are set in it, and a 40px
     * title at weight 700 reads as a large paragraph rather than a heading.
     */
    weight: { regular: '400', medium: '500', bold: '700', heavy: '900' } as const,
    lineHeight: { tight: 1.2, normal: 1.45, loose: 1.7 } as const,
  },
  duration: { fast: 120, normal: 200, slow: 320 } as const,
  /** Hit targets. 44 is the smallest either OS considers reliably tappable. */
  size: { touchTarget: 44, icon: 20, iconLarge: 28, row: 56, artworkThumb: 48 } as const,
  z: { base: 0, sticky: 10, overlay: 100, toast: 1000 } as const,
} as const

export type Tokens = typeof tokens

/* ── Contrast checking ──────────────────────────────────────────────────── */

export interface ContrastIssue {
  scheme: Scheme
  pair: string
  ratio: number
  required: number
}

/**
 * Every foreground/background pair the design actually uses, and the minimum
 * each must clear.
 *
 * Enumerated rather than derived: only the design knows that
 * `text.secondary` is used on `bg.raised` and never on `accent.base`, and a
 * combinatorial check would fail on pairs nobody puts together.
 */
const CHECKED_PAIRS: {
  pair: string
  fg: (p: Palette) => string
  bg: (p: Palette) => string
  large?: boolean
}[] = [
  { pair: 'text.primary on bg.sunken', fg: (p) => p.text.primary, bg: (p) => p.bg.sunken },
  { pair: 'text.secondary on bg.sunken', fg: (p) => p.text.secondary, bg: (p) => p.bg.sunken },
  { pair: 'text.primary on bg.base', fg: (p) => p.text.primary, bg: (p) => p.bg.base },
  { pair: 'text.primary on bg.raised', fg: (p) => p.text.primary, bg: (p) => p.bg.raised },
  { pair: 'text.primary on bg.overlay', fg: (p) => p.text.primary, bg: (p) => p.bg.overlay },
  { pair: 'text.secondary on bg.base', fg: (p) => p.text.secondary, bg: (p) => p.bg.base },
  { pair: 'text.secondary on bg.raised', fg: (p) => p.text.secondary, bg: (p) => p.bg.raised },
  { pair: 'accent.base on bg.base', fg: (p) => p.accent.base, bg: (p) => p.bg.base, large: true },
  { pair: 'accent.on on accent.base', fg: (p) => p.accent.on, bg: (p) => p.accent.base },
  { pair: 'state.error on bg.base', fg: (p) => p.state.error, bg: (p) => p.bg.base },
  { pair: 'state.warn on bg.base', fg: (p) => p.state.warn, bg: (p) => p.bg.base },
  { pair: 'state.ok on bg.base', fg: (p) => p.state.ok, bg: (p) => p.bg.base },
  // A boundary is a UI component, so it is held to the 3:1 rule rather than 4.5.
  { pair: 'border.strong on bg.base', fg: (p) => p.border.strong, bg: (p) => p.bg.base, large: true },
]

/**
 * Which checked pairs fail WCAG AA, in both schemes.
 *
 * Returns the failures rather than a boolean so a CI message can name the
 * pair and its actual ratio — "contrast failed" sends someone hunting.
 */
export function paletteContrastIssues(): ContrastIssue[] {
  const issues: ContrastIssue[] = []
  for (const scheme of ['light', 'dark'] as const) {
    const palette = palettes[scheme]
    for (const check of CHECKED_PAIRS) {
      const ratio = contrastRatio(check.fg(palette), check.bg(palette))
      const required = check.large ? AA_LARGE : AA_TEXT
      if (Math.round(ratio * 100) / 100 < required) {
        issues.push({ scheme, pair: check.pair, ratio: Math.round(ratio * 100) / 100, required })
      }
    }
  }
  return issues
}

/** Design-token names, for the desktop kit's CSS custom properties. */
export function cssVariables(scheme: Scheme): Record<string, string> {
  const palette = palettes[scheme]
  const out: Record<string, string> = {}
  for (const [group, values] of Object.entries(palette)) {
    for (const [name, value] of Object.entries(values as Record<string, string>)) {
      out[`--bb-${group}-${name}`] = value
    }
  }
  for (const [name, value] of Object.entries(tokens.radius)) out[`--bb-radius-${name}`] = `${value}px`
  for (const [name, value] of Object.entries(tokens.duration)) {
    out[`--bb-duration-${name}`] = `${value}ms`
  }
  tokens.space.forEach((value, i) => void (out[`--bb-space-${i}`] = `${value}px`))
  return out
}
