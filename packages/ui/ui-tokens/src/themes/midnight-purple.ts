import type { ColorTokens, ThemeDefinition } from '@BBeBee/protocol'

export const midnightPurpleTokens: ColorTokens = {
  bg: {
    app: '#05060B',
    primary: '#080A12',
    secondary: '#0B0E18',
    tertiary: '#0F1322',
  },
  surface: {
    s1: '#0D101A',
    s2: '#111522',
    s3: '#151927',
    hover: '#191E30',
    active: '#1D2140',
    selected: 'rgba(99,102,241,0.12)',
  },
  brand: {
    primary: '#6366F1',
    primaryActive: '#5865F2',
    primaryHover: '#818CF8',
    accent: '#A855F7',
    accentHover: '#C084FC',
  },
  gradient: {
    brand: 'linear-gradient(135deg, #5865F2 0%, #6D5DF6 45%, #A855F7 100%)',
    progress: 'linear-gradient(90deg, #4F6BFF 0%, #6366F1 50%, #A855F7 100%)',
  },
  text: {
    primary: '#F5F7FF',
    secondary: '#C5CAD8',
    tertiary: '#8B92A6',
    muted: '#626A80',
    disabled: '#41485B',
    placeholder: '#596176',
  },
  border: {
    subtle: 'rgba(148,163,184,0.08)',
    default: 'rgba(148,163,184,0.14)',
    hover: 'rgba(99,102,241,0.30)',
    active: 'rgba(99,102,241,0.55)',
    focus: 'rgba(139,92,246,0.65)',
  },
  semantic: {
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#38BDF8',
  },
  music: {
    playing: '#7C6CFF',
    lyrics: '#B7AFFF',
    waveform: '#6575FF',
    waveformActive: '#9B8CFF',
  },
  glow: {
    xs: '0 0 6px rgba(99,102,241,0.10)',
    sm: '0 0 10px rgba(99,102,241,0.16)',
    md: '0 0 18px rgba(99,102,241,0.20)',
    lg: '0 0 28px rgba(99,102,241,0.16)',
  },
}

export const midnightPurpleTheme: ThemeDefinition = {
  id: 'midnight-purple',
  name: '蓝紫暗夜 (Dark Music Blue-Purple)',
  description: '深黑背景与蓝紫交互微光，专为高品质沉浸音乐打造的高级科技感默认设计系统。',
  isDark: true,
  tokens: midnightPurpleTokens,
}
