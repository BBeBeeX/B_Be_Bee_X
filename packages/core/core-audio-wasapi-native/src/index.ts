import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  NativeAudioDevice,
  NativeWasapiInitConfig,
  NativeWasapiInitResult,
  WasapiNativeBinding,
} from './types.js'

export * from './types.js'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

interface RawNativeModule {
  wasapiIsSupported?: () => boolean
  wasapiInit?: (
    deviceId: string | null | undefined,
    sampleRate: number,
    channels: number,
    bitDepth: number,
    bufferMs: number,
  ) => NativeWasapiInitResult
  wasapiWrite?: (pcm: Float32Array) => number
  wasapiStop?: () => void
  wasapiGetDevices?: () => NativeAudioDevice[]
}

function tryLoadNative(): RawNativeModule | null {
  if (process.platform !== 'win32') {
    return null
  }

  const unpackedDir = __dirname.replace('app.asar', 'app.asar.unpacked')

  const candidates = [
    join(__dirname, '../core_audio_wasapi_native.win32-x64-msvc.node'),
    join(unpackedDir, '../core_audio_wasapi_native.win32-x64-msvc.node'),
    join(__dirname, '../core_audio_wasapi_native.node'),
    join(unpackedDir, '../core_audio_wasapi_native.node'),
    join(__dirname, '../index.node'),
    join(unpackedDir, '../index.node'),
    join(__dirname, '../../../../target/release/core_audio_wasapi_native.node'),
    join(unpackedDir, '../../../../target/release/core_audio_wasapi_native.node'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return require(candidate) as RawNativeModule
      } catch {
        // continue
      }
    }
  }

  return null
}

const raw = tryLoadNative()

export const wasapiNative: WasapiNativeBinding = {
  isSupported(): boolean {
    return raw?.wasapiIsSupported?.() ?? false
  },

  init(config: NativeWasapiInitConfig): NativeWasapiInitResult {
    if (!raw?.wasapiInit) {
      return {
        ok: false,
        error: 'WASAPI native driver not loaded or platform unsupported',
      }
    }
    return raw.wasapiInit(
      config.deviceId ?? null,
      config.sampleRate,
      config.channels,
      config.bitDepth ?? 16,
      config.bufferMs ?? 50,
    )
  },

  write(pcm: Float32Array): number {
    return raw?.wasapiWrite?.(pcm) ?? 0
  },

  stop(): void {
    raw?.wasapiStop?.()
  },

  getDevices(): NativeAudioDevice[] {
    return raw?.wasapiGetDevices?.() ?? []
  },
}

export default wasapiNative
