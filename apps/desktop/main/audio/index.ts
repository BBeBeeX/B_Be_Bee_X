import { FfmpegDecoder } from './ffmpeg-decoder.js'
import { AudioDeviceEnumerator, type AudioMainLogger } from './audio-devices.js'
import type { AudioDecodedPcm, AudioProbeResult, AudioRequestOptions } from './types.js'

export * from './types.js'
export { FfmpegDecoder } from './ffmpeg-decoder.js'
export { AudioDeviceEnumerator, cleanAndTagDeviceLabel, type AudioMainLogger } from './audio-devices.js'

export interface AudioHostApi {
  probe(uri: string, options?: AudioRequestOptions): Promise<AudioProbeResult>
  decodePcm(uri: string, options?: AudioRequestOptions): Promise<AudioDecodedPcm>
  getOutputDevices(): Promise<{ id: string; label: string; isDefault: boolean }[]>
  setOutputDevice(id: string): Promise<void>
}

export function createAudioHost(logger?: AudioMainLogger): AudioHostApi {
  const decoder = new FfmpegDecoder()
  const devices = new AudioDeviceEnumerator(logger)

  return {
    probe: (uri, options) => decoder.probe(uri, options),
    decodePcm: (uri, options) => decoder.decodePcm(uri, options),
    getOutputDevices: () => devices.getOutputDevices(),
    setOutputDevice: (id) => devices.setOutputDevice(id),
  }
}
