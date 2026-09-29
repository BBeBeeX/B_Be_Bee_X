/**
 * `plugin-visualizer` — real-time audio visualization service.
 *
 * Implements `ctx.visualizer`:
 * - Connects an AnalyserNode to the audio graph output.
 * - Extracts real-time frequency spectrum and waveform buffers.
 * - Persists and synchronizes visualization preferences.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  AppSettings,
  SettingsService,
  VisualizerService,
  VisualizerSettings,
} from '@BBeBee/protocol'
import { DEFAULT_VISUALIZER_SETTINGS } from '@BBeBee/protocol'

export * from './views.js'
export * from './hooks.js'

export class VisualizerPlugin extends Service implements VisualizerService {
  static override readonly name = 'visualizer'
  static readonly inject = ['audio', 'settings']

  private readonly ownCtx: Context
  private currentSettings: VisualizerSettings = { ...DEFAULT_VISUALIZER_SETTINGS }
  private analyser: AnalyserNode | null = null
  private connectedSource: AudioNode | null = null

  constructor(ctx: Context) {
    super(ctx, 'visualizer')
    this.ownCtx = ctx
  }

  get settings(): Readonly<VisualizerSettings> {
    return this.currentSettings
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-visualizer: initialized')

    // 1. Initialize settings from settings service
    const settingsService = (
      this.ownCtx as unknown as { settings?: SettingsService }
    ).settings
    if (settingsService) {
      try {
        const initial = settingsService.getSync()
        if (initial?.visualizer) {
          this.currentSettings = { ...this.currentSettings, ...initial.visualizer }
        }
      } catch {
        // ignore synchronous read failure
      }

      void settingsService.get().then((appSettings: AppSettings) => {
        if (appSettings?.visualizer) {
          this.currentSettings = { ...this.currentSettings, ...appSettings.visualizer }
          this.updateAnalyserConfig()
        }
      })

      this.ownCtx.on('settings/changed', (appSettings: AppSettings) => {
        if (appSettings?.visualizer) {
          this.currentSettings = { ...this.currentSettings, ...appSettings.visualizer }
          this.updateAnalyserConfig()
        }
      })
    }

    // 2. Attach Web Audio analyser node
    this.attachAnalyser()

    // Re-attach analyser when audio engine changes
    const offEngine = this.ownCtx.on('audio/engine-changed', () => {
      this.ownCtx.logger.info('plugin-visualizer: audio engine changed, re-attaching analyser')
      this.detachAnalyser()
      this.attachAnalyser()
    })

    // Teardown
    return () => {
      this.ownCtx.logger.info('plugin-visualizer: disposing')
      offEngine()
      this.detachAnalyser()
    }
  }

  private attachAnalyser(): void {
    try {
      const audioCtx = this.ownCtx.audio?.context
      if (!audioCtx || typeof audioCtx.createAnalyser !== 'function') {
        this.ownCtx.logger.debug('visualizer: AudioContext does not support createAnalyser')
        return
      }

      this.analyser = audioCtx.createAnalyser()
      this.updateAnalyserConfig()

      const source = this.ownCtx.audio.chainOutput ?? this.ownCtx.audio.chainInput
      if (source && typeof source.connect === 'function') {
        source.connect(this.analyser)
        this.connectedSource = source
        this.ownCtx.logger.debug('visualizer: AnalyserNode connected to audio output tap')
      }
    } catch (err) {
      this.ownCtx.logger.warn('visualizer: failed to create or attach AnalyserNode', err)
    }
  }

  private updateAnalyserConfig(): void {
    if (!this.analyser) return
    const targetFftSize = this.currentSettings.fftSize || 128
    // fftSize must be power of 2 between 32 and 32768
    if (this.analyser.fftSize !== targetFftSize) {
      try {
        this.analyser.fftSize = targetFftSize
      } catch {
        // ignore invalid fft size
      }
    }
    this.analyser.smoothingTimeConstant = 0.82
  }

  private detachAnalyser(): void {
    if (this.connectedSource && this.analyser) {
      try {
        this.connectedSource.disconnect(this.analyser)
      } catch {
        // ignore disconnect failure in test or mock environments
      }
    }
    this.connectedSource = null
    this.analyser = null
  }

  getFrequencyData(array: Uint8Array): void {
    if (!this.analyser) {
      array.fill(0)
      return
    }
    this.analyser.getByteFrequencyData(array as unknown as Uint8Array<ArrayBuffer>)
    // Apply sensitivity multiplier if needed
    const mult = this.currentSettings.sensitivity ?? 1.0
    if (mult !== 1.0) {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.min(255, Math.round((array[i] ?? 0) * mult))
      }
    }
  }

  getTimeDomainData(array: Uint8Array): void {
    if (!this.analyser) {
      array.fill(128)
      return
    }
    this.analyser.getByteTimeDomainData(array as unknown as Uint8Array<ArrayBuffer>)
    const mult = this.currentSettings.sensitivity ?? 1.0
    if (mult !== 1.0) {
      for (let i = 0; i < array.length; i++) {
        const val = (array[i] ?? 128) - 128
        array[i] = Math.min(255, Math.max(0, Math.round(128 + val * mult)))
      }
    }
  }

  async updateSettings(patch: Partial<VisualizerSettings>): Promise<void> {
    this.currentSettings = { ...this.currentSettings, ...patch }
    this.updateAnalyserConfig()

    const settingsService = (
      this.ownCtx as unknown as { settings?: SettingsService }
    ).settings
    if (settingsService) {
      const current = await settingsService.get()
      await settingsService.update({
        visualizer: {
          ...(current.visualizer ?? DEFAULT_VISUALIZER_SETTINGS),
          ...patch,
        },
      })
    }
  }
}

export const name = 'plugin-visualizer'
export const inject = ['audio', 'settings']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-visualizer: loaded')
  const fiber = await ctx.plugin(VisualizerPlugin)
  return () => {
    fiber.dispose()
  }
}

export default { name, inject, apply }
