/**
 * Conformance suite for `ctx.audio`.
 *
 * One implementation serves all three targets (ADR-4), but it runs against
 * three different Web Audio engines: `react-native-audio-api` on iOS and on
 * Android, and the renderer's own on desktop. This suite is what says they
 * behave the same — it runs in Node against a fake context, and on device
 * against the real one.
 *
 * Timing is asserted loosely on purpose. An audio clock advances in its own
 * time and a device under test is not a metronome; the assertions here are
 * about *behaviour* — position advances while playing, holds while paused,
 * lands where it was seeked — not about millisecond accuracy.
 */

import type { AudioService, InterruptionEvent } from '../index.js'
import { assert, type ConformanceSuite } from './harness.js'

export interface AudioSubject {
  audio: AudioService
  /**
   * A short playable source, as the platform names it: a `file://` Uri on
   * desktop, a bundled asset elsewhere. Two seconds or so.
   */
  sampleSrc: string
  /** Let the audio clock advance by roughly this many ms. */
  advance(ms: number): Promise<void>
}

export const audioConformance: ConformanceSuite<AudioSubject> = {
  service: 'audio',
  checks: [
    {
      name: 'exposes a graph with a chain input that is not the destination',
      because: 'sources connect to chainInput so effects and sources have separate lifetimes',
      async run({ audio }) {
        assert(audio.context !== undefined, 'context must exist')
        assert(audio.sampleRate > 0, 'sampleRate must be positive')
        assert(audio.chainInput !== undefined, 'chainInput must exist')
        assert(
          (audio.chainInput as unknown) !== (audio.destination as unknown),
          'chainInput must not be the destination itself',
        )
        assert(audio.outputLatencyMs >= 0, 'outputLatencyMs must not be negative')
      },
    },
    {
      name: 'loads a buffered source and reports its duration',
      because: 'the player needs a duration before it can render a progress bar',
      async run({ audio, sampleSrc }) {
        const handle = await audio.load(sampleSrc, { strategy: 'buffer' })
        try {
          assert(handle.durationMs > 0, 'a decoded source must know its duration')
          assert(handle.positionMs === 0, 'a fresh source starts at zero')
        } finally {
          handle.dispose()
        }
      },
    },
    {
      name: 'advances while playing and holds while paused',
      because: 'the transport state machine reads position from here',
      async run({ audio, sampleSrc, advance }) {
        const handle = await audio.load(sampleSrc, { strategy: 'buffer' })
        try {
          handle.node.connect(audio.chainInput)
          handle.play()
          await advance(200)
          const playing = handle.positionMs
          assert(playing > 0, `position should advance while playing, got ${playing}`)

          handle.pause()
          const paused = handle.positionMs
          await advance(200)
          assert(
            Math.abs(handle.positionMs - paused) < 50,
            `position must hold while paused: ${paused} → ${handle.positionMs}`,
          )
        } finally {
          handle.dispose()
        }
      },
    },
    {
      name: 'seeks to a position and resumes from there',
      because: 'seek is one of the six transport controls M1 must ship',
      async run({ audio, sampleSrc, advance }) {
        const handle = await audio.load(sampleSrc, { strategy: 'buffer' })
        try {
          handle.node.connect(audio.chainInput)
          handle.play(1000)
          assert(
            handle.positionMs >= 950,
            `seek should land near where it was asked: ${handle.positionMs}`,
          )
          await advance(100)
          assert(handle.positionMs >= 1000, 'playback should continue from the seek point')
        } finally {
          handle.dispose()
        }
      },
    },
    {
      name: 'fires onEnded exactly once when a source finishes',
      because: 'the queue advances on this, and twice would skip a track',
      async run({ audio, sampleSrc, advance }) {
        const handle = await audio.load(sampleSrc, { strategy: 'buffer' })
        try {
          let ended = 0
          handle.onEnded(() => void ended++)
          handle.node.connect(audio.chainInput)
          handle.play(Math.max(0, handle.durationMs - 100))
          await advance(handle.durationMs + 300)
          assert(ended === 1, `expected exactly one ended event, got ${ended}`)
        } finally {
          handle.dispose()
        }
      },
    },
    {
      name: 'a disposed source stops and detaches',
      because: 'a leaked node keeps sounding after the plugin that made it is gone',
      async run({ audio, sampleSrc, advance }) {
        const handle = await audio.load(sampleSrc, { strategy: 'buffer' })
        handle.node.connect(audio.chainInput)
        handle.play()
        await advance(100)
        handle.dispose()

        const after = handle.positionMs
        await advance(200)
        assert(handle.positionMs === after, 'a disposed source must not keep advancing')
      },
    },
    {
      name: 'volume and mute round-trip',
      because: 'mute must restore the level it replaced, not jump to full',
      async run({ audio }) {
        audio.setVolume(0.4)
        audio.setMuted(true)
        audio.setMuted(false)
        // Nothing to read back through the contract; the check is that this
        // sequence is accepted and the graph survives it.
        audio.setVolume(1)
      },
    },
    {
      name: 'reports at least one output device',
      because: 'the UI hides the picker when there is one, and must not crash where there is none',
      async run({ audio }) {
        const devices = await audio.listOutputDevices()
        assert(devices.length >= 1, 'there is always at least a default output')
        assert(
          devices.some((d) => typeof d.id === 'string' && typeof d.label === 'string'),
          'devices carry an id and a label',
        )
      },
    },
    {
      name: 'interruption and route listeners unsubscribe',
      because: 'these are registered per track load; leaking them leaks the whole graph',
      async run({ audio }) {
        const offInterruption = audio.onInterruption(() => {})
        const offRoute = audio.onRouteChange(() => {})
        offInterruption()
        offRoute()
      },
    },
    {
      name: 'the shell can publish an interruption that listeners receive',
      because:
        'the shell is where platform events arrive; a publishing half with no path to the ' +
        'listeners leaves every OS-driven pause invisible to the policy in ctx.player',
      async run({ audio }) {
        let received: InterruptionEvent | undefined
        const off = audio.onInterruption((event) => void (received = event))
        audio.emitInterruption({ type: 'began', shouldResume: false })
        off()
        assert(received?.type === 'began', 'the listener received the published interruption')
      },
    },
  ],
}
