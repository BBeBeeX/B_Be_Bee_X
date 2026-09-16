/**
 * `ctx.settings` — global application preferences and configuration service.
 */

// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'

export interface AppSettings {
  /** Visual appearance theme. */
  theme: 'dark' | 'light' | 'system'
  /** User interface language. */
  language: 'zh' | 'en' | 'system'
  /** Default startup playback volume (0 to 100). */
  defaultVolume: number
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
