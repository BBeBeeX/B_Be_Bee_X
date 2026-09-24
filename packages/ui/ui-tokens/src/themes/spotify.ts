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
    waveform: '#1DB954',
    waveformActive: '#1ED760',
  },
  glow: {
    xs: '0 0 6px rgba(29, 185, 84, 0.12)',
    sm: '0 0 10px rgba(29, 185, 84, 0.20)',
    md: '0 0 18px rgba(29, 185, 84, 0.25)',
    lg: '0 0 28px rgba(29, 185, 84, 0.20)',
  },
}

export const spotifyTheme: ThemeDefinition = {
  id: 'spotify',
  name: 'Spotify 经典绿 (Spotify Classic)',
  description: '经典 Spotify 绿黑风格调色，保留原汁原味的极简暗黑与翡翠绿品牌视觉。',
  isDark: true,
  tokens: spotifyTokens,
}
