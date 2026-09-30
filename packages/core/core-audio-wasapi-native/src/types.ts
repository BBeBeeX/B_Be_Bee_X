export interface NativeAudioDevice {
  id: string
  label: string
  isDefault: boolean
  isVirtual?: boolean
}

export interface NativeWasapiInitConfig {
  deviceId?: string
  sampleRate: number
  channels: number
  bitDepth?: number
  bufferMs?: number
}

export interface NativeWasapiInitResult {
  ok: boolean
  bufferSizeFrames?: number
  actualSampleRate?: number
  actualBitDepth?: number
  error?: string
}

export interface WasapiNativeBinding {
  isSupported(): boolean
  init(config: NativeWasapiInitConfig): NativeWasapiInitResult
  write(pcm: Float32Array): number
  stop(): void
  getDevices(): NativeAudioDevice[]
}
