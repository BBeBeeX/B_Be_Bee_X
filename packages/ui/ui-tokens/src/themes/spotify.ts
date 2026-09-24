import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

export const spotifyTokens: ColorTokens = {
  bg: {
    app: '#000000',
    primary: '#121212',
    secondary: '#181818',
    tertiary: '#242424',
  },
  surface: {
    s1: '#181818',
    s2: '#242424',
    s3: '#282828',
    hover: '#2A2A2A',
    active: '#333333',
    selected: 'rgba(29, 185, 84, 0.15)',
  },
  brand: {
    primary: '#1DB954',
    primaryActive: '#1AA34A',
    primaryHover: '#1ED760',
    accent: '#1ED760',
    accentHover: '#22E369',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #1DB954 0%, #1ED760 100%)',
    progress: 'linear-gradient(90deg, #1DB954 0%, #1ED760 100%)',
    blueViolet: 'linear-gradient(90deg, #1DB954 0%, #1ED760 100%)',
    ice: 'linear-gradient(135deg, #1ED760 0%, #1DB954 100%)',
    spectrum: 'linear-gradient(90deg, #1DB954, #1ED760, #22E369)',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#B3B3B3',
    tertiary: '#8E8E93',
    muted: '#6A6A6A',
    disabled: '#4D4D4D',
    placeholder: '#5E5E5E',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.08)',
    default: 'rgba(255, 255, 255, 0.14)',
    hover: 'rgba(29, 185, 84, 0.35)',
    active: 'rgba(29, 185, 84, 0.60)',
    focus: 'rgba(29, 185, 84, 0.70)',
  },
  semantic: {
    success: '#1ED760',
    warning: '#FFA42B',
    error: '#F15E6C',
    info: '#38BDF8',
  },
  music: {
    playing: '#1DB954',
    lyrics: '#FFFFFF',
    lyricsActive: '#1ED760',
    lyricsHighlight: '#1DB954',
    waveform: '#1DB954',
    waveformActive: '#1ED760',
  },
  glow: {
    xs: '0 0 6px rgba(29, 185, 84, 0.12)',
    sm: '0 0 10px rgba(29, 185, 84, 0.20)',
    md: '0 0 18px rgba(29, 185, 84, 0.25)',
    lg: '0 0 28px rgba(29, 185, 84, 0.20)',
    blueXs: '0 0 6px rgba(29, 185, 84, 0.12)',
    blueSm: '0 0 10px rgba(29, 185, 84, 0.20)',
    blueMd: '0 0 18px rgba(29, 185, 84, 0.25)',
    purpleXs: '0 0 6px rgba(29, 185, 84, 0.12)',
    purpleSm: '0 0 10px rgba(29, 185, 84, 0.20)',
    purpleMd: '0 0 18px rgba(29, 185, 84, 0.25)',
    brandSm: '0 0 10px rgba(29, 185, 84, 0.20)',
    brandMd: '0 0 18px rgba(29, 185, 84, 0.25)',
  },
}

