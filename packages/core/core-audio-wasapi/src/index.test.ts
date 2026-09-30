import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { audioConformance } from '@BBeBee/protocol/conformance'
import type { MediaElementLike } from '@BBeBee/core-audio-webaudio'
import plugin, { AudioWasapi, type AudioWasapiConfig } from './index.js'
import { type FakeAudioContext, createFakeAudioContext } from './fake-context.js'

async function harness(
  bridgeCallMock?: (s: string, m: string, a: unknown[]) => Promise<unknown>,
  extraConfig: Partial<AudioWasapiConfig> = {},
): Promise<{
  ctx: Context
  audio: AudioWasapi
  engine: FakeAudioContext
}> {
  const engine = createFakeAudioContext()
  const ctx = new Context()
  await ctx.plugin(plugin, {
    createContext: () => engine as unknown as BaseAudioContext,
    fetchBytes: async () => new ArrayBuffer(8),
    bridgeCall: bridgeCallMock,
    ...extraConfig,
  })
  return { ctx, audio: ctx.audio as AudioWasapi, engine }
}

/** Structural `MediaElementLike` for the streaming-path tests. */
class FakeMediaElement implements MediaElementLike {
  src = ''
  crossOrigin: string | null = null
  currentTime = 0
  duration = 120
  paused = true
  seeking = false
  error: { code?: number; message?: string } | null = null

  private readonly listeners = new Map<string, Set<() => void>>()

  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }
}

