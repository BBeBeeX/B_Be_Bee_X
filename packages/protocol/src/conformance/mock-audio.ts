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
  stalled = false
  private readonly ended = new Set<() => void>()
  private readonly stalls = new Set<(stalled: boolean) => void>()

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

  onStalled(cb: (stalled: boolean) => void): Disposable {
    this.stalls.add(cb)
    return () => void this.stalls.delete(cb)
  }

  dispose(): void {
    this.disposed = true
    this.playing = false
    this.ended.clear()
    this.stalls.clear()
    this.node.disconnect()
  }

  /**
   * Report a buffer underrun, or its recovery.
   *
   * Only a change is published, matching what a real engine does with an
   * element that sends `waiting` repeatedly under a slow network.
   */
  setStalled(stalled: boolean): void {
    if (this.disposed || this.stalled === stalled) return
    this.stalled = stalled
    for (const cb of [...this.stalls]) cb(stalled)
  }

  /**
   * Advance this source's own clock, firing `onEnded` at the boundary.
   *
   * A stalled source does not advance — that is what a stall *is*, and a mock
   * whose position kept climbing through one would let the player pass a test
   * it fails in the world.
   */
  advance(ms: number): void {
    if (!this.playing || this.disposed || this.stalled) return
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
  /** Underrun the playing source, or let it recover. */
  stall(stalled: boolean): void
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
  const chainOutput = new MockNode() as unknown as GainNode
  const destination = new MockNode() as unknown as AudioNode

  const service: AudioService = {
    get context() {
      return { currentTime, sampleRate: 48_000 } as unknown as BaseAudioContext
    },
    destination,
    sampleRate: 48_000,
    outputLatencyMs: 10,
    chainInput,
    chainOutput,

    async dipVolume() {
      return () => {}
    },

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
    stall(stalled: boolean) {
      // A stalled source stays `playing`: it was never paused, it is starved.
      // That is the distinction the whole state exists to make, so the lookup
      // finds the same handle on the way in and on the way out.
      handles.find((h) => h.playing && !h.disposed)?.setStalled(stalled)
    },
    get volume() {
      return volume
    },
    get muted() {
      return muted
    },
  }
}
