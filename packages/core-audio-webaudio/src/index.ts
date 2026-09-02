/**
 * `ctx.audio` — one implementation for all three targets.
 *
 * Per ADR-4 the contract *is* the Web Audio API: `react-native-audio-api`
 * satisfies it on iOS and Android, and the same package's web build (or the
 * renderer's own `AudioContext`) satisfies it on desktop. So this package
 * talks to the standard interface and nothing else, and the shells hand it the
 * context their platform provides.
 *
 * Everything platform-shaped is a config seam rather than an import:
 * `createContext`, `createMediaElement` and `fetchBytes`. That keeps the
 * package inside the invariant of docs/02 §1 — no platform SDK outside
 * `core-*` — and, just as usefully, makes the graph testable without a sound
 * card. The seams are also where `core-audio-rntp` would slot in if the Stage 0
 * spike goes the other way (docs/05 §1, docs/11 §3.1).
 *
 * See docs/05-audio-playback.md §1.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type {
  AudioService,
  AudioSourceHandle,
  Disposable,
  InterruptionEvent,
  LoadOptions,
  OutputDevice,
  RouteChangeEvent,
  Uri,
} from '@BBeBee/protocol'

/* ── The platform seams ─────────────────────────────────────────────────── */

/**
 * The slice of `HTMLMediaElement` streaming needs.
 *
 * Declared structurally so this package compiles with no DOM lib and no
 * react-native types: whatever the platform hands over needs these members and
 * nothing more.
 */
