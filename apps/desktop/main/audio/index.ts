import { FfmpegDecoder } from './ffmpeg-decoder.js'
import { WasapiEngine, type AudioMainLogger } from './wasapi-engine.js'
import type { AudioDecodedPcm, AudioProbeResult, WasapiInitConfig, WasapiInitResult } from './types.js'

export * from './types.js'
export { FfmpegDecoder, WasapiEngine, type AudioMainLogger }

export interface AudioHostApi {
  probe(uri: string): Promise<AudioProbeResult>
  decodePcm(uri: string): Promise<AudioDecodedPcm>
  initWasapi(config: WasapiInitConfig): Promise<WasapiInitResult>
  writeWasapi(pcmChunk: Float32Array): Promise<number>
  stopWasapi(): Promise<void>
  getOutputDevices(): Promise<{ id: string; label: string; isDefault: boolean }[]>
  setOutputDevice(id: string): Promise<void>
}

export function createAudioHost(logger?: AudioMainLogger): AudioHostApi {
  const decoder = new FfmpegDecoder()
  const wasapi = new WasapiEngine(logger)

  return {
    probe: (uri) => decoder.probe(uri),
    decodePcm: (uri) => decoder.decodePcm(uri),
    initWasapi: (config) => wasapi.init(config),
    writeWasapi: (pcm) => wasapi.write(pcm),
    stopWasapi: () => wasapi.stop(),
    getOutputDevices: () => wasapi.getOutputDevices(),
    setOutputDevice: (id) => wasapi.setOutputDevice(id),
  }
}
