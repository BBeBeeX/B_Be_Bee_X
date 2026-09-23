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
import { assertGranted } from '@BBeBee/kernel'
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
  /**
   * The CORS mode the element loads in.
   *
   * Load-bearing, not cosmetic: an element wrapped by
   * `createMediaElementSource` and fetched cross-origin without CORS makes
   * the node output silence, so a remote track "plays" with no sound.
   */
  crossOrigin?: string | null
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

  /**
   * A decoded buffer holds the whole track in memory, so there is nothing left
   * to wait for and this never fires. The member exists because the contract
   * has it; registering the callback and never calling it would be the same
   * silence with a listener leaked behind it.
   */
  onStalled(): Disposable {
    return () => {}
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
/**
 * Element events that mean "the buffer ran dry" and "it filled again".
 *
 * `waiting` is the one that always fires; `stalled` is the network-level
 * cousin that some engines send instead, and neither is guaranteed on its own.
 * On the way back, `playing` is the honest signal — `canplay` fires while
 * still paused, so recovering on it would report `playing` for a track the
 * user had stopped.
 */
const STALL_EVENTS = ['waiting', 'stalled'] as const
const RECOVER_EVENTS = ['playing', 'canplaythrough'] as const

class StreamedHandle implements AudioSourceHandle {
  readonly node: AudioNode

  private readonly endedListeners = new Set<() => void>()
  private readonly onEndedNative = () => {
    this.pendingSeekSeconds = undefined
    for (const listener of this.endedListeners) listener()
  }

  private readonly stallListeners = new Set<(stalled: boolean) => void>()
  private stalled = false
  private readonly onStallNative = () => this.setStalled(true)
  private readonly onRecoverNative = () => {
    /*
     * The element's own clock is authoritative as soon as it can play.
     *
     * A `play(atMs)` issued before metadata is stored by the element as its
     * *default playback start position*, and that path does not fire `seeked`
     * — so a pending marker recorded there would never clear. `attach` plays
     * every streamed track with `play(0)`, which is exactly that call, and the
     * position then reported 0 for the whole track while the audio played.
     */
    this.pendingSeekSeconds = undefined
    this.setStalled(false)
  }
  private readonly onSeekedNative = () => {
    this.pendingSeekSeconds = undefined
  }

  private pendingSeekSeconds?: number

  constructor(
    private readonly element: MediaElementLike,
    node: AudioNode,
  ) {
    this.node = node
    element.addEventListener('ended', this.onEndedNative)
    element.addEventListener('seeked', this.onSeekedNative)
    for (const type of STALL_EVENTS) element.addEventListener(type, this.onStallNative)
    for (const type of RECOVER_EVENTS) element.addEventListener(type, this.onRecoverNative)
  }

  /**
   * Only an actual change is published.
   *
   * An element under a slow network sends `waiting` repeatedly, and a player
   * that took each one as a fresh stall would restart its recovery timeout on
   * every one of them — turning "gave up after 30 seconds" into "never gives
   * up".
   */
  private setStalled(stalled: boolean): void {
    if (this.stalled === stalled) return
    this.stalled = stalled
    for (const listener of [...this.stallListeners]) listener(stalled)
  }

  get durationMs(): number {
    const seconds = this.element.duration
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0
  }

  get positionMs(): number {
    if (this.pendingSeekSeconds !== undefined) {
      return Math.round(this.pendingSeekSeconds * 1000)
    }
    return Math.round(this.element.currentTime * 1000)
  }

  play(atMs?: number): void {
    if (atMs !== undefined) {
      const seconds = Math.max(0, atMs / 1000)
      /*
       * Only a seek that moves the element can be pending.
       *
       * Setting `currentTime` to where the element already is fires no
       * `seeked` event, so recording the target as pending would never clear
       * it — and `positionMs` would report that target for the whole track.
       * A fresh element is at 0, so `play(0)` is precisely the case that used
       * to stick: the progress bar sat at zero while the audio played.
       */
      if (seconds !== this.element.currentTime) {
        this.pendingSeekSeconds = seconds
        this.element.currentTime = seconds
      }
    }
    void this.element.play()
  }

  pause(): void {
    this.element.pause()
  }

  stop(): void {
    this.pendingSeekSeconds = undefined
    this.element.pause()
    this.element.currentTime = 0
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => void this.endedListeners.delete(cb)
  }

  onStalled(cb: (stalled: boolean) => void): Disposable {
    this.stallListeners.add(cb)
    return () => void this.stallListeners.delete(cb)
  }

  dispose(): void {
    this.pendingSeekSeconds = undefined
    this.element.removeEventListener('ended', this.onEndedNative)
    this.element.removeEventListener('seeked', this.onSeekedNative)
    for (const type of STALL_EVENTS) this.element.removeEventListener(type, this.onStallNative)
    for (const type of RECOVER_EVENTS) this.element.removeEventListener(type, this.onRecoverNative)
    this.endedListeners.clear()
    this.stallListeners.clear()
    this.element.pause()
    try {
      this.element.src = ''
    } catch {
      // ignore in environments where setting src throws
    }
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

  get chainOutput(): GainNode {
    return this.master
  }

  async dipVolume(durationMs = 20): Promise<Disposable> {
    const currentGain = this.master.gain.value
    const dipSeconds = Math.max(0.005, durationMs / 1000)
    const now = this.context.currentTime
    if (typeof this.master.gain.setTargetAtTime === 'function') {
      this.master.gain.setTargetAtTime(0, now, dipSeconds / 3)
    } else {
      this.master.gain.value = 0
    }
    await new Promise((resolve) => setTimeout(resolve, durationMs))
    return () => {
      const resumeNow = this.context.currentTime
      if (typeof this.master.gain.setTargetAtTime === 'function') {
        this.master.gain.setTargetAtTime(currentGain, resumeNow, dipSeconds / 3)
      } else {
        this.master.gain.value = currentGain
      }
    }
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
    // `audio` is a flag capability: holding it means "may contribute nodes to
    // the audio graph" (docs/03 §7). Gated here rather than on `chainInput`
    // because this is where a caller actually acquires a node.
    this.gate()
    if (opts.strategy === 'buffer') {
      try {
        return await this.loadBuffered(src, opts)
      } catch (err) {
        // If buffered decoding fails (e.g. 24-bit FLAC, ID3v2-prefixed FLAC, or unsupported bit depth),
        // fallback to streamed HTMLMediaElement if available rather than aborting playback!
        const canStream = Boolean(this.config.createMediaElement ?? defaultMediaElementFactory())
        if (canStream) {
          return await this.loadStreamed(src, opts)
        }
        throw err
      }
    }
    return this.loadStreamed(src, opts)
  }

  /** Ungated callers pass through; a plugin is held to its manifest. */
  private gate(): void {
    assertGranted(this[Service.resolveConfig](), 'audio')
  }

  private async loadBuffered(src: string, opts: LoadOptions): Promise<AudioSourceHandle> {
    const fetchBytes = this.config.fetchBytes ?? defaultFetchBytes
    const targetSrc =
      typeof src === 'string' && src.startsWith('file://') && typeof window !== 'undefined'
        ? src.replace(/^file:\/\//, 'bbebee-file://')
        : src
    const bytes = await fetchBytes(targetSrc, { headers: opts.headers, signal: opts.signal })
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
  
    element.crossOrigin = 'anonymous'
    const targetSrc =
      typeof src === 'string' && src.startsWith('file://') && typeof window !== 'undefined'
        ? src.replace(/^file:\/\//, 'bbebee-file://')
        : src
    element.src = targetSrc

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
    this.gate()
    const clamped = Math.max(0, Math.min(1, v))
    if (this.mutedAt !== undefined) {
      // Remember the level so unmuting restores it rather than jumping to 1.
      this.mutedAt = clamped
      return
    }
    this.master.gain.value = clamped
  }

  setMuted(m: boolean): void {
    this.gate()
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
    this.gate()
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
  ctx.logger.info('core-audio-webaudio: loaded')
  const fiber = await ctx.plugin(AudioWebAudio, config)
  return () => void fiber.dispose()
}

export default { name, apply }
