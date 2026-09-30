/**
 * `ctx.audio` — the desktop bridge-decoded engine.
 *
 * One of two interchangeable desktop engines (settings-switchable with
 * `core-audio-webaudio`). Its contract with the listener: nothing here is
 * ever decoded by Chromium. Every track — local or remote, any strategy —
 * goes through the FFmpeg bridge, which decodes ALAC, 24-bit/32-bit Hi-Res
 * and everything else into native-rate Float32 PCM ahead of anything
 * Chromium could touch.
 *
 * The media element survives only as the degradation path for material the
 * bridge cannot represent: a live stream of unknown length, a track beyond
 * the whole-track decode budget, or a bridge that failed mid-decode. The
 * WebAudio engine's `decodeAudioData` is not among the fallbacks — that is
 * Chromium's decoder, which this engine exists to bypass.
 *
 * The AudioContext is recreated at the track's native sample rate, so the
 * graph never resamples Hi-Res material internally.
 *
 * Output is shared mode: the graph's master gain feeds `context.destination`
 * and the OS mixer owns the endpoint format.
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
import {
  BufferedHandle,
  StreamedHandle,
  defaultMediaElementFactory,
  type MediaElementLike,
} from '@BBeBee/core-audio-webaudio'
import {
  closeContextQuietly,
  ensureAudioContextRunning,
  enumerateOutputDevices,
  probeViaBridge,
  rebuildGraphAtRate,
  resolveBridgeCall,
  resolveNativeOutputDevice,
  sanitizeSinkId,
  ContextInterruptionObserver,
  type AudioProbeInfo,
  type BridgeCall,
} from '@BBeBee/core-audio-webaudio'

export type { AudioLogger, BridgeCall } from '@BBeBee/core-audio-webaudio'

/** Past a whole track's PCM the element path is kinder than resident memory. */
const DEFAULT_MAX_DECODE_DURATION_MS = 30 * 60_000

export interface AudioWasapiConfig {
  createContext?: (options?: AudioContextOptions) => BaseAudioContext
  bridgeCall?: BridgeCall
  /**
   * The degradation path behind the bridge. Defaults to `new Audio()`;
   * streaming is refused where there is none and the load fails rather than
   * fall back to Chromium's decoder.
   */
  createMediaElement?: () => MediaElementLike
  /**
   * Whole-track PCM decode budget. A probe reporting a longer track — or no
   * length at all, the live-stream case — degrades to the media element
   * instead of decoding an unbounded track into resident memory. PCM is
   * roughly ten times the file, so this is an OOM guard, not a quality knob.
   */
  maxDecodeDurationMs?: number
  /**
   * Translate the `AudioContext`'s own state transitions into interruption
   * events. See `ContextInterruptionObserver` for when to opt in.
   */
  emitContextInterruptions?: boolean
}

interface BridgeDecodedPcm {
  sampleRate: number
  channels: number
  bitDepth?: number
  durationMs: number
  pcm: Float32Array[]
}

export class AudioWasapi extends Service implements AudioService {
  static inject = []

  context: BaseAudioContext
  chainInput: GainNode
  chainOutput: GainNode
  private master: GainNode
  private targetVolume = 0.8
  private mutedAt?: number
  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()
  private readonly config: AudioWasapiConfig
  private readonly maxDecodeDurationMs: number
  private activeHardwareSampleRate?: number
  private activeHardwareBitDepth?: number
  private activeHardwareChannels?: number
  private activeDeviceLabel?: string
  private selectedDeviceId = 'default'
  /** Watches the context's own state; follows it across a rate rebuild. */
  private readonly interruptions: ContextInterruptionObserver

