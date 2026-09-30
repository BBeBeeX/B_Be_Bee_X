/**
 * `ctx.audio` — the desktop Web Audio engine with FFmpeg-bridged decoding.
 *
 * One of two interchangeable desktop engines (settings-switchable with
 * `core-audio-webaudio`). Its distinguishing features:
 * - FFmpeg decodes ALAC, 24-bit/32-bit Hi-Res audio into Float32 PCM ahead of
 *   Chromium's own decoder (bridge-first; the WebAudio engine only falls back
 *   to the bridge after `decodeAudioData` fails).
 * - True streaming (`strategy: 'stream'`) through an HTMLMediaElement wrapped
 *   by `createMediaElementSource`, sharing `StreamedHandle` with the other
 *   engine.
 * - The AudioContext is recreated at the track's native sample rate, so the
 *   graph never resamples Hi-Res material internally.
 *
 * Output is shared mode: the graph's master gain feeds `context.destination`
 * and the OS mixer owns the endpoint format.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { assertGranted } from '@BBeBee/kernel'
import {
  StreamedHandle,
  defaultMediaElementFactory,
  type MediaElementLike,
} from '@BBeBee/core-audio-webaudio'
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
import { WasapiAudioHandle, type AudioLogger } from './wasapi-audio-handle.js'

export interface AudioWasapiConfig {
  createContext?: (options?: AudioContextOptions) => BaseAudioContext
  fetchBytes?: (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<ArrayBuffer>
  bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>
  /**
   * The element behind `strategy: 'stream'`. Defaults to `new Audio()`;
   * streaming is refused where there is none and the load falls back to
   * buffered decode.
   */
  createMediaElement?: () => MediaElementLike
}

type DecodeFn = (data: ArrayBuffer) => Promise<AudioBuffer>

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