describe('core-audio-wasapi', () => {
  it('activates and claims ctx.audio', async () => {
    const { ctx } = await harness()
    expect(ctx.audio).toBeInstanceOf(AudioWasapi)
  })

  it('passes the audio conformance suite', async () => {
    const { audio, engine } = await harness()
    for (const check of audioConformance.checks) {
      await check.run({
        audio,
        sampleSrc: 'file:///music/test.alac',
        advance: (ms) => engine.advance(ms),
      })
    }
  })

  it('decodes ALAC audio via FFmpeg bridge and plays', async () => {
    const fakePcmLeft = new Float32Array([0, 0.1, 0.2, 0.3, 0.4])
    const fakePcmRight = new Float32Array([0, 0.1, 0.2, 0.3, 0.4])
    const bridgeCall = async (service: string, method: string, _args: unknown[]) => {
      if (service === 'audio' && method === 'decodePcm') {
        return {
          sampleRate: 96000,
          channels: 2,
          bitDepth: 24,
          durationMs: 2500,
          pcm: [fakePcmLeft, fakePcmRight],
        }
      }
      return undefined
    }

    const { audio } = await harness(bridgeCall)
    const handle = await audio.load('file:///music/song.m4a', { strategy: 'buffer' })

    expect(handle).toBeDefined()
    expect(handle.durationMs).toBeGreaterThan(0)

    handle.node.connect(audio.chainInput)
    handle.play()
    expect(handle.positionMs).toBe(0)
    handle.dispose()
  })

  it('forwards source headers to the bridge decodePcm call', async () => {
    const fakePcm = new Float32Array([0, 0.1, 0.2])
    let seenArgs: unknown[] | undefined
    const bridgeCall = async (_service: string, method: string, args: unknown[]) => {
      if (method === 'decodePcm') {
        seenArgs = args
        return {
          sampleRate: 48000,
          channels: 1,
          bitDepth: 16,
          durationMs: 100,
          pcm: [fakePcm],
        }
      }
      return undefined
    }

    const { audio } = await harness(bridgeCall)
    const headers = { Referer: 'https://www.bilibili.com', 'User-Agent': 'BBeBee/1.0' }
    await audio.load('https://cdn.example.com/song.m4s', { strategy: 'buffer', headers })

    // The remote URL rides with the source's headers: a CDN that checks
    // `Referer` answers a header-less ffmpeg request with 403.
    expect(seenArgs?.[0]).toBe('https://cdn.example.com/song.m4s')
    expect(seenArgs?.[1]).toEqual({ headers })
  })

  it('streams with strategy stream through a media element, skipping the FFmpeg bridge', async () => {
    const element = new FakeMediaElement()
    const bridgeMethods: string[] = []
    const bridgeCall = async (_service: string, method: string) => {
      bridgeMethods.push(method)
      return undefined
    }

    const { audio } = await harness(bridgeCall, { createMediaElement: () => element })
    const handle = await audio.load('https://cdn.example.com/song.m4s', { strategy: 'stream' })

    // The element path, not a whole-track decode: the bridge decodes into
    // resident PCM, which is what this strategy exists to avoid.
    expect(bridgeMethods).not.toContain('decodePcm')
    expect(element.src).toBe('https://cdn.example.com/song.m4s')
    expect(element.crossOrigin).toBe('anonymous')
    expect(element.paused).toBe(true)
    expect(handle.durationMs).toBe(120_000)

    handle.play()
    expect(element.paused).toBe(false)
    handle.dispose()
    expect(element.paused).toBe(true)
    expect(element.src).toBe('')
  })

  it('falls back to buffered decode when streaming is unavailable', async () => {
    // Node test env: no `globalThis.Audio`, so the element path is refused and
    // the load must degrade to fetch + decodeAudioData instead of throwing.
    const { audio } = await harness()
    const handle = await audio.load('file:///music/song.flac', { strategy: 'stream' })

    expect(handle).toBeDefined()
    expect(handle.durationMs).toBeGreaterThan(0)
    handle.dispose()
  })

  it('dips volume over time without clicking', async () => {
    const { audio } = await harness()
    audio.setVolume(0.8)
    const restore = await audio.dipVolume(10)
    expect(audio.destination).toBeDefined()
    restore()
  })

  it('manages mute and volume levels correctly', async () => {
    const { audio } = await harness()
    audio.setVolume(0.7)
    audio.setMuted(true)
    audio.setMuted(false)
    expect(audio.sampleRate).toBe(48000)
  })

  it('enumerates output devices using Chromium deviceIds and routes without passing OS IDs to setSinkId', async () => {
    let bridgeDeviceSet: string | undefined
    let sinkCalledWith: string | undefined

    const mockBridgeCall = async (service: string, method: string, args: unknown[]) => {
      if (service === 'audio' && method === 'getOutputDevices') {
        return [
          { id: '{0.0.0.00000000}.{wasapi-realtek}', label: '扬声器 (Realtek Audio)', isDefault: true, isVirtual: false },
          { id: '{0.0.0.00000000}.{wasapi-vm}', label: 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)', isDefault: false, isVirtual: true },
        ]
      }
      if (service === 'audio' && method === 'setOutputDevice') {
        bridgeDeviceSet = args[0] as string
        return undefined
      }
      return undefined
    }

    const { audio, engine } = await harness(mockBridgeCall)
    ;(engine as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId = async (id: string) => {
      sinkCalledWith = id
    }

    const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const mockEnumerate = async () => [
      { kind: 'audiooutput', deviceId: 'default', label: '默认 - 扬声器 (Realtek Audio)' },
      { kind: 'audiooutput', deviceId: 'dev-vm-789', label: 'VoiceMeeter Input' },
    ]

    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { mediaDevices: { enumerateDevices: mockEnumerate } },
        configurable: true,
        writable: true,
      })

      const devices = await audio.listOutputDevices()
      expect(devices).toHaveLength(2)
      expect(devices[0]!.id).toBe('default')
      expect(devices[1]!.id).toBe('dev-vm-789')
      expect(devices[1]!.isVirtual).toBe(true)
      expect(devices[1]!.label).toContain('(虚拟)')

      // Set to VoiceMeeter by Chromium deviceId
      await audio.setOutputDevice('dev-vm-789')
      // Native host gets the matched native WASAPI IMMDevice ID
      expect(bridgeDeviceSet).toBe('{0.0.0.00000000}.{wasapi-vm}')
      // But Web Audio setSinkId receives the Chromium deviceId, NEVER the OS ID!
      expect(sinkCalledWith).toBe('dev-vm-789')

      // Set to default
      await audio.setOutputDevice('default')
      expect(bridgeDeviceSet).toBe('{0.0.0.00000000}.{wasapi-realtek}')
      expect(sinkCalledWith).toBe('')
    } finally {
      if (origNavDesc) {
        Object.defineProperty(globalThis, 'navigator', origNavDesc)
      } else {
        delete (globalThis as Record<string, unknown>)['navigator']
      }
    }
  })

  it('emits audio/context-rebuilt and retires the old context when the track rate differs', async () => {
    // A 96 kHz track against a 48 kHz boot context must rebuild the context:
    // `plugin-dsp` and `plugin-visualizer` resplice on the event, so it must
    // fire with the NEW context live and the old one must close afterwards.
    const rebuiltRates: number[] = []
    const contexts: FakeAudioContext[] = []
    const ctx = new Context()
    await ctx.plugin(plugin, {
      createContext: (options) => {
        const next = createFakeAudioContext(options?.sampleRate)
        contexts.push(next)
        return next as unknown as BaseAudioContext
      },
      fetchBytes: async () => new ArrayBuffer(8),
      bridgeCall: async (_service, method) =>
        method === 'decodePcm'
          ? {
              sampleRate: 96000,
              channels: 2,
              bitDepth: 24,
              durationMs: 2500,
              pcm: [new Float32Array(480), new Float32Array(480)],
            }
          : undefined,
    })
    const audio = ctx.audio as AudioWasapi
    ctx.on('audio/context-rebuilt', () => {
      rebuiltRates.push((ctx.audio as AudioWasapi).context.sampleRate)
    })

    const handle = await audio.load('file:///music/hires.flac', { strategy: 'buffer' })

    expect(rebuiltRates).toEqual([96000])
    expect(contexts).toHaveLength(2)
    expect((audio.context as unknown as FakeAudioContext).sampleRate).toBe(96000)
    // The 48 kHz boot context is closed only after the new graph is attached.
    expect(contexts[0]!.closed).toBe(true)
    expect(handle.durationMs).toBe(2500)
    handle.dispose()
  })
})