  constructor(
    ctx: Context,
    config: AudioWasapiConfig = {},
  ) {
    super(ctx, 'audio')
    this.config = config
    this.maxDecodeDurationMs = config.maxDecodeDurationMs ?? DEFAULT_MAX_DECODE_DURATION_MS

    this.interruptions = new ContextInterruptionObserver({
      logger: ctx.logger,
      emitInterruptions: config.emitContextInterruptions === true,
      onInterruption: (e) => this.emitInterruption(e),
    })

    const create = config.createContext ?? defaultContextFactory()
    this.context = create()

    this.chainInput = this.context.createGain()
    this.master = this.context.createGain()
    this.master.gain.value = this.targetVolume
    this.chainOutput = this.master
    this.chainInput.connect(this.master)

    // Shared output: the OS mixer owns the endpoint format, so the graph's
    // master gain feeds Chromium's own destination and nothing else.
    this.master.connect(this.context.destination)
    this.ctx.logger?.info(
      'core-audio-wasapi: initialized (sampleRate: %d)',
      this.sampleRate,
    )
  }

  /**
   * Put the graph at the track's native rate: build a fresh context there,
   * swap the fields, tell graph consumers, retire the old context. A no-op
   * when the context already runs at the rate; a kept graph with a warning
   * when the realm refused to.
   */
  private async ensureContextSampleRate(targetRate?: number): Promise<void> {
    if (!targetRate || targetRate === this.context.sampleRate) {
      return
    }

    this.ctx.logger?.info(
      'wasapi: track sample rate (%dHz) differs from context (%dHz) — recreating AudioContext to keep the graph at the native rate',
      targetRate,
      this.context.sampleRate,
    )

    const rebuilt = rebuildGraphAtRate({
      create: this.config.createContext ?? defaultContextFactory(),
      targetRate,
      mutedAt: this.mutedAt,
      targetVolume: this.targetVolume,
    })
    if (!rebuilt) {
      this.ctx.logger?.warn(
        'wasapi: failed to rebuild AudioContext with sampleRate %d — keeping the current graph',
        targetRate,
      )
      return
    }

    const oldCtx = this.context
    this.context = rebuilt.context
    this.chainInput = rebuilt.chainInput
    this.master = rebuilt.master
    this.chainOutput = rebuilt.master

    // The state observer watches a context, not the service — follow it.
    this.interruptions.attach(this.context)

    // A fresh context knows nothing of the endpoint the user picked — put the
    // selection back, best effort.
    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId
    if (typeof sink === 'function' && this.selectedDeviceId !== 'default') {
      void sink.call(this.context, sanitizeSinkId(this.selectedDeviceId)).catch(() => {})
    }

    // Notify DSP, visualizer, and other graph consumers to resplice nodes to new context
    this.ctx.emit('audio/context-rebuilt')

    // Safely close previous context after new graph is attached
    closeContextQuietly(oldCtx)
  }

  get destination(): AudioNode {
    return this.master
  }

  get sampleRate(): number {
    return this.activeHardwareSampleRate ?? this.context.sampleRate
  }

  get hardwareBitDepth(): number {
    // Shared output: the OS mixer owns the endpoint format, so this reports
    // the bit depth of the source currently decoded, not the endpoint's.
    return this.activeHardwareBitDepth ?? 16
  }

  get hardwareChannels(): number {
    return this.activeHardwareChannels ?? 2
  }

  get currentDeviceLabel(): string | undefined {
    return this.activeDeviceLabel
  }

  get outputLatencyMs(): number {
    const ctx = this.context as AudioContext
    return typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0
      ? ctx.outputLatency * 1000
      : 20
  }

  async dipVolume(durationMs = 20): Promise<Disposable> {
    this.ctx.logger?.debug?.('wasapi: dipVolume duration %dms', durationMs)
    const dipSeconds = Math.max(0.005, durationMs / 1000)
    const now = this.context.currentTime
    if (typeof this.master.gain.cancelScheduledValues === 'function') {
      this.master.gain.cancelScheduledValues(now)
    }
    if (typeof this.master.gain.setTargetAtTime === 'function') {
      this.master.gain.setTargetAtTime(0, now, dipSeconds / 3)
    } else {
      this.master.gain.value = 0
    }
    await new Promise((resolve) => setTimeout(resolve, durationMs))
    return () => {
      const target = this.mutedAt !== undefined ? 0 : this.targetVolume
      const resumeNow = this.context.currentTime
      if (typeof this.master.gain.cancelScheduledValues === 'function') {
        this.master.gain.cancelScheduledValues(resumeNow)
      }
      if (typeof this.master.gain.setTargetAtTime === 'function') {
        this.master.gain.setTargetAtTime(target, resumeNow, dipSeconds / 3)
      } else {
        this.master.gain.value = target
      }
    }
  }

