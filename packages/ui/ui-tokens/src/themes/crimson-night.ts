import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

export const crimsonNightTokens: ColorTokens = {
  bg: {
    app: '#070709',
    primary: '#0E0E14',
    secondary: '#16131B',
    tertiary: '#201824',
  },
  surface: {
    s1: '#15121A',
    s2: '#1E1824',
    s3: '#281F30',
    hover: '#2D2336',
    active: '#382B42',
    selected: 'rgba(255, 45, 85, 0.16)',
  },
  brand: {
    primary: '#FF2D55',
    primaryActive: '#E01E45',
    primaryHover: '#FF4D70',
    accent: '#FF375F',
    accentHover: '#FF5E7E',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #FF2D55 0%, #FF375F 50%, #FF6482 100%)',
    progress: 'linear-gradient(90deg, #E01E45 0%, #FF2D55 50%, #FF5E7E 100%)',
    blueViolet: 'linear-gradient(90deg, #FF2D55 0%, #C026D3 100%)',
    ice: 'linear-gradient(135deg, #FF6482 0%, #FFA1B5 100%)',
    spectrum: 'linear-gradient(90deg, #E01E45, #FF2D55, #FF5E7E, #C026D3)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#D4D4D8',
    tertiary: '#A1A1AA',
    muted: '#71717A',
    disabled: '#52525B',
    placeholder: '#3F3F46',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    default: 'rgba(255, 255, 255, 0.14)',
    hover: 'rgba(255, 45, 85, 0.35)',
    active: 'rgba(255, 45, 85, 0.60)',
    focus: 'rgba(255, 45, 85, 0.70)',
  },
  semantic: {
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#FF2D55',
    info: '#FB7185',
  },
  music: {
    playing: '#FF4D70',
    lyrics: '#FFFFFF',
    lyricsActive: '#FF2D55',
    lyricsHighlight: '#FF7597',
    waveform: '#FF375F',
    waveformActive: '#FF2D55',
  },
  glow: {
    xs: '0 0 6px rgba(255, 45, 85, 0.20)',
    sm: '0 0 12px rgba(255, 45, 85, 0.25)',
    md: '0 0 20px rgba(255, 45, 85, 0.35)',
    lg: '0 0 32px rgba(255, 45, 85, 0.30)',
    blueXs: '0 0 6px rgba(255, 45, 85, 0.20)',
    blueSm: '0 0 12px rgba(255, 45, 85, 0.25)',
    blueMd: '0 0 20px rgba(255, 45, 85, 0.35)',
    purpleXs: '0 0 6px rgba(192, 38, 211, 0.20)',
    purpleSm: '0 0 12px rgba(192, 38, 211, 0.25)',
    purpleMd: '0 0 20px rgba(192, 38, 211, 0.35)',
    brandSm: '0 0 12px rgba(255, 45, 85, 0.22), 0 0 24px rgba(192, 38, 211, 0.12)',
    brandMd: '0 0 18px rgba(255, 45, 85, 0.28), 0 0 36px rgba(192, 38, 211, 0.18)',
  },
}

export const crimsonNightCssVariables: Record<string, string> = {
  '--color-bg-app': '#070709',
  '--color-bg-primary': '#0E0E14',
  '--color-bg-secondary': '#16131B',
  '--color-bg-tertiary': '#201824',

  '--color-surface': '#1E1824',
  '--color-surface-hover': '#2D2336',
  '--color-surface-active': '#382B42',
  '--color-surface-selected': 'rgba(255, 45, 85, 0.16)',

  '--color-text-primary': '#FFFFFF',
  '--color-text-secondary': '#D4D4D8',
  '--color-text-tertiary': '#A1A1AA',
  '--color-text-muted': '#71717A',
  '--color-text-disabled': '#52525B',

  '--color-primary': '#FF2D55',
  '--color-primary-hover': '#FF4D70',
  '--color-primary-active': '#E01E45',

  '--color-accent': '#FF375F',
  '--color-accent-hover': '#FF5E7E',

  '--color-playing': '#FF4D70',
  '--color-lyrics': '#FFFFFF',
  '--color-lyrics-active': '#FF2D55',
  '--color-lyrics-highlight': '#FF7597',
  '--color-waveform': '#FF375F',
  '--color-waveform-active': '#FF2D55',

  '--gradient-brand': 'linear-gradient(135deg, #FF2D55 0%, #FF375F 50%, #FF6482 100%)',
  '--gradient-blue-violet': 'linear-gradient(90deg, #FF2D55 0%, #C026D3 100%)',
  '--gradient-ice': 'linear-gradient(135deg, #FF6482 0%, #FFA1B5 100%)',
  '--gradient-progress': 'linear-gradient(90deg, #E01E45 0%, #FF2D55 50%, #FF5E7E 100%)',
  '--gradient-spectrum': 'linear-gradient(90deg, #E01E45, #FF2D55, #FF5E7E, #C026D3)',

  '--glow-blue-xs': '0 0 6px rgba(255, 45, 85, 0.20)',
  '--glow-blue-sm': '0 0 12px rgba(255, 45, 85, 0.25)',
  '--glow-blue-md': '0 0 20px rgba(255, 45, 85, 0.35)',
  '--glow-purple-xs': '0 0 6px rgba(192, 38, 211, 0.20)',
  '--glow-purple-sm': '0 0 12px rgba(192, 38, 211, 0.25)',
  '--glow-purple-md': '0 0 20px rgba(192, 38, 211, 0.35)',
  '--glow-brand-sm': '0 0 12px rgba(255, 45, 85, 0.22), 0 0 24px rgba(192, 38, 211, 0.12)',
  '--glow-brand-md': '0 0 18px rgba(255, 45, 85, 0.28), 0 0 36px rgba(192, 38, 211, 0.18)',

  '--button-primary-bg': 'linear-gradient(135deg, #FF2D55 0%, #FF375F 100%)',
  '--button-primary-hover': 'linear-gradient(135deg, #FF4D70 0%, #FF6482 100%)',
  '--button-primary-text': '#FFFFFF',

  '--player-bg': 'var(--bg-app)',
  '--player-progress': 'linear-gradient(90deg, #E01E45 0%, #FF2D55 50%, #FF5E7E 100%)',
  '--player-playing': '#FF4D70',

  '--slider-track': 'rgba(255, 255, 255, 0.10)',
  '--slider-active': 'linear-gradient(90deg, #E01E45 0%, #FF2D55 100%)',
  '--slider-thumb': '#FF4D70',

  '--waveform-idle': 'rgba(255, 45, 85, 0.35)',
  '--waveform-active': 'linear-gradient(90deg, #E01E45, #FF2D55, #FF5E7E)',

  '--lyrics-normal': 'rgba(255, 255, 255, 0.45)',
  '--lyrics-active': '#FF2D55',
  '--lyrics-highlight': '#FF7597',

  '--sidebar-bg': '#070709',
  '--sidebar-item-hover': 'rgba(255, 45, 85, 0.08)',
  '--sidebar-item-active': 'rgba(255, 45, 85, 0.16)',
  '--sidebar-active-indicator': '#FF2D55',
}

export const crimsonNightTheme: ThemeDefinition = {
  id: 'crimson-night',
  name: '绯红暗夜 · Crimson Night',
  description: '深邃黑曜石搭配极光绯红，热烈深沉的暗夜血月风范',
  isDark: true,
  tokens: crimsonNightTokens,
  cssVariables: crimsonNightCssVariables,
}