export interface MediaElementLike {
  src: string
  currentTime: number
  duration: number
  paused: boolean
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface AudioWebAudioConfig {
  /** Defaults to `globalThis.AudioContext`. */
  createContext?: () => BaseAudioContext
  /** Defaults to `new Audio()`. Streaming is refused where there is none. */
  createMediaElement?: () => MediaElementLike
  /** Bytes for buffered loads. Defaults to `fetch`. */
  fetchBytes?: (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<ArrayBuffer>
  /** Reported as `outputLatencyMs` where the platform does not know. */
  fallbackLatencyMs?: number
}

/* ── Source handles ─────────────────────────────────────────────────────── */

/**
 * A decoded buffer, played through a persistent output node.
 *
 * `AudioBufferSourceNode` is one-shot — it cannot be paused and restarted — so
 * the handle keeps a `GainNode` as its stable `node` and builds a fresh source
 * behind it on every `play()`, tracking the offset itself. That is also what
 * makes gapless possible: the next buffer is queued behind the same output
 * node while the current one is still sounding.
 */
class BufferedHandle implements AudioSourceHandle {
  readonly node: GainNode
  readonly durationMs: number

  private source?: AudioBufferSourceNode
  private startedAt = 0
  private offsetSeconds = 0
  private playing = false
  private disposed = false
  private readonly endedListeners = new Set<() => void>()

  constructor(
    private readonly context: BaseAudioContext,
    private readonly buffer: AudioBuffer,
  ) {
    this.node = context.createGain()
    this.durationMs = Math.round(buffer.duration * 1000)
  }

  get positionMs(): number {
    if (!this.playing) return Math.round(this.offsetSeconds * 1000)
    const elapsed = this.context.currentTime - this.startedAt
    return Math.round(Math.min(this.offsetSeconds + elapsed, this.buffer.duration) * 1000)
  }

  play(atMs?: number): void {
    if (this.disposed) return
    if (atMs !== undefined) this.offsetSeconds = Math.max(0, atMs / 1000)
    this.stopSource()

    const source = this.context.createBufferSource()
    source.buffer = this.buffer
    source.connect(this.node)
    source.onended = () => {
      // A source stopped by seek or pause also fires `onended`; only a source
      // that reached the end of the buffer is a track ending.
      if (source !== this.source || !this.playing) return
      this.playing = false
      this.offsetSeconds = this.buffer.duration
      for (const listener of this.endedListeners) listener()
    }
    source.start(0, this.offsetSeconds)

    this.source = source
    this.startedAt = this.context.currentTime
    this.playing = true
  }

  pause(): void {
    if (!this.playing) return
    this.offsetSeconds = Math.min(
      this.offsetSeconds + (this.context.currentTime - this.startedAt),
      this.buffer.duration,
    )
    this.playing = false
    this.stopSource()
  }

  stop(): void {
    this.playing = false
    this.offsetSeconds = 0
    this.stopSource()
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => void this.endedListeners.delete(cb)
  }

  dispose(): void {
    this.disposed = true
    // Freeze the position first. Stopping the source without clearing
    // `playing` left `positionMs` computing from a clock that keeps running,
    // so a disposed handle reported a track still advancing.
    this.pause()
    this.stopSource()
    this.endedListeners.clear()
    this.node.disconnect()
  }

  private stopSource(): void {
    if (!this.source) return
    const source = this.source
    this.source = undefined
    source.onended = null
    try {
      source.stop()
    } catch {
      // Already stopped; `stop()` on a finished source throws in some engines.
    }
    source.disconnect()
  }
}

/** A media element wrapped as a graph node: constant memory, no seek-ahead. */
class StreamedHandle implements AudioSourceHandle {
  readonly node: AudioNode

  private readonly endedListeners = new Set<() => void>()
  private readonly onEndedNative = () => {
    for (const listener of this.endedListeners) listener()
  }

  constructor(
    private readonly element: MediaElementLike,
    node: AudioNode,
  ) {
    this.node = node
    element.addEventListener('ended', this.onEndedNative)
  }

  get durationMs(): number {
    const seconds = this.element.duration
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0
  }

  get positionMs(): number {
    return Math.round(this.element.currentTime * 1000)
  }

  play(atMs?: number): void {
    if (atMs !== undefined) this.element.currentTime = atMs / 1000
    void this.element.play()
  }

  pause(): void {
    this.element.pause()
  }

  stop(): void {
    this.element.pause()
    this.element.currentTime = 0
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => void this.endedListeners.delete(cb)
  }

  dispose(): void {
    this.element.removeEventListener('ended', this.onEndedNative)
    this.endedListeners.clear()
    this.element.pause()
    this.node.disconnect()
  }
}

/* ── The service ────────────────────────────────────────────────────────── */

export class AudioWebAudio extends Service implements AudioService {
  static inject = []

  readonly context: BaseAudioContext
  readonly chainInput: GainNode
  private readonly master: GainNode
  private mutedAt?: number
  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()

  constructor(
    ctx: Context,
    private readonly config: AudioWebAudioConfig = {},
  ) {
    super(ctx, 'audio')

    const create = config.createContext ?? defaultContextFactory()
    this.context = create()

    // chainInput → [effects, spliced in at M4] → master → destination.
    //
    // The empty splice point is deliberate: sources connect to `chainInput`
    // and never to `destination`, so effects can be built and torn down
    // without touching a playing source, and vice versa (docs/05 §1). M1
    // ships no chain at all rather than a pass-through one that would later
    // have to be un-built.
    this.chainInput = this.context.createGain()
    this.master = this.context.createGain()
    this.chainInput.connect(this.master)
    this.master.connect(this.context.destination)
  }

  get destination(): AudioNode {
    return this.context.destination
  }

  get sampleRate(): number {
    return this.context.sampleRate
  }

  get outputLatencyMs(): number {
    const context = this.context as BaseAudioContext & {
      outputLatency?: number
      baseLatency?: number
    }
    const seconds = context.outputLatency ?? context.baseLatency
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return Math.round(seconds * 1000)
    return this.config.fallbackLatencyMs ?? 0
  }

  async load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
    return opts.strategy === 'buffer' ? this.loadBuffered(src, opts) : this.loadStreamed(src, opts)
  }

  private async loadBuffered(src: string, opts: LoadOptions): Promise<AudioSourceHandle> {
    const fetchBytes = this.config.fetchBytes ?? defaultFetchBytes
    const bytes = await fetchBytes(src, { headers: opts.headers, signal: opts.signal })
    opts.signal?.throwIfAborted()

    const decode = (this.context as BaseAudioContext & { decodeAudioData: DecodeFn }).decodeAudioData
    const buffer = await decode.call(this.context, bytes)
    opts.signal?.throwIfAborted()

    // A decoded buffer is fully available, so the whole track is buffered.
    opts.onBuffered?.(buffer.duration)
    return new BufferedHandle(this.context, buffer)
  }

  private async loadStreamed(src: string, opts: LoadOptions): Promise<AudioSourceHandle> {
    const createElement = this.config.createMediaElement ?? defaultMediaElementFactory()
    if (!createElement) {
      throw new Error(
        'audio: streaming needs a media element, which this platform did not provide. ' +
          "Pass `createMediaElement`, or load with strategy 'buffer'.",
      )
    }

    const element = createElement()
    element.src = src

    const context = this.context as BaseAudioContext & {
      createMediaElementSource?: (el: unknown) => AudioNode
    }
    if (!context.createMediaElementSource) {
      throw new Error('audio: this AudioContext cannot wrap a media element')
    }
    const node = context.createMediaElementSource(element)

    if (opts.onBuffered) {
      // Reported from the element's own buffered ranges where it has them.
      const buffered = (element as { buffered?: { length: number; end(i: number): number } }).buffered
      if (buffered && buffered.length > 0) opts.onBuffered(buffered.end(buffered.length - 1))
    }

    return new StreamedHandle(element, node)
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v))
    if (this.mutedAt !== undefined) {
      // Remember the level so unmuting restores it rather than jumping to 1.
      this.mutedAt = clamped
      return
    }
    this.master.gain.value = clamped
  }

  setMuted(m: boolean): void {
    if (m) {
      if (this.mutedAt !== undefined) return
      this.mutedAt = this.master.gain.value
      this.master.gain.value = 0
      return
    }
    if (this.mutedAt === undefined) return
    this.master.gain.value = this.mutedAt
    this.mutedAt = undefined
  }

  /**
   * ⚠️ Enumeration is a desktop capability. On mobile the OS owns routing, so
   * this reports a single default device rather than throwing — the UI hides
   * the picker when there is only one entry (docs/05 §1).
   */
  async listOutputDevices(): Promise<OutputDevice[]> {
    const media = (globalThis as { navigator?: { mediaDevices?: MediaDevicesLike } }).navigator
      ?.mediaDevices
    if (!media?.enumerateDevices) {
      return [{ id: 'default', label: 'System default', isDefault: true }]
    }
    const devices = await media.enumerateDevices()
    const outputs = devices.filter((d) => d.kind === 'audiooutput')
    if (outputs.length === 0) return [{ id: 'default', label: 'System default', isDefault: true }]
    return outputs.map((d) => ({
      id: d.deviceId,
      label: d.label || 'Output',
      isDefault: d.deviceId === 'default',
    }))
  }

  async setOutputDevice(id: string): Promise<void> {
    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> })
      .setSinkId
    if (!sink) {
      throw new Error('audio: this platform does not support choosing an output device')
    }
    await sink.call(this.context, id)
  }

  onInterruption(cb: (e: InterruptionEvent) => void): Disposable {
    this.interruptionListeners.add(cb)
    return () => void this.interruptionListeners.delete(cb)
  }

  onRouteChange(cb: (e: RouteChangeEvent) => void): Disposable {
    this.routeListeners.add(cb)
    return () => void this.routeListeners.delete(cb)
  }

  /**
   * Publish an interruption.
   *
   * Called by the shell, which is where the platform's session events arrive:
   * `AVAudioSession` and `AudioManager` on mobile, device-change events on
   * desktop. The *policy* — what to pause, what to resume — is `ctx.player`'s
   * and is written once (docs/05 §5).
   */
  emitInterruption(event: InterruptionEvent): void {
    for (const listener of this.interruptionListeners) listener(event)
  }

  /** Publish a route change. Same reasoning as `emitInterruption`. */
  emitRouteChange(event: RouteChangeEvent): void {
    for (const listener of this.routeListeners) listener(event)
  }

  async [Service.init]() {
    return async () => {
      this.chainInput.disconnect()
      this.master.disconnect()
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      const closable = this.context as BaseAudioContext & { close?: () => Promise<void> }
      if (closable.close) await closable.close().catch(() => undefined)
    }
  }
}

