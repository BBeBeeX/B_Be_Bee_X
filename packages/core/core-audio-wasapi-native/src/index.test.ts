import { describe, expect, it } from 'vitest'
import { wasapiNative } from './index.js'

describe('core-audio-wasapi-native loader', () => {
  it('exposes the WasapiNativeBinding interface', () => {
    expect(wasapiNative).toBeDefined()
    expect(typeof wasapiNative.isSupported).toBe('function')
    expect(typeof wasapiNative.init).toBe('function')
    expect(typeof wasapiNative.write).toBe('function')
    expect(typeof wasapiNative.stop).toBe('function')
    expect(typeof wasapiNative.getDevices).toBe('function')
  })

  it('handles unsupported platforms or unbuilt native modules gracefully', () => {
    if (process.platform !== 'win32') {
      expect(wasapiNative.isSupported()).toBe(false)
      const res = wasapiNative.init({
        sampleRate: 48000,
        channels: 2,
      })
      expect(res.ok).toBe(false)
      expect(res.error).toBeDefined()
      expect(wasapiNative.write(new Float32Array(512))).toBe(0)
      expect(wasapiNative.getDevices()).toEqual([])
    }
  })
})