  async load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
    this.gate()
    const srcStr = String(src)
    this.ctx.logger?.info('wasapi: loading %s (strategy: %s)', srcStr, opts.strategy ?? 'stream')

    const bridge = resolveBridgeCall(this.config.bridgeCall)
    let probed: AudioProbeInfo | undefined

    if (bridge) {
      try {
        probed = await probeViaBridge(bridge, srcStr, opts.headers)
      } catch (probeErr) {
        this.ctx.logger?.warn(
          'wasapi: probe failed for %s (%s) — the bridge cannot decode this track',
          srcStr,
          String(probeErr),
        )
      }

      // A track with no reported length never finishes decoding into PCM (a
      // live stream runs forever); one beyond the budget would decode into
      // gigabytes of resident Float32. Both degrade to the element instead.
      if (probed?.durationMs && probed.durationMs <= this.maxDecodeDurationMs) {
        try {
          this.ctx.logger?.debug?.('wasapi: attempting bridge decodePcm for %s', srcStr)
          const decoded = (await bridge('audio', 'decodePcm', [
            srcStr,
            { headers: opts.headers },
          ])) as BridgeDecodedPcm

          if (decoded?.pcm?.length && decoded.pcm[0]?.length) {
            this.ctx.logger?.info(
              'wasapi: bridge decodePcm succeeded (%dms, %d channels, %dHz, %d-bit)',
              decoded.durationMs,
              decoded.channels,
              decoded.sampleRate,
              decoded.bitDepth || 24,
            )
            await this.ensureContextSampleRate(decoded.sampleRate)
            this.ctx.logger?.info(
              'wasapi: decoded output (%dHz, %dch)',
              this.context.sampleRate,
              decoded.channels,
            )
            this.activeHardwareSampleRate = this.context.sampleRate
            this.activeHardwareBitDepth = decoded.bitDepth ?? 24
            this.activeHardwareChannels = decoded.channels ?? 2

            const length = decoded.pcm[0]!.length
            const createBuffer = (
              this.context as unknown as {
                createBuffer?: (c: number, l: number, s: number) => AudioBuffer
              }
            ).createBuffer
            if (!createBuffer) {
              throw new Error('wasapi: this AudioContext cannot allocate a PCM buffer')
            }
            const buffer = createBuffer.call(this.context, decoded.channels, length, decoded.sampleRate)
            for (let c = 0; c < decoded.channels; c++) {
              buffer.getChannelData(c).set(decoded.pcm[c]!)
            }

            opts.onBuffered?.(buffer.duration)
            return new BufferedHandle(this.context, buffer, {
              logger: this.ctx.logger,
              ensureRunning: this.ensureContextRunning,
              durationMs: decoded.durationMs,
            })
          }
          this.ctx.logger?.warn('wasapi: bridge decodePcm returned no PCM for %s', srcStr)
        } catch (decodeErr) {
          this.ctx.logger?.warn(
            'wasapi: bridge decodePcm failed for %s — degrading to the media element (Chromium decoder): %s',
            srcStr,
            String(decodeErr),
          )
        }
      } else {
        this.ctx.logger?.warn(
          'wasapi: %s has %s — outside the whole-track decode budget (%dms); degrading to the media element (Chromium decoder)',
          srcStr,
          probed?.durationMs ? `a duration of ${probed.durationMs}ms, over budget` : 'no decodable length (a live stream?)',
          this.maxDecodeDurationMs,
        )
      }
    } else {
      this.ctx.logger?.warn(
        'wasapi: no FFmpeg bridge available — the media element (Chromium decoder) is the only path for %s',
        srcStr,
      )
    }

