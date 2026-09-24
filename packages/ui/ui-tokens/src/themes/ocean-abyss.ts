import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

export const oceanAbyssTokens: ColorTokens = {
  bg: {
    app: '#040B11',
    primary: '#08131E',
    secondary: '#0D1C2A',
    tertiary: '#132638',
  },
  surface: {
    s1: '#0F2133',
    s2: '#162C42',
    s3: '#1E3752',
    hover: '#254464',
    active: '#2D5176',
    selected: 'rgba(6, 182, 212, 0.16)',
  },
  brand: {
    primary: '#06B6D4',
    primaryActive: '#0891B2',
    primaryHover: '#22D3EE',
    accent: '#14B8A6',
    accentHover: '#2DD4BF',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 50%, #38BDF8 100%)',
    progress: 'linear-gradient(90deg, #0891B2 0%, #06B6D4 50%, #22D3EE 100%)',
    blueViolet: 'linear-gradient(90deg, #06B6D4 0%, #6366F1 100%)',
    ice: 'linear-gradient(135deg, #38BDF8 0%, #A5F3FC 100%)',
    spectrum: 'linear-gradient(90deg, #0891B2, #06B6D4, #22D3EE, #14B8A6, #6366F1)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#CBD5E1',
    tertiary: '#94A3B8',
    muted: '#64748B',
    disabled: '#475569',
    placeholder: '#334155',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    default: 'rgba(255, 255, 255, 0.14)',
    hover: 'rgba(6, 182, 212, 0.35)',
    active: 'rgba(6, 182, 212, 0.60)',
    focus: 'rgba(6, 182, 212, 0.70)',
  },
  semantic: {
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#06B6D4',
  },
  music: {
    playing: '#22D3EE',
    lyrics: '#FFFFFF',
    lyricsActive: '#06B6D4',
    lyricsHighlight: '#67E8F9',
    waveform: '#14B8A6',
    waveformActive: '#06B6D4',
  },
  glow: {
    xs: '0 0 6px rgba(6, 182, 212, 0.20)',
    sm: '0 0 12px rgba(6, 182, 212, 0.25)',
    md: '0 0 20px rgba(6, 182, 212, 0.35)',
    lg: '0 0 32px rgba(6, 182, 212, 0.30)',
    blueXs: '0 0 6px rgba(6, 182, 212, 0.20)',
    blueSm: '0 0 12px rgba(6, 182, 212, 0.25)',
    blueMd: '0 0 20px rgba(6, 182, 212, 0.35)',
    purpleXs: '0 0 6px rgba(99, 102, 241, 0.20)',
    purpleSm: '0 0 12px rgba(99, 102, 241, 0.25)',
    purpleMd: '0 0 20px rgba(99, 102, 241, 0.35)',
    brandSm: '0 0 12px rgba(6, 182, 212, 0.22), 0 0 24px rgba(99, 102, 241, 0.12)',
    brandMd: '0 0 18px rgba(6, 182, 212, 0.28), 0 0 36px rgba(99, 102, 241, 0.18)',
  },
}

export const oceanAbyssCssVariables: Record<string, string> = {
  '--color-bg-app': '#040B11',
  '--color-bg-primary': '#08131E',
  '--color-bg-secondary': '#0D1C2A',
  '--color-bg-tertiary': '#132638',

  '--color-surface': '#162C42',
  '--color-surface-hover': '#254464',
  '--color-surface-active': '#2D5176',
  '--color-surface-selected': 'rgba(6, 182, 212, 0.16)',

  '--color-text-primary': '#FFFFFF',
  '--color-text-secondary': '#CBD5E1',
  '--color-text-tertiary': '#94A3B8',
  '--color-text-muted': '#64748B',
  '--color-text-disabled': '#475569',

  '--color-primary': '#06B6D4',
  '--color-primary-hover': '#22D3EE',
  '--color-primary-active': '#0891B2',

  '--color-accent': '#14B8A6',
  '--color-accent-hover': '#2DD4BF',

  '--color-playing': '#22D3EE',
  '--color-lyrics': '#FFFFFF',
  '--color-lyrics-active': '#06B6D4',
  '--color-lyrics-highlight': '#67E8F9',
  '--color-waveform': '#14B8A6',
  '--color-waveform-active': '#06B6D4',

  '--gradient-brand': 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 50%, #38BDF8 100%)',
  '--gradient-blue-violet': 'linear-gradient(90deg, #06B6D4 0%, #6366F1 100%)',
  '--gradient-ice': 'linear-gradient(135deg, #38BDF8 0%, #A5F3FC 100%)',
  '--gradient-progress': 'linear-gradient(90deg, #0891B2 0%, #06B6D4 50%, #22D3EE 100%)',
  '--gradient-spectrum': 'linear-gradient(90deg, #0891B2, #06B6D4, #22D3EE, #14B8A6, #6366F1)',

  '--glow-blue-xs': '0 0 6px rgba(6, 182, 212, 0.20)',
  '--glow-blue-sm': '0 0 12px rgba(6, 182, 212, 0.25)',
  '--glow-blue-md': '0 0 20px rgba(6, 182, 212, 0.35)',
  '--glow-purple-xs': '0 0 6px rgba(99, 102, 241, 0.20)',
  '--glow-purple-sm': '0 0 12px rgba(99, 102, 241, 0.25)',
  '--glow-purple-md': '0 0 20px rgba(99, 102, 241, 0.35)',
  '--glow-brand-sm': '0 0 12px rgba(6, 182, 212, 0.22), 0 0 24px rgba(99, 102, 241, 0.12)',
  '--glow-brand-md': '0 0 18px rgba(6, 182, 212, 0.28), 0 0 36px rgba(99, 102, 241, 0.18)',

  '--button-primary-bg': 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 100%)',
  '--button-primary-hover': 'linear-gradient(135deg, #22D3EE 0%, #2DD4BF 100%)',
  '--button-primary-text': '#FFFFFF',

  '--player-bg': 'var(--bg-app)',
  '--player-progress': 'linear-gradient(90deg, #0891B2 0%, #06B6D4 50%, #22D3EE 100%)',
  '--player-playing': '#22D3EE',

  '--slider-track': 'rgba(255, 255, 255, 0.10)',
  '--slider-active': 'linear-gradient(90deg, #0891B2 0%, #06B6D4 100%)',
  '--slider-thumb': '#22D3EE',

  '--waveform-idle': 'rgba(6, 182, 212, 0.35)',
  '--waveform-active': 'linear-gradient(90deg, #0891B2, #06B6D4, #22D3EE)',

  '--lyrics-normal': 'rgba(255, 255, 255, 0.45)',
  '--lyrics-active': '#06B6D4',
  '--lyrics-highlight': '#67E8F9',

  '--sidebar-bg': '#040B11',
  '--sidebar-item-hover': 'rgba(6, 182, 212, 0.08)',
  '--sidebar-item-active': 'rgba(6, 182, 212, 0.16)',
  '--sidebar-active-indicator': '#06B6D4',
}

export const oceanAbyssTheme: ThemeDefinition = {
  id: 'ocean-abyss',
  name: '深海秘境 · Ocean Abyss',
  description: '静谧幽邃的深海幽蓝与灵动荧光青碧，沉浸空灵的声音海洋',
  isDark: true,
  tokens: oceanAbyssTokens,
  cssVariables: oceanAbyssCssVariables,
}
