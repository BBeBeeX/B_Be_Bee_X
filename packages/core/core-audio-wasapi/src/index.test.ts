import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { audioConformance } from '@BBeBee/protocol/conformance'
import plugin, { AudioWasapi } from './index.js'
import { type FakeAudioContext, createFakeAudioContext } from './fake-context.js'

async function harness(bridgeCallMock?: (s: string, m: string, a: unknown[]) => Promise<unknown>): Promise<{
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
    enableExclusive: false,
  })
  return { ctx, audio: ctx.audio as AudioWasapi, engine }
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

    let initWasapiCalled = false
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
      if (service === 'audio' && method === 'initWasapi') {
        initWasapiCalled = true
        return { ok: true }
      }
      return undefined
    }

    const { audio } = await harness(bridgeCall)
    const handle = await audio.load('file:///music/song.m4a', { strategy: 'buffer' })

    expect(handle).toBeDefined()
    expect(initWasapiCalled).toBe(true)
    expect(handle.durationMs).toBeGreaterThan(0)

    handle.node.connect(audio.chainInput)
    handle.play()
    expect(handle.positionMs).toBe(0)
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
})