    return this.loadStreamed(srcStr, opts, probed)
  }

  /**
   * The degradation path, never the route: an `HTMLMediaElement` wrapped by
   * `createMediaElementSource`, feeding `chainInput` so the DSP chain sees the
   * stream exactly like a decoded buffer. Chromium's own decoder runs behind
   * the element — which is precisely what this engine tries to avoid, so this
   * path only takes a track the bridge could not (see `load`).
   *
   * A media element cannot set request headers itself; remote sources rely on
   * the per-host registration `plugin-player` performs through
   * `stream.setHeaders` before the load, which main injects into the element's
   * requests via `onBeforeSendHeaders`.
   */
  private async loadStreamed(
    src: string,
    opts: LoadOptions,
    probed?: AudioProbeInfo,
  ): Promise<AudioSourceHandle> {
    const createElement = this.config.createMediaElement ?? defaultMediaElementFactory()
    if (!createElement) {
      throw new Error(
        "audio: the FFmpeg bridge could not take this track and there is no media element to degrade to. " +
          "Provide `bridgeCall` (audio.probe/audio.decodePcm) or pass `createMediaElement`.",
      )
    }

    // The probe the load already made, put to use: the element is wrapped on
    // the *new* context and then plays at its native rate with no in-graph
    // resampling.
    if (probed?.sampleRate) await this.ensureContextSampleRate(probed.sampleRate)
    if (probed?.channels) this.activeHardwareChannels = probed.channels
    if (probed?.bitDepth) this.activeHardwareBitDepth = probed.bitDepth

    const element = createElement()
    try {
      element.crossOrigin = 'anonymous'
      element.src =
        src.startsWith('file://') && typeof window !== 'undefined'
          ? src.replace(/^file:\/\//, 'bbebee-file://')
          : src

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

      this.ctx.logger?.info('wasapi: streamed source ready for %s', element.src)
      return new StreamedHandle(element, node, this.ctx.logger, this.ensureContextRunning)
    } catch (err) {
      // Never leak a half-configured element: the caller retries buffered, and
      // a live element would race that retry for the audio device.
      try {
        element.pause()
        element.src = ''
      } catch {
        // ignore
      }
      throw err
    }
  }

  /**
   * Kick a suspended or interrupted context before a source starts on it.
   * The shared implementation; bound late so it reads the context a rate
   * rebuild may have replaced.
   */
  private readonly ensureContextRunning = (): void => {
    ensureAudioContextRunning(this.context, this.ctx.logger)
  }

  private gate(): void {
    assertGranted(this[Service.resolveConfig](), 'audio')
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v))
    this.targetVolume = clamped
    this.ctx.logger?.debug?.('wasapi: setVolume %d', clamped)
    if (this.mutedAt !== undefined) {
      this.mutedAt = clamped
      return
    }
    if (typeof this.master.gain.cancelScheduledValues === 'function') {
      this.master.gain.cancelScheduledValues(this.context.currentTime)
    }
    if (typeof this.master.gain.setValueAtTime === 'function') {
      this.master.gain.setValueAtTime(clamped, this.context.currentTime)
    } else {
      this.master.gain.value = clamped
    }
  }

  setMuted(m: boolean): void {
    this.ctx.logger?.debug?.('wasapi: setMuted %s', m)
    if (m) {
      if (this.mutedAt !== undefined) return
      this.mutedAt = this.targetVolume
      if (typeof this.master.gain.cancelScheduledValues === 'function') {
        this.master.gain.cancelScheduledValues(this.context.currentTime)
      }
      this.master.gain.value = 0
    } else {
      const restore = this.mutedAt ?? this.targetVolume
      this.mutedAt = undefined
      this.targetVolume = restore
      if (typeof this.master.gain.cancelScheduledValues === 'function') {
        this.master.gain.cancelScheduledValues(this.context.currentTime)
      }
      if (typeof this.master.gain.setValueAtTime === 'function') {
        this.master.gain.setValueAtTime(restore, this.context.currentTime)
      } else {
        this.master.gain.value = restore
      }
    }
  }

  async listOutputDevices(): Promise<OutputDevice[]> {
    this.ctx.logger?.info('wasapi: listOutputDevices() started')
    const devices = await enumerateOutputDevices({
      logger: this.ctx.logger,
      bridgeCall: resolveBridgeCall(this.config.bridgeCall),
    })
    if (!this.activeDeviceLabel) {
      const def = devices.find((d) => d.isDefault) ?? devices[0]
      if (def) this.activeDeviceLabel = def.label
    }
    return devices
  }

  async setOutputDevice(id: string): Promise<void> {
    this.ctx.logger?.info('wasapi: setOutputDevice("%s") started', id)
    this.selectedDeviceId = id
    const bridge = resolveBridgeCall(this.config.bridgeCall)

    if (bridge) {
      // The native side learns the OS device the Chromium id stands for — the
      // id Chromium understands and the id the OS understands are different.
      const { nativeId, label } = await resolveNativeOutputDevice({ id, bridge, logger: this.ctx.logger })
      if (label) this.activeDeviceLabel = label
      this.ctx.logger?.info('wasapi: sending native deviceId "%s" to bridge audio.setOutputDevice', nativeId)
      try {
        await bridge('audio', 'setOutputDevice', [nativeId])
        this.ctx.logger?.info('wasapi: bridge audio.setOutputDevice("%s") succeeded', nativeId)
      } catch (err) {
        this.ctx.logger?.error('wasapi: bridge audio.setOutputDevice("%s") failed: %s', nativeId, String(err))
      }
    }

    // Safety guard: never pass OS IDs (PnP InstanceId, MMDevice ID, ALSA hw) to Chromium setSinkId
    const targetId = sanitizeSinkId(id)

    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId
    if (typeof sink === 'function') {
      try {
        await sink.call(this.context, targetId)
        this.ctx.logger?.info('wasapi: AudioContext.setSinkId("%s") succeeded', targetId)
      } catch (err) {
        this.ctx.logger?.error('wasapi: AudioContext.setSinkId("%s") failed: %s', targetId, String(err))
      }
    } else {
      this.ctx.logger?.debug?.('wasapi: AudioContext.setSinkId is not supported in this runtime')
    }
  }

  onInterruption(cb: (e: InterruptionEvent) => void): Disposable {
    this.interruptionListeners.add(cb)
    return () => {
      this.interruptionListeners.delete(cb)
    }
  }

  onRouteChange(cb: (e: RouteChangeEvent) => void): Disposable {
    this.routeListeners.add(cb)
    return () => {
      this.routeListeners.delete(cb)
    }
  }

  emitInterruption(event: InterruptionEvent): void {
    this.ctx.logger?.info('wasapi: emitInterruption (type: %s, shouldResume: %s)', event.type, event.shouldResume)
    for (const listener of this.interruptionListeners) listener(event)
  }

  emitRouteChange(event: RouteChangeEvent): void {
    this.ctx.logger?.info('wasapi: emitRouteChange (reason: %s)', event.reason)
    for (const listener of this.routeListeners) listener(event)
  }

  async [Service.init]() {
    this.interruptions.attach(this.context)
    return async () => {
      this.ctx.logger?.info('wasapi: disposing audio service')
      this.interruptions.detach()
      this.chainInput.disconnect()
      this.master.disconnect()
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      closeContextQuietly(this.context)
    }
  }
}

function defaultContextFactory(): (options?: AudioContextOptions) => BaseAudioContext {
  return (options?: AudioContextOptions) => {
    const Ctor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      throw new Error('audio-wasapi: no AudioContext available in global scope')
    }
    return new Ctor(options)
  }
}

export const name = 'core-audio-wasapi'

export async function apply(ctx: Context, config: AudioWasapiConfig = {}) {
  ctx.logger?.info('core-audio-wasapi: loaded')
  const fiber = await ctx.plugin(AudioWasapi, config)
  return () => void fiber.dispose()
}

export default AudioWasapi