async function defaultFetchBytes(
  src: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<ArrayBuffer> {
  const response = await fetch(src, { headers: opts.headers, signal: opts.signal })
  if (!response.ok) throw new Error(`audio: fetch failed with status ${response.status}`)
  return response.arrayBuffer()
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
  private activeHardwareSampleRate?: number
  private activeHardwareBitDepth?: number
  private activeHardwareChannels?: number
  private activeDeviceLabel?: string

  constructor(
    ctx: Context,
    config: AudioWasapiConfig = {},
  ) {
    super(ctx, 'audio')
    this.config = config

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

  private async ensureContextSampleRate(targetRate?: number): Promise<void> {
    if (!targetRate || targetRate === this.context.sampleRate) {
      return
    }

    this.ctx.logger?.info(
      'wasapi: track sample rate (%dHz) differs from context (%dHz) — recreating AudioContext to keep the graph at the native rate',
      targetRate,
      this.context.sampleRate,
    )

    const oldCtx = this.context
    const create = this.config.createContext ?? defaultContextFactory()
    try {
      const newCtx = create({ sampleRate: targetRate })
      this.context = newCtx

      const newChainInput = this.context.createGain()
      const newMaster = this.context.createGain()
      newMaster.gain.value = this.mutedAt !== undefined ? 0 : this.targetVolume

      this.chainInput = newChainInput
      this.master = newMaster
      this.chainOutput = newMaster

      newChainInput.connect(newMaster)
      newMaster.connect(this.context.destination)

      // Notify DSP, visualizer, and other graph consumers to resplice nodes to new context
      this.ctx.emit('audio/context-rebuilt')

      // Safely close previous context after new graph is attached
      try {
        if (typeof (oldCtx as AudioContext).close === 'function') {
          void (oldCtx as AudioContext).close().catch(() => undefined)
        }
      } catch {
        // ignore
      }
    } catch (err) {
      this.ctx.logger?.warn('wasapi: failed to rebuild AudioContext with sampleRate %d: %s', targetRate, String(err))
    }
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
    this.ctx.logger?.info('wasapi: loading %s (strategy: %s)', String(src), opts.strategy ?? 'stream')

    /*
     * The streaming strategy goes straight to the element. The FFmpeg bridge
     * below decodes the whole track into resident PCM — exactly what this
     * strategy exists to avoid — so it is skipped here, and a failed element
     * path degrades to the buffered path rather than to the bridge.
     */
    if (opts.strategy === 'stream') {
      try {
        return await this.loadStreamed(String(src), opts)
      } catch (streamErr) {
        this.ctx.logger?.warn(
          'wasapi: streamed load failed for %s, falling back to buffered decode: %s',
          String(src),
          String(streamErr),
        )
      }
    }

    const bridgeCall =
      this.config.bridgeCall ??
      (typeof window !== 'undefined'
        ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
            .BBeBeeBridge?.call
        : undefined)

    // Attempt FFmpeg decode through bridge for ALAC and Hi-Res formats
    if (bridgeCall) {
      try {
        this.ctx.logger?.debug?.('wasapi: attempting bridge decodePcm for %s', String(src))
        const decoded = (await bridgeCall('audio', 'decodePcm', [
          src,
          { headers: opts.headers },
        ])) as {
          sampleRate: number
          channels: number
          bitDepth?: number
          durationMs: number
          pcm: Float32Array[]
        }

        if (decoded && decoded.pcm && decoded.pcm.length > 0 && decoded.pcm[0]?.length) {
          this.ctx.logger?.info(
            'wasapi: bridge decodePcm succeeded (%dms, %d channels, %dHz, %d-bit)',
            decoded.durationMs,
            decoded.channels,
            decoded.sampleRate,
            decoded.bitDepth || 24,
          )
          await this.ensureContextSampleRate(decoded.sampleRate)
          this.ctx.logger?.info('wasapi: decoded output (%dHz, %dch)', this.context.sampleRate, decoded.channels)
          this.activeHardwareSampleRate = this.context.sampleRate
          this.activeHardwareBitDepth = decoded.bitDepth ?? 24
          this.activeHardwareChannels = decoded.channels ?? 2

          // Create an AudioBuffer matching the decoded sample rate
          const length = decoded.pcm[0]!.length
          const buffer =
            typeof (this.context as unknown as { createBuffer?: unknown }).createBuffer === 'function'
              ? (this.context as unknown as {
                  createBuffer: (c: number, l: number, s: number) => AudioBuffer
                }).createBuffer(decoded.channels, length, decoded.sampleRate)
              : await (this.context as BaseAudioContext & { decodeAudioData: DecodeFn }).decodeAudioData(
                  new ArrayBuffer(8),
                )

          for (let c = 0; c < decoded.channels; c++) {
            if (typeof buffer.getChannelData === 'function') {
              buffer.getChannelData(c).set(decoded.pcm[c]!)
            }
          }

          opts.onBuffered?.(buffer.duration)
          return new WasapiAudioHandle(this.context, buffer, decoded.durationMs, this.ctx.logger)
        }
      } catch (bridgeErr) {
        this.ctx.logger?.warn('wasapi: bridge decodePcm failed, falling back to buffered decode (%s): %s', String(src), String(bridgeErr))
        // Fall back to standard byte fetch and decode
      }
    }

    // Standard fallback: fetch raw bytes and decodeAudioData
    return this.loadBuffered(src, opts)
  }

  /**
   * The streaming path: an `HTMLMediaElement` wrapped by
   * `createMediaElementSource`, feeding `chainInput` so the DSP chain sees the
   * stream exactly like a decoded buffer. Nothing decodes
   * the track into resident PCM, so memory stays flat for a multi-hour track.
   *
   * A media element cannot set request headers itself; remote sources rely on
   * the per-host registration `plugin-player` performs through
   * `stream.setHeaders` before the load, which main injects into the element's
   * requests via `onBeforeSendHeaders`.
   */
  private async loadStreamed(src: string, opts: LoadOptions): Promise<AudioSourceHandle> {
    const createElement = this.config.createMediaElement ?? defaultMediaElementFactory()
    if (!createElement) {
      throw new Error(
        "audio: streaming needs a media element, which this platform did not provide. " +
          "Pass `createMediaElement`, or load with strategy 'buffer'.",
      )
    }

    const element = createElement()
    try {
      element.crossOrigin = 'anonymous'
      element.src =
        src.startsWith('file://') && typeof window !== 'undefined'
          ? src.replace(/^file:\/\//, 'bbebee-file://')
          : src

      // The graph resamples an element to the context's own rate, so probe
      // the track's rate and put the context there — the element then plays
      // at its native rate with no in-graph resampling.
      await this.ensureStreamSampleRate(src, opts.headers)

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
   * Probe the stream's sample rate so the context can be rebuilt at the
   * track's native rate. A failure is non-fatal: the element plays at the
   * context's current rate either way.
   */
  private async ensureStreamSampleRate(src: string, headers?: Record<string, string>): Promise<void> {
    const bridgeCall =
      this.config.bridgeCall ??
      (typeof window !== 'undefined'
        ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
            .BBeBeeBridge?.call
        : undefined)
    if (!bridgeCall) return

    try {
      const probed = (await bridgeCall('audio', 'probe', [src, { headers }])) as {
        sampleRate?: number
      }
      if (probed?.sampleRate) {
        await this.ensureContextSampleRate(probed.sampleRate)
      }
    } catch (err) {
      this.ctx.logger?.debug?.('wasapi: probe for streamed sample rate failed: %s', String(err))
    }
  }

  /**
   * A suspended context wraps the element in silence, and the element's own
   * `play()` would resolve while producing nothing. The user pressing play is
   * the gesture every policy needs, so the resume is safe to attempt here; a
   * refusal is logged, never thrown.
   */
  private readonly ensureContextRunning = (): void => {
    const lifecycle = this.context as BaseAudioContext & {
      state?: string
      resume?: () => Promise<void>
    }
    if ((lifecycle.state === 'suspended' || lifecycle.state === 'interrupted') && lifecycle.resume) {
      this.ctx.logger?.warn('wasapi: play() on a %s context — resuming', lifecycle.state)
      void lifecycle.resume().catch((err: unknown) => {
        this.ctx.logger?.warn('wasapi: context.resume() failed: %s', String(err))
      })
    }
  }

  private async loadBuffered(src: string, opts: LoadOptions): Promise<AudioSourceHandle> {
    const fetchBytes = this.config.fetchBytes ?? defaultFetchBytes
    const targetSrc =
      typeof src === 'string' && src.startsWith('file://') && typeof window !== 'undefined'
        ? src.replace(/^file:\/\//, 'bbebee-file://')
        : src
    this.ctx.logger?.debug?.('wasapi: fetching bytes for %s', targetSrc)
    const bytes = await fetchBytes(targetSrc, { headers: opts.headers, signal: opts.signal })
    opts.signal?.throwIfAborted()
    this.ctx.logger?.debug?.('wasapi: fetched %d bytes, decoding audio data', bytes.byteLength)

    const decode = (this.context as BaseAudioContext & { decodeAudioData: DecodeFn }).decodeAudioData
    let buffer: AudioBuffer
    try {
      buffer = await decode.call(this.context, bytes)
      this.ctx.logger?.info(
        'wasapi: decodeAudioData succeeded (%dms, %d channels, %dHz)',
        Math.round(buffer.duration * 1000),
        buffer.numberOfChannels,
        buffer.sampleRate,
      )

      if (buffer.sampleRate !== this.context.sampleRate) {
        await this.ensureContextSampleRate(buffer.sampleRate)
      }

      this.activeHardwareSampleRate = this.context.sampleRate
      this.activeHardwareChannels = buffer.numberOfChannels
      this.activeHardwareBitDepth = 16
    } catch (decodeErr) {
      this.ctx.logger?.error('wasapi: decodeAudioData failed for %s: %s', src, String(decodeErr))
      throw decodeErr
    }
    opts.signal?.throwIfAborted()

    opts.onBuffered?.(buffer.duration)
    return new WasapiAudioHandle(this.context, buffer, undefined, this.ctx.logger)
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
    await unlockMediaDeviceLabels(this.ctx.logger)

    const devices: OutputDevice[] = []
    const media = (globalThis as {
      navigator?: { mediaDevices?: { enumerateDevices: () => Promise<Array<{ deviceId: string; kind: string; label: string }>> } }
    }).navigator?.mediaDevices

    let rawOutputs: Array<{ deviceId: string; kind: string; label: string }> = []
    if (media?.enumerateDevices) {
      try {
        this.ctx.logger?.debug?.('wasapi: calling navigator.mediaDevices.enumerateDevices()...')
        const raw = await media.enumerateDevices()
        rawOutputs = raw.filter((d) => d.kind === 'audiooutput')
        this.ctx.logger?.info(
          'wasapi: enumerateDevices() returned %d total devices (%d audiooutput): %s',
          raw.length,
          rawOutputs.length,
          JSON.stringify(rawOutputs.map((d) => ({ deviceId: d.deviceId, label: d.label }))),
        )
      } catch (err) {
        this.ctx.logger?.warn('wasapi: enumerateDevices() failed: %s', String(err))
      }
    } else {
      this.ctx.logger?.debug?.('wasapi: navigator.mediaDevices.enumerateDevices is not available')
    }

    const bridgeCall =
      this.config.bridgeCall ??
      (typeof window !== 'undefined'
        ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
            .BBeBeeBridge?.call
        : undefined)

    let bridgeDevices: OutputDevice[] = []
    if (bridgeCall) {
      try {
        this.ctx.logger?.debug?.('wasapi: calling bridge getOutputDevices...')
        const fetched = (await bridgeCall('audio', 'getOutputDevices', [])) as OutputDevice[]
        if (Array.isArray(fetched) && fetched.length > 0) {
          bridgeDevices = fetched
          this.ctx.logger?.info(
            'wasapi: bridge getOutputDevices returned %d devices: %s',
            fetched.length,
            JSON.stringify(fetched.map((d) => ({ id: d.id, label: d.label, isDefault: d.isDefault, isVirtual: d.isVirtual }))),
          )
        } else {
          this.ctx.logger?.debug?.('wasapi: bridge getOutputDevices returned empty or non-array')
        }
      } catch (err) {
        this.ctx.logger?.warn('wasapi: bridge getOutputDevices failed: %s', String(err))
      }
    }

    if (rawOutputs.length > 0) {
      for (let i = 0; i < rawOutputs.length; i++) {
        const out = rawOutputs[i]!
        let label = out.label
        let matchReason = 'none'

        // Match with bridgeDevices solely for metadata (label & virtual card detection)
        let matchedBridge: OutputDevice | undefined
        if (bridgeDevices.length > 0) {
          if (!isGenericPlaceholder(label)) {
            const cleanL = normalizeBaseLabel(label)
            matchedBridge = bridgeDevices.find((b) => {
              const cleanB = normalizeBaseLabel(b.label)
              return cleanB === cleanL || cleanB.includes(cleanL) || cleanL.includes(cleanB)
            })
            if (matchedBridge) matchReason = `label match ("${cleanL}" ~ "${matchedBridge.label}")`
          }
          if (!matchedBridge) {
            if (out.deviceId === 'default') {
              matchedBridge = bridgeDevices.find((b) => b.isDefault) ?? bridgeDevices[0]
              matchReason = 'default device fallback'
            } else if (i < bridgeDevices.length) {
              matchedBridge = bridgeDevices[i]
              matchReason = `index match [${i}]`
            }
          }
        }

        if (isGenericPlaceholder(label) && matchedBridge?.label && !isGenericPlaceholder(matchedBridge.label)) {
          this.ctx.logger?.debug?.(
            'wasapi: replacing generic label "%s" (deviceId=%s) with native label "%s" via %s',
            label,
            out.deviceId,
            matchedBridge.label,
            matchReason,
          )
          label = matchedBridge.label
        }

        const { label: cleanLabel, isVirtual } = cleanAndTagDeviceLabel(
          label,
          out.deviceId,
          matchedBridge?.isVirtual,
        )

        const finalLabel = !isGenericPlaceholder(cleanLabel)
          ? cleanLabel
          : (matchedBridge?.label && !isGenericPlaceholder(matchedBridge.label) ? matchedBridge.label : '音频输出设备')

        this.ctx.logger?.debug?.(
          'wasapi: processed device[%d]: id="%s", raw="%s", final="%s", isVirtual=%s',
          i,
          out.deviceId,
          out.label,
          finalLabel,
          isVirtual,
        )

        // CRITICAL: WebAudio devices MUST use Chromium's deviceId, never native OS IDs!
        devices.push({
          id: out.deviceId,
          label: finalLabel,
          isDefault: out.deviceId === 'default',
          isVirtual,
        })
      }
    }

    if (devices.length > 0) {
      if (!this.activeDeviceLabel) {
        const def = devices.find((d) => d.isDefault) ?? devices[0]
        if (def) this.activeDeviceLabel = def.label
      }
      this.ctx.logger?.info(
        'wasapi: listOutputDevices returning %d processed devices: %s',
        devices.length,
        JSON.stringify(devices.map((d) => ({ id: d.id, label: d.label, isDefault: d.isDefault, isVirtual: d.isVirtual }))),
      )
      return devices
    }

    if (bridgeDevices.length > 0) {
      const fallbackLabel = cleanAndTagDeviceLabel(bridgeDevices[0]!.label).label || '音频输出设备'
      if (!this.activeDeviceLabel) this.activeDeviceLabel = fallbackLabel
      this.ctx.logger?.warn('wasapi: listOutputDevices fallback to bridge devices (1 device): %s', fallbackLabel)
      return [
        {
          id: 'default',
          label: fallbackLabel,
          isDefault: true,
          isVirtual: Boolean(bridgeDevices[0]!.isVirtual),
        },
      ]
    }

    this.ctx.logger?.warn('wasapi: listOutputDevices default fallback (no devices discovered anywhere)')
    return [{ id: 'default', label: '音频输出设备', isDefault: true, isVirtual: false }]
  }

  async setOutputDevice(id: string): Promise<void> {
    this.ctx.logger?.info('wasapi: setOutputDevice("%s") started', id)
    const bridgeCall =
      this.config.bridgeCall ??
      (typeof window !== 'undefined'
        ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
            .BBeBeeBridge?.call
        : undefined)

    if (bridgeCall) {
      // Find matching native bridge device if id is a Chromium deviceId
      let nativeId = id
      try {
        const fetched = (await bridgeCall('audio', 'getOutputDevices', [])) as OutputDevice[]
        if (Array.isArray(fetched) && fetched.length > 0) {
          if (id === 'default') {
            const defDev = fetched.find((f) => f.isDefault)
            nativeId = defDev?.id || 'default'
            this.activeDeviceLabel = defDev?.label || fetched[0]?.label
          } else {
            const media = (globalThis as {
              navigator?: { mediaDevices?: { enumerateDevices: () => Promise<Array<{ deviceId: string; kind: string; label: string }>> } }
            }).navigator?.mediaDevices
            if (media?.enumerateDevices) {
              const raw = await media.enumerateDevices()
              const matchedOut = raw.find((r) => r.deviceId === id)
              if (matchedOut?.label) {
                const cleanOut = normalizeBaseLabel(matchedOut.label)
                const foundNative = fetched.find((f) => {
                  const cleanF = normalizeBaseLabel(f.label)
                  return cleanF === cleanOut || cleanF.includes(cleanOut) || cleanOut.includes(cleanF)
                })
                if (foundNative?.id) {
                  nativeId = foundNative.id
                  this.activeDeviceLabel = foundNative.label
                }
              }
            }
          }
        }
      } catch (err) {
        this.ctx.logger?.warn('wasapi: setOutputDevice failed to resolve native device ID: %s', String(err))
      }
      this.ctx.logger?.info('wasapi: sending native deviceId "%s" to bridge audio.setOutputDevice', nativeId)
      try {
        await bridgeCall('audio', 'setOutputDevice', [nativeId])
        this.ctx.logger?.info('wasapi: bridge audio.setOutputDevice("%s") succeeded', nativeId)
      } catch (err) {
        this.ctx.logger?.error('wasapi: bridge audio.setOutputDevice("%s") failed: %s', nativeId, String(err))
      }
    }

    // Safety guard: never pass OS IDs (PnP InstanceId, MMDevice ID, ALSA hw) to Chromium setSinkId
    let targetId = id === 'default' ? '' : id
    if (targetId && (targetId.includes('\\') || targetId.includes('{') || targetId.startsWith('hw:'))) {
      this.ctx.logger?.warn('wasapi: setOutputDevice received raw OS ID "%s", sanitized to "" for Chromium setSinkId', targetId)
      targetId = ''
    }

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
    return async () => {
      this.ctx.logger?.info('wasapi: disposing audio service')
      this.chainInput.disconnect()
      this.master.disconnect()
      this.interruptionListeners.clear()
      this.routeListeners.clear()
      const closable = this.context as BaseAudioContext & { close?: () => Promise<void> }
      if (closable.close) await closable.close().catch(() => undefined)
    }
  }
}

function isGenericPlaceholder(label: string): boolean {
  if (!label) return true
  const trimmed = label.trim()
  return (
    trimmed === '' ||
    trimmed === '音频输出设备' ||
    trimmed.startsWith('音频输出设备 (') ||
    trimmed === '系统默认音频设备 (System Default)' ||
    trimmed === '系统默认音频设备' ||
    trimmed === '系统默认音频终端 (WASAPI Exclusive)' ||
    trimmed === '默认音频终端 (WASAPI Exclusive)' ||
    trimmed === '系统默认音频输出 (System Default)' ||
    trimmed === '默认音频设备' ||
    trimmed === 'Default Audio Device' ||
    trimmed === 'Audio Output Device'
  )
}

function normalizeBaseLabel(l: string): string {
  return (l || '')
    .toLowerCase()
    .replace(/\s*(\(虚拟\)|\[虚拟\])\s*$/g, '')
    .replace(/^(默认\s*[-–:：]\s*|default\s*[-–:：]\s*|系统默认\s*[-–:：]\s*)/i, '')
    .replace(/\s*\((system default|默认)\)$/i, '')
    .trim()
}

function cleanAndTagDeviceLabel(
  rawLabel: string,
  id?: string,
  isVirtualHint?: boolean,
): { label: string; isVirtual: boolean } {
  let label = (rawLabel || '')
    .replace(/^(默认\s*[-–:：]\s*|Default\s*[-–:：]\s*|系统默认\s*[-–:：]\s*)/i, '')
    .replace(/\s*\((System Default|默认)\)$/i, '')
    .trim()

  if (isGenericPlaceholder(label)) {
    label = ''
  }

  const isVirtual = Boolean(
    isVirtualHint ||
      /voicemeeter|vb-audio|vbaudio|virtual|虚拟|todesk|steam streaming|sonar|null sink|null-sink|null_sink|loopback|blackhole|soundflower|obs|easyeffects|pulseeffects|scream|discord/i.test(
        `${label} ${id || ''}`,
      ),
  )

  label = label.replace(/\s*(\(虚拟\)|\[虚拟\])\s*$/g, '').trim()
  if (isVirtual && label && !label.endsWith('(虚拟)')) {
    label = `${label} (虚拟)`
  }

  return { label, isVirtual }
}

let mediaDeviceLabelsUnlocked = false

async function unlockMediaDeviceLabels(logger?: AudioLogger): Promise<void> {
  if (mediaDeviceLabelsUnlocked) {
    logger?.debug?.('wasapi: unlockMediaDeviceLabels skipped, already unlocked')
    return
  }
  const nav = (globalThis as unknown as {
    navigator?: {
      permissions?: { query?: (q: { name: string }) => Promise<{ state: string }> }
      mediaDevices?: {
        getUserMedia?: (c: { audio: boolean }) => Promise<{ getTracks: () => Array<{ stop: () => void }> }>
      }
    }
  }).navigator
  if (!nav?.mediaDevices) {
    logger?.debug?.('wasapi: navigator.mediaDevices not available to unlock labels')
    return
  }

  try {
    if (typeof nav.permissions?.query === 'function') {
      logger?.debug?.('wasapi: querying speaker-selection permission...')
      const status = await nav.permissions.query({ name: 'speaker-selection' }).catch(() => null)
      logger?.debug?.('wasapi: speaker-selection status: %s', status?.state)
      if (status?.state === 'granted') {
        mediaDeviceLabelsUnlocked = true
        logger?.info?.('wasapi: speaker-selection permission is granted, device labels unlocked')
        return
      }
    }

    if (typeof nav.mediaDevices.getUserMedia === 'function') {
      logger?.debug?.('wasapi: requesting getUserMedia({ audio: true }) to unlock device labels...')
      const stream = await nav.mediaDevices.getUserMedia({ audio: true })
      const tracks = stream.getTracks()
      for (const track of tracks) {
        try {
          track.stop()
        } catch {
          // ignore
        }
      }
      mediaDeviceLabelsUnlocked = true
      logger?.info?.('wasapi: getUserMedia succeeded (%d tracks stopped), device labels unlocked', tracks.length)
    }
  } catch (err) {
    logger?.warn?.('wasapi: unlockMediaDeviceLabels failed: %s', String(err))
  }
}

export const name = 'core-audio-wasapi'

export async function apply(ctx: Context, config: AudioWasapiConfig = {}) {
  ctx.logger?.info('core-audio-wasapi: loaded')
  const fiber = await ctx.plugin(AudioWasapi, config)
  return () => void fiber.dispose()
}

export default AudioWasapi
