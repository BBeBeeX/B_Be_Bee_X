/**
 * A mock `ctx.audio`, for testing everything above it.
 *
 * `ctx.player`'s transport is a state machine with a clock, and a state
 * machine tested against real audio is a state machine tested against a
 * stopwatch. This mock makes time an argument: nothing advances until a test
 * says so, so every transition in docs/05 §2 — including the awkward ones,
 * like an interruption during a load — is reachable and deterministic.
 *
 * It lives in `@BBeBee/protocol/conformance` rather than in the player's tests
 * because a second engine (`core-audio-rntp`, if the Stage 0 spike goes that
 * way) needs the same fixtures, and a copied mock drifts.
 */

import type {
  AudioService,
  AudioSourceHandle,
  Disposable,
  InterruptionEvent,
  LoadOptions,
  OutputDevice,
  RouteChangeEvent,
  Uri,
} from '../index.js'

export interface MockSource extends AudioSourceHandle {
  readonly src: string
  readonly opts: LoadOptions
  readonly playing: boolean
  readonly connected: boolean
  readonly disposed: boolean
}

class MockNode {
  connectedTo?: unknown
  connect(destination: unknown): unknown {
    this.connectedTo = destination
    return destination
  }
  disconnect(): void {
    this.connectedTo = undefined
  }
}

class MockHandle implements MockSource {
  readonly node = new MockNode() as unknown as AudioNode
  playing = false
  disposed = false
  position = 0
  private readonly ended = new Set<() => void>()

  constructor(
    readonly src: string,
    readonly opts: LoadOptions,
    public durationMs: number,
  ) {}

  get connected(): boolean {
    return (this.node as unknown as MockNode).connectedTo !== undefined
  }

  get positionMs(): number {
    return this.position
  }

  play(atMs?: number): void {
    if (this.disposed) return
    if (atMs !== undefined) this.position = atMs
    this.playing = true
  }

  pause(): void {
    this.playing = false
  }

  stop(): void {
    this.playing = false
    this.position = 0
  }

  onEnded(cb: () => void): Disposable {
    this.ended.add(cb)
    return () => void this.ended.delete(cb)
  }

  dispose(): void {
    this.disposed = true
    this.playing = false
    this.ended.clear()
    this.node.disconnect()
  }

  /** Advance this source's own clock, firing `onEnded` at the boundary. */
  advance(ms: number): void {
    if (!this.playing || this.disposed) return
    this.position = Math.min(this.position + ms, this.durationMs)
    if (this.position >= this.durationMs) {
      this.playing = false
      for (const cb of [...this.ended]) cb()
    }
  }

  /** End the source now, whatever its position. */
  finish(): void {
    this.position = this.durationMs
    this.playing = false
    for (const cb of [...this.ended]) cb()
  }
}

export interface MockAudioOptions {
  /** Duration reported for every loaded source. */
  durationMs?: number
}

export interface MockAudio {
  readonly service: AudioService
  /** Every load, in order, including prefetches. */
  readonly loads: { src: string; opts: LoadOptions }[]
  readonly sources: MockSource[]
  /** The source that is currently playing, if any. */
  readonly playing: MockSource | undefined
  /** Move every playing source forward. */
  advance(ms: number): void
  /** End the playing source as if it reached its natural end. */
  finish(): void
  /** Fail the next `load()` with this error. */
  failNextLoad(error: unknown): void
  /** Duration reported by subsequent loads. */
  setDuration(ms: number): void
  interrupt(event: InterruptionEvent): void
  routeChange(event: RouteChangeEvent): void
  readonly volume: number
  readonly muted: boolean
}

export function createMockAudio(options: MockAudioOptions = {}): MockAudio {
  const handles: MockHandle[] = []
  const loads: { src: string; opts: LoadOptions }[] = []
  const interruptions = new Set<(e: InterruptionEvent) => void>()
  const routes = new Set<(e: RouteChangeEvent) => void>()

  let durationMs = options.durationMs ?? 200_000
  let nextFailure: unknown
  let volume = 1
  let muted = false
  let currentTime = 0

  const chainInput = new MockNode() as unknown as GainNode
  const destination = new MockNode() as unknown as AudioNode

  const service: AudioService = {
    get context() {
      return { currentTime, sampleRate: 48_000 } as unknown as BaseAudioContext
    },
    destination,
    sampleRate: 48_000,
    outputLatencyMs: 10,
    chainInput,

    async load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
      loads.push({ src, opts })
      if (nextFailure !== undefined) {
        const error = nextFailure
        nextFailure = undefined
        throw error
      }
      opts.signal?.throwIfAborted()
      const handle = new MockHandle(src, opts, durationMs)
      handles.push(handle)
      return handle
    },

    setVolume(v: number) {
      volume = v
    },
    setMuted(m: boolean) {
      muted = m
    },

    async listOutputDevices(): Promise<OutputDevice[]> {
      return [{ id: 'default', label: 'Mock output', isDefault: true }]
    },
    async setOutputDevice(): Promise<void> {},

    onInterruption(cb) {
      interruptions.add(cb)
      return () => void interruptions.delete(cb)
    },
    onRouteChange(cb) {
      routes.add(cb)
      return () => void routes.delete(cb)
    },
  }

  return {
    service,
    loads,
    get sources() {
      return handles
    },
    get playing() {
      return handles.find((h) => h.playing && !h.disposed)
    },
    advance(ms: number) {
      currentTime += ms / 1000
      for (const handle of [...handles]) handle.advance(ms)
    },
    finish() {
      handles.find((h) => h.playing && !h.disposed)?.finish()
    },
    failNextLoad(error: unknown) {
      nextFailure = error
    },
    setDuration(ms: number) {
      durationMs = ms
    },
    interrupt(event) {
      for (const cb of [...interruptions]) cb(event)
    },
    routeChange(event) {
      for (const cb of [...routes]) cb(event)
    },
    get volume() {
      return volume
    },
    get muted() {
      return muted
    },
  }
}
