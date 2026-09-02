import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
import { CapabilityError } from '@BBeBee/protocol'
import { audioConformance } from '@BBeBee/protocol/conformance'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { AudioWebAudio } from './index.js'
import { type FakeAudioContext, createFakeAudioContext } from './fake-context.js'

/**
 * The service under test is the real one; only the engine below it is fake.
 * The graph wiring, offset arithmetic and one-shot source lifecycle are
 * therefore genuinely exercised.
 */
async function harness(): Promise<{
  ctx: Context
  audio: AudioWebAudio
  engine: FakeAudioContext
}> {
  const engine = createFakeAudioContext()
  const ctx = new Context()
  await ctx.plugin(plugin, {
    createContext: () => engine as unknown as BaseAudioContext,
    fetchBytes: async () => new ArrayBuffer(8),
  })
  await tick()
  return { ctx, audio: ctx.audio as AudioWebAudio, engine }
}

describe('core-audio-webaudio', () => {
  it('activates and claims ctx.audio', async () => {
    const { ctx } = await harness()
    expect(ctx.audio).toBeInstanceOf(AudioWebAudio)
  })

  it('wires sources into chainInput, never straight to the destination', async () => {
    // The empty splice point is the whole reason chainInput exists: effects
    // arrive at M4 without touching a playing source (docs/05 §1).
    const { audio, engine } = await harness()
    const chainInput = audio.chainInput as unknown as { outputs: Set<unknown> }
    expect(chainInput.outputs.has(engine.destination)).toBe(false)

    const master = [...chainInput.outputs][0] as { outputs: Set<unknown> }
    expect(master, 'chainInput must feed the master gain').toBeDefined()
    expect(master.outputs.has(engine.destination)).toBe(true)
  })

  it('refuses to stream where the platform has no media element', async () => {
    const { audio } = await harness()
    await expect(audio.load('https://example.org/a.mp3', { strategy: 'stream' })).rejects.toThrow(
      /media element/,
    )
  })

  it('mute restores the level it replaced', async () => {
    const { audio, engine } = await harness()
    const master = [...(audio.chainInput as unknown as { outputs: Set<unknown> }).outputs][0] as {
      gain: { value: number }
    }
    audio.setVolume(0.4)
    expect(master.gain.value).toBeCloseTo(0.4)

    audio.setMuted(true)
    expect(master.gain.value).toBe(0)

    // A volume change while muted must not un-mute, but must be remembered.
    audio.setVolume(0.7)
    expect(master.gain.value).toBe(0)

    audio.setMuted(false)
    expect(master.gain.value).toBeCloseTo(0.7)
    expect(engine.closed).toBe(false)
  })

  it('clamps volume to the 0..1 the contract promises', async () => {
    const { audio } = await harness()
    const master = [...(audio.chainInput as unknown as { outputs: Set<unknown> }).outputs][0] as {
      gain: { value: number }
    }
    audio.setVolume(5)
    expect(master.gain.value).toBe(1)
    audio.setVolume(-2)
    expect(master.gain.value).toBe(0)
  })

  it('delivers interruption and route events to their listeners', async () => {
    // The shell publishes these; the policy that reacts lives in ctx.player.
    const { audio } = await harness()
    const seen: string[] = []
    const off = audio.onInterruption((e) => void seen.push(`${e.type}:${e.shouldResume}`))
    audio.onRouteChange((e) => void seen.push(e.reason))

    audio.emitInterruption({ type: 'began', shouldResume: false })
    audio.emitRouteChange({ reason: 'device-removed' })
    off()
    audio.emitInterruption({ type: 'ended', shouldResume: true })

    expect(seen).toEqual(['began:false', 'device-removed'])
  })

  it('closes the context and detaches the graph when unloaded', async () => {
    const engine = createFakeAudioContext()
    const ctx = new Context()
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(plugin, {
      createContext: () => engine as unknown as BaseAudioContext,
      fetchBytes: async () => new ArrayBuffer(8),
    })
    await tick()
    await fiber.dispose()
    await tick()

    expect(engine.closed, 'the audio context must be closed on unload').toBe(true)
    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})

describe('the audio gate', () => {
  it('refuses a plugin that was not granted `audio`', async () => {
    // The flag capability means "may contribute nodes to the audio graph".
    // Without a check it was a manifest string with no meaning.
    const { ctx } = await harness()
    const ungranted = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-demo',
      requested: ['db:own'] as never,
    })
    await expect(ungranted.audio.load('file:///x.flac', { strategy: 'buffer' })).rejects.toThrow(
      CapabilityError,
    )
    expect(() => ungranted.audio.setVolume(0.5)).toThrow(/was not granted audio/)

    const granted = scopeContext(ctx, {
      pluginId: '@BBeBee/plugin-player',
      requested: ['audio'] as never,
    })
    await expect(
      granted.audio.load('file:///x.flac', { strategy: 'buffer' }),
    ).resolves.toBeDefined()
    expect(() => granted.audio.setVolume(0.5)).not.toThrow()
  })
})

describe(audioConformance.service, () => {
  for (const check of audioConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const { audio, engine } = await harness()
      await check.run({
        audio,
        sampleSrc: 'file:///fixtures/two-seconds.flac',
        advance: (ms) => engine.advance(ms),
      })
    })
  }
})
