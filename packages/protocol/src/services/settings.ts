/**
 * `ctx.settings` — global application preferences and configuration service.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'

export interface DesktopLyricsSettings {
  /** Line display mode: single line or double line. */
  lineMode: 'single' | 'double'
  /** Horizontal alignment: center, left, or right. */
  align: 'center' | 'left' | 'right'
  /** Font family for desktop lyrics. */
  fontFamily: string
  /** Font size in pixels. */
  fontSize: number
  /** Text highlight/primary color (hex string, e.g. '#FFFFFF'). */
  textColor: string
  /** Text opacity between 0.2 and 1.0. */
  opacity: number
}

export interface ShortcutKeybindings {
  playPause: string
  prevTrack: string
  nextTrack: string
  volumeUp: string
  volumeDown: string
  toggleLyrics: string
  toggleWindow: string
  toggleLoved: string
  seekForward: string
  seekBackward: string
}

export interface GlobalShortcutsSettings {
  /** Master switch for global desktop shortcuts. */
  enabled: boolean
  /** Keybindings mapped to specific actions. */
  keybindings: ShortcutKeybindings
}

export interface ProxySettings {
  /** Whether network proxy is enabled. */
  enabled: boolean
  /** Proxy protocol type. */
  protocol: 'http' | 'https' | 'socks5'
  /** Proxy server host. */
  host: string
  /** Proxy server port. */
  port: number
  /** Optional proxy authentication username. */
  username?: string
  /** Optional proxy authentication password. */
  password?: string
  /** Per-source proxy enable toggle (sourceId -> boolean). */
  sourceRules: Record<string, boolean>
}

export interface AppSettings {
  /** Visual appearance theme. */
  theme: 'dark' | 'light' | 'system'
  /** User interface language. */
  language: 'zh' | 'en' | 'system'
  /** Default startup playback volume (0 to 100). */
  defaultVolume?: number
  /** Whether crossfade is enabled between tracks. */
  crossfadeEnabled: boolean
  /** Crossfade transition duration in seconds (1 to 10). */
  crossfadeDurationSeconds: number
  /** Whether gapless playback is enabled. */
  gaplessPlayback: boolean
  /** Whether to pause playback when headphones/audio devices unplug. */
  pauseOnUnplug: boolean
  /** Whether closing the main window minimizes to system tray (desktop only). */
  closeToTray: boolean
  /** Custom download directory path. */
  downloadDir?: string
  /** Custom media cache directory path. */
  cacheDir?: string
  /** Desktop floating lyrics display settings. */
  desktopLyrics: DesktopLyricsSettings
  /** Global desktop keyboard shortcuts configuration. */
  shortcuts: GlobalShortcutsSettings
  /** Network proxy routing configuration. */
  proxy: ProxySettings
}

export const DEFAULT_DESKTOP_LYRICS_SETTINGS: DesktopLyricsSettings = {
  lineMode: 'double',
  align: 'center',
  fontFamily: 'system-ui',
  fontSize: 24,
  textColor: '#FFFFFF',
  opacity: 0.92,
}

export const DEFAULT_SHORTCUTS_SETTINGS: GlobalShortcutsSettings = {
  enabled: true,
  keybindings: {
    playPause: 'CommandOrControl+Alt+Space',
    prevTrack: 'CommandOrControl+Alt+Left',
    nextTrack: 'CommandOrControl+Alt+Right',
    volumeUp: 'CommandOrControl+Alt+Up',
    volumeDown: 'CommandOrControl+Alt+Down',
    toggleLyrics: 'CommandOrControl+Alt+L',
    toggleWindow: 'CommandOrControl+Alt+W',
    toggleLoved: 'CommandOrControl+Alt+K',
    seekForward: 'CommandOrControl+Alt+RightBracket',
    seekBackward: 'CommandOrControl+Alt+LeftBracket',
  },
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: false,
  protocol: 'http',
  host: '127.0.0.1',
  port: 7890,
  username: '',
  password: '',
  sourceRules: {},
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'zh',
  defaultVolume: 80,
  crossfadeEnabled: false,
  crossfadeDurationSeconds: 3,
  gaplessPlayback: true,
  pauseOnUnplug: true,
  closeToTray: true,
  downloadDir: '',
  cacheDir: '',
  desktopLyrics: { ...DEFAULT_DESKTOP_LYRICS_SETTINGS },
  shortcuts: {
    enabled: DEFAULT_SHORTCUTS_SETTINGS.enabled,
    keybindings: { ...DEFAULT_SHORTCUTS_SETTINGS.keybindings },
  },
  proxy: {
    ...DEFAULT_PROXY_SETTINGS,
    sourceRules: { ...DEFAULT_PROXY_SETTINGS.sourceRules },
  },
}

export interface SettingsService {
  /** Returns the current application settings snapshot. */
  get(): Promise<AppSettings>

  /** Returns the cached application settings snapshot synchronously. */
  getSync(): AppSettings

  /** Updates settings partially and persists the changes. */
  update(partial: Partial<AppSettings>): Promise<AppSettings>

  /** Resets settings back to default values. */
  reset(): Promise<AppSettings>

  /** Subscribes to settings updates. */
  onSettingsChange(listener: (settings: AppSettings) => void): Disposable
}

declare module 'cordis' {
  interface Context {
    settings: SettingsService
  }
}
