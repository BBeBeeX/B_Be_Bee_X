export interface AudioProbeResult {
  sampleRate: number
  channels: number
  bitDepth?: number
  durationMs?: number
  format?: string
  codec?: string
}

export interface AudioDecodedPcm {
  sampleRate: number
  channels: number
  bitDepth: number
  durationMs: number
  /** Deinterleaved channel PCM data */
  pcm: Float32Array[]
}

export interface WasapiInitConfig {
  sampleRate: number
  channels: number
  bitDepth?: number
  bufferMs?: number
}

export interface WasapiInitResult {
  ok: boolean
  bufferSizeFrames?: number
  actualSampleRate?: number
  actualBitDepth?: number
  error?: string
}