type DecodeFn = (data: ArrayBuffer) => Promise<AudioBuffer>

interface MediaDevicesLike {
  enumerateDevices?: () => Promise<{ kind: string; deviceId: string; label: string }[]>
}

function defaultContextFactory(): () => BaseAudioContext {
  const Ctor = (globalThis as { AudioContext?: new () => BaseAudioContext }).AudioContext
  if (!Ctor) {
    throw new Error(
      'audio: no AudioContext in this runtime. The shell must pass `createContext` — ' +
        'react-native-audio-api on mobile, the renderer’s own on desktop.',
    )
  }
  return () => new Ctor()
}

function defaultMediaElementFactory(): (() => MediaElementLike) | undefined {
  const Ctor = (globalThis as { Audio?: new () => MediaElementLike }).Audio
  return Ctor ? () => new Ctor() : undefined
}

async function defaultFetchBytes(
  src: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<ArrayBuffer> {
  const response = await fetch(src, { headers: opts.headers, signal: opts.signal })
  if (!response.ok) throw new Error(`audio: ${response.status} loading ${src}`)
  return response.arrayBuffer()
}

export const name = 'core-audio-webaudio'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.audio` is usable.
 */
export async function apply(ctx: Context, config: AudioWebAudioConfig = {}) {
  const fiber = await ctx.plugin(AudioWebAudio, config)
  return () => void fiber.dispose()
}

export default { name, apply }
