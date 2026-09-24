import type { WasapiInitConfig, WasapiInitResult } from './types.js'

export class WasapiEngine {
  private activeConfig?: WasapiInitConfig
  private isRunning = false
  private totalFramesWritten = 0

  async isSupported(): Promise<boolean> {
    return process.platform === 'win32'
  }

  async init(config: WasapiInitConfig): Promise<WasapiInitResult> {
    this.activeConfig = config
    this.isRunning = true
    this.totalFramesWritten = 0

    const bufferMs = config.bufferMs || 50
    const bufferSizeFrames = Math.round((config.sampleRate * bufferMs) / 1000)

    return {
      ok: true,
      bufferSizeFrames,
      actualSampleRate: config.sampleRate,
      actualBitDepth: config.bitDepth || 24,
    }
  }

  async write(pcmChunk: Float32Array): Promise<number> {
    if (!this.isRunning || !this.activeConfig) return 0

    const channels = this.activeConfig.channels || 2
    const frames = Math.floor(pcmChunk.length / channels)
    this.totalFramesWritten += frames

    return frames
  }

  async stop(): Promise<void> {
    this.isRunning = false
    this.activeConfig = undefined
  }

  private selectedDeviceId: string = 'default'

  async getOutputDevices(): Promise<{ id: string; label: string; isDefault: boolean }[]> {
    if (process.platform === 'win32') {
      return [
        { id: 'default-wasapi-exclusive', label: 'Default Windows Audio Endpoint (WASAPI Exclusive)', isDefault: true }
      ]
    }
    return [
      { id: 'system-default', label: 'Default Audio Output Device', isDefault: true }
    ]
  }

  async setOutputDevice(id: string): Promise<void> {
    this.selectedDeviceId = id
  }
}
