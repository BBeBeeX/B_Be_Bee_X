import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { scopeContext } from '@BBeBee/kernel'
import { CapabilityError } from '@BBeBee/protocol'
import { audioConformance } from '@BBeBee/protocol/conformance'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { AudioWebAudio } from './index.js'
import { type FakeAudioContext, createFakeAudioContext } from './fake-context.js'

/**
 * A media element, as far as a streamed handle is concerned.
 *
 * The real one is an `HTMLAudioElement` whose buffer state arrives as events;
 * this is the same surface with the events under the test's control, which is
 * what makes an underrun something a test can cause rather than wait for.
 */
class FakeMediaElement {
  src = ''
  crossOrigin: string | null = null
  currentTime = 0
  duration = 120
  paused = true
  private readonly listeners = new Map<string, Set<() => void>>()

  async play(): Promise<void> {
    this.paused = false
  }

  pause(): void {
    this.paused = true
  }

  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type)
    if (!set) this.listeners.set(type, (set = new Set()))
    set.add(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** Fire an event the way the platform would. */
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  /** Listeners still attached, so a disposed handle can be shown to leave none. */
  countListeners(): number {
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }
}

/**
 * The service under test is the real one; only the engine below it is fake.
 * The graph wiring, offset arithmetic and one-shot source lifecycle are
 * therefore genuinely exercised.
 */
async function harness(): Promise<{
  ctx: Context
  audio: AudioWebAudio
  engine: FakeAudioContext
  elements: FakeMediaElement[]
}> {
  const engine = createFakeAudioContext()
  const elements: FakeMediaElement[] = []
  const ctx = new Context()
  await ctx.plugin(plugin, {
    createContext: () => engine as unknown as BaseAudioContext,
    fetchBytes: async () => new ArrayBuffer(8),
    createMediaElement: () => {
      const element = new FakeMediaElement()
      elements.push(element)
      return element
    },
  })
  await tick()
  return { ctx, audio: ctx.audio as AudioWebAudio, engine, elements }
}

/** The one harness with no media element, for the refusal case. */
async function harnessWithoutMediaElement(): Promise<{ audio: AudioWebAudio }> {
  const ctx = new Context()
  await ctx.plugin(plugin, {
    createContext: () => createFakeAudioContext() as unknown as BaseAudioContext,
    fetchBytes: async () => new ArrayBuffer(8),
    // Explicitly none: `defaultMediaElementFactory()` finds nothing in Node,
    // and saying so here keeps the case honest if that ever changes.
    createMediaElement: undefined,
  })
  await tick()
  return { audio: ctx.audio as AudioWebAudio }
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
    const { audio } = await harnessWithoutMediaElement()
    await expect(audio.load('https://example.org/a.mp3', { strategy: 'stream' })).rejects.toThrow(
      /media element/,
    )
  })

  it('streams through a media element, wired into chainInput like any source', async () => {
    const { audio, engine, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })

    expect(elements).toHaveLength(1)
    expect(elements[0]!.src).toBe('https://example.org/a.mp3')
    // CORS mode, or the wrapped element's node outputs silence — see
    // `MediaElementLike.crossOrigin`.
    expect(elements[0]!.crossOrigin).toBe('anonymous')
    expect(engine.mediaSources, 'the element is wrapped, not played on its own').toHaveLength(1)
    expect(source.node).toBe(engine.mediaSources[0]!.node)
  })

  it('reports the element clock when playback starts at zero', async () => {
    /*
     * `attach` starts every streamed track with `play(0)`. The element is
     * already at 0, so no seek happens and no `seeked` event ever fires — and
     * a pending-seek marker recorded there reported 0 as the position for the
     * whole track while the audio played.
     */
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })

    source.play(0)
    elements[0]!.currentTime = 5
    expect(source.positionMs).toBe(5000)
  })

  it('reports a real seek target until the element lands it', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })

    elements[0]!.currentTime = 30
    source.play(12_000)
    expect(elements[0]!.currentTime, 'the element was asked to move').toBe(12)
    expect(source.positionMs).toBe(12_000)

    // The element's clock is authoritative once the seek lands.
    elements[0]!.emit('seeked')
    elements[0]!.currentTime = 13
    expect(source.positionMs).toBe(13_000)
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

describe('stalls', () => {
  it('maps the element\u2019s buffer events onto the contract\u2019s shape', async () => {
    // `waiting` is what a starved element sends; `playing` is the honest
    // recovery, because `canplay` fires while still paused (docs/05 §2).
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const seen: boolean[] = []
    source.onStalled((stalled) => void seen.push(stalled))

    elements[0]!.emit('waiting')
    elements[0]!.emit('playing')

    expect(seen).toEqual([true, false])
  })

  it('publishes a change, not every event', async () => {
    // A slow network sends `waiting` over and over. A player that took each
    // one as a fresh stall would restart its recovery timeout on every one,
    // turning "gives up after 30 seconds" into "never gives up".
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const seen: boolean[] = []
    source.onStalled((stalled) => void seen.push(stalled))

    elements[0]!.emit('waiting')
    elements[0]!.emit('stalled')
    elements[0]!.emit('waiting')

    expect(seen).toEqual([true])
  })

  it('a decoded buffer never stalls, and leaks no listener for saying so', async () => {
    const { audio } = await harness()
    const source = await audio.load('file:///music/a.flac', { strategy: 'buffer' })
    let called = false
    const off = source.onStalled(() => void (called = true))

    off()
    source.play()
    expect(called).toBe(false)
  })

  it('a disposed streamed source stops listening', async () => {
    const { audio, elements } = await harness()
    const source = await audio.load('https://example.org/a.mp3', { strategy: 'stream' })
    const seen: boolean[] = []
    source.onStalled((stalled) => void seen.push(stalled))

    source.dispose()
    elements[0]!.emit('waiting')

    expect(seen).toEqual([])
    expect(elements[0]!.countListeners(), 'every handler is removed, not just muted').toBe(0)
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