export const spotifyCssVariables: Record<string, string> = {
  // Semantic Colors
  '--color-bg-app': '#000000',
  '--color-bg-primary': '#121212',
  '--color-bg-secondary': '#181818',
  '--color-bg-tertiary': '#242424',

  '--color-surface': '#242424',
  '--color-surface-hover': '#2A2A2A',
  '--color-surface-active': '#333333',
  '--color-surface-selected': 'rgba(29, 185, 84, 0.15)',

  '--color-text-primary': '#FFFFFF',
  '--color-text-secondary': '#B3B3B3',
  '--color-text-tertiary': '#8E8E93',
  '--color-text-muted': '#6A6A6A',
  '--color-text-disabled': '#4D4D4D',

  '--color-primary': '#1DB954',
  '--color-primary-hover': '#1ED760',
  '--color-primary-active': '#1AA34A',

  '--color-accent': '#1ED760',
  '--color-accent-hover': '#22E369',

  '--color-playing': '#1DB954',
  '--color-lyrics': '#FFFFFF',
  '--color-lyrics-active': '#1ED760',
  '--color-lyrics-highlight': '#1DB954',
  '--color-waveform': '#1DB954',
  '--color-waveform-active': '#1ED760',

  // Gradients
  '--gradient-brand': 'linear-gradient(135deg, #1DB954 0%, #1ED760 100%)',
  '--gradient-blue-violet': 'linear-gradient(90deg, #1DB954 0%, #1ED760 100%)',
  '--gradient-ice': 'linear-gradient(135deg, #1ED760 0%, #1DB954 100%)',
  '--gradient-progress': 'linear-gradient(90deg, #1DB954 0%, #1ED760 100%)',
  '--gradient-spectrum': 'linear-gradient(90deg, #1DB954, #1ED760, #22E369)',

  // Glow System
  '--glow-blue-xs': '0 0 6px rgba(29, 185, 84, 0.12)',
  '--glow-blue-sm': '0 0 10px rgba(29, 185, 84, 0.20)',
  '--glow-blue-md': '0 0 18px rgba(29, 185, 84, 0.25)',
  '--glow-purple-xs': '0 0 6px rgba(29, 185, 84, 0.12)',
  '--glow-purple-sm': '0 0 10px rgba(29, 185, 84, 0.20)',
  '--glow-purple-md': '0 0 18px rgba(29, 185, 84, 0.25)',
  '--glow-brand-sm': '0 0 10px rgba(29, 185, 84, 0.20)',
  '--glow-brand-md': '0 0 18px rgba(29, 185, 84, 0.25)',

  // Component Tokens
  '--button-primary-bg': '#1DB954',
  '--button-primary-hover': '#1ED760',
  '--button-primary-text': '#000000',

  '--player-bg': '#181818',
  '--player-progress': 'linear-gradient(90deg, #1DB954 0%, #1ED760 100%)',
  '--player-playing': '#1DB954',

  '--slider-track': 'rgba(255, 255, 255, 0.15)',
  '--slider-active': '#1DB954',
  '--slider-thumb': '#FFFFFF',

  '--waveform-idle': 'rgba(29, 185, 84, 0.35)',
  '--waveform-active': '#1ED760',

  '--lyrics-normal': 'rgba(255, 255, 255, 0.45)',
  '--lyrics-active': '#1ED760',
  '--lyrics-highlight': '#FFFFFF',

  '--sidebar-bg': '#000000',
  '--sidebar-item-hover': 'rgba(255, 255, 255, 0.05)',
  '--sidebar-item-active': 'rgba(29, 185, 84, 0.15)',
  '--sidebar-active-indicator': '#1DB954',

  '--card-bg': '#181818',
  '--card-hover': '#282828',
  '--card-border': 'rgba(255, 255, 255, 0.08)',
  '--card-border-hover': 'rgba(29, 185, 84, 0.35)',

  '--tab-text': 'rgba(255, 255, 255, 0.55)',
  '--tab-text-active': '#FFFFFF',
  '--tab-indicator': '#1DB954',

  '--input-bg': 'rgba(255, 255, 255, 0.05)',
  '--input-border': 'rgba(255, 255, 255, 0.14)',
  '--input-focus-border': '#1DB954',
  '--input-focus-glow': '0 0 8px rgba(29, 185, 84, 0.25)',

  '--playing-item-bg': 'rgba(29, 185, 84, 0.08)',
  '--playing-item-border': 'rgba(29, 185, 84, 0.25)',
  '--playing-item-indicator': '#1DB954',
  '--playing-item-glow': '0 0 10px rgba(29, 185, 84, 0.20)',
}

export const spotifyTheme: ThemeDefinition = {
  id: 'spotify',
  name: 'Spotify 经典绿 (Spotify Classic)',
  description: '经典 Spotify 绿黑风格调色，保留原汁原味的极简暗黑与翡翠绿品牌视觉。',
  isDark: true,
  tokens: spotifyTokens,
  cssVariables: spotifyCssVariables,
}
