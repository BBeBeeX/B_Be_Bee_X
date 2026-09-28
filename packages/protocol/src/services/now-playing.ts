/**
 * Now-playing presentation types.
 *
 * These are **layout** concerns — the spatial arrangement of the full-screen
 * player — and are orthogonal to the colour theme (`ctx.theme`).  The four
 * built-in styles share the same transport controls, the same hooks, and the
 * same data; what differs is where the artwork, metadata, and scrubber are
 * placed on screen.
 */

/**
 * The four built-in layout identifiers for the full-screen player.
 *
 *  - `classic`     Current default: centred artwork, info below, controls at bottom.
 *  - `full-cover`  Blurred artwork background, translucent controls overlay.
 *  - `vinyl`       Circular artwork spinning like a record, controls below.
 *  - `compact`     Side-by-side: large cover left, info + controls right.
 */
export type NowPlayingStyleId = 'classic' | 'full-cover' | 'vinyl' | 'compact'

export interface NowPlayingStyleMeta {
  id: NowPlayingStyleId
  /** Human-readable display name. */
  name: string
  /** Short description shown in the style picker. */
  description: string
  /** Tabler icon name for the picker UI. */
  icon: string
}

export const NOW_PLAYING_STYLES: readonly NowPlayingStyleMeta[] = [
  { id: 'classic', name: '经典', description: '居中封面，经典布局', icon: 'layout-distribute-vertical' },
  { id: 'full-cover', name: '沉浸封面', description: '全屏模糊封面背景', icon: 'photo' },
  { id: 'vinyl', name: '黑胶唱片', description: '旋转黑胶唱片风格', icon: 'vinyl' },
  { id: 'compact', name: '左右分栏', description: '封面与信息并排显示', icon: 'layout-sidebar-right' },
] as const

export const DEFAULT_NOW_PLAYING_STYLE: NowPlayingStyleId = 'classic'

export interface NowPlayingService {
  /** Returns the currently active full-screen player style id. */
  getStyle(): NowPlayingStyleId
  /** Changes the full-screen player style and persists the preference. */
  setStyle(id: NowPlayingStyleId): void
}

declare module 'cordis' {
  interface Context {
    nowPlaying: NowPlayingService
  }
}
