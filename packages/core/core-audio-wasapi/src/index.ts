/**
 * `ctx.audio` — WASAPI Exclusive output engine with Web Audio DSP chain.
 *
 * Implements Paradigm 1:
 * - FFmpeg decodes ALAC, 24-bit/32-bit Hi-Res audio into Float32 PCM.
 * - Web Audio acts as the pure memory DSP processing engine (EQ, preamp, compressor, AnalyserNode).
 * - An AudioWorklet intercepts the processed Float32 PCM directly from `master` and passes
 *   it to the native WASAPI Exclusive output thread, bypassing Chromium's default
 *   `context.destination` and avoiding Windows OS Shared Mode resampling.
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
import { WasapiAudioHandle } from './wasapi-audio-handle.js'
import { SharedRingBuffer } from './ring-buffer.js'
import { WASAPI_SINK_WORKLET_CODE, WASAPI_SINK_WORKLET_NAME } from './worklets/wasapi-sink-processor.js'

export interface AudioWasapiConfig {
  createContext?: () => BaseAudioContext
  fetchBytes?: (
    src: string,
    opts: { headers?: Record<string, string>; signal?: AbortSignal },
  ) => Promise<ArrayBuffer>
  bridgeCall?: (service: string, method: string, args: unknown[]) => Promise<unknown>
  enableExclusive?: boolean
}

type DecodeFn = (data: ArrayBuffer) => Promise<AudioBuffer>

function defaultContextFactory(): () => BaseAudioContext {
  return () => {
    const Ctor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      throw new Error('audio-wasapi: no AudioContext available in global scope')
    }
    return new Ctor()
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

  readonly context: BaseAudioContext
  readonly chainInput: GainNode
  readonly chainOutput: GainNode
  private readonly master: GainNode
  private sinkNode?: AudioNode
  private sharedRing?: SharedRingBuffer
  private mutedAt?: number
  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()
  private workletInitialized = false

  constructor(
    ctx: Context,
    private readonly config: AudioWasapiConfig = {},
  ) {
    super(ctx, 'audio')

    const create = config.createContext ?? defaultContextFactory()
    this.context = create()

    this.chainInput = this.context.createGain()
    this.master = this.context.createGain()
    this.chainOutput = this.master
    this.chainInput.connect(this.master)

    // Initial setup: do NOT connect to this.context.destination if exclusive is enabled.
    // In environments where WASAPI is not active or during unit test, fallback to destination.
    if (config.enableExclusive === false) {
      this.master.connect(this.context.destination)
    }
  }

  get destination(): AudioNode {
    return this.master
  }

  get sampleRate(): number {
    return this.context.sampleRate
  }

  get outputLatencyMs(): number {
    return 15 // WASAPI Exclusive mode achieves 10-20ms low latency
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

  async load(src: string | Uri, opts: LoadOptions): Promise<AudioSourceHandle> {
    this.gate()
    await this.ensureSinkWorklet()

    const bridgeCall =
      this.config.bridgeCall ??
      (typeof window !== 'undefined'
        ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
            .BBeBeeBridge?.call
        : undefined)

    // Attempt FFmpeg decode through bridge for ALAC and Hi-Res formats
    if (bridgeCall) {
      try {
        const decoded = (await bridgeCall('audio', 'decodePcm', [src])) as {
          sampleRate: number
          channels: number
          bitDepth?: number
          durationMs: number
          pcm: Float32Array[]
        }

        if (decoded && decoded.pcm && decoded.pcm.length > 0 && decoded.pcm[0]?.length) {
          // Initialize WASAPI exclusive stream on main process
          await bridgeCall('audio', 'initWasapi', [
            {
              sampleRate: decoded.sampleRate,
              channels: decoded.channels,
              bitDepth: decoded.bitDepth || 24,
            },
          ]).catch(() => {})

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
            if (typeof buffer.copyToChannel === 'function') {
              buffer.copyToChannel(decoded.pcm[c]!, c)
            } else if (typeof buffer.getChannelData === 'function') {
              const channelData = buffer.getChannelData(c)
              channelData.set(decoded.pcm[c]!)
            }
          }

          opts.onBuffered?.(buffer.duration)
          return new WasapiAudioHandle(this.context, buffer)
        }
      } catch {
        // Fall back to standard byte fetch and decode
      }
    }

    // Standard fallback: fetch raw bytes and decodeAudioData
    return this.loadBuffered(src, opts)
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

    opts.onBuffered?.(buffer.duration)
    return new WasapiAudioHandle(this.context, buffer)
  }

  private async ensureSinkWorklet(): Promise<void> {
    if (this.workletInitialized) return
    this.workletInitialized = true

    const ctx = this.context as BaseAudioContext & {
      audioWorklet?: { addModule(url: string): Promise<void> }
    }

    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      // Testing or environment without AudioWorklet support: fallback to destination
      try {
        this.master.connect(this.context.destination)
      } catch {
        // ignore
      }
      return
    }

    try {
      const blob = new Blob([WASAPI_SINK_WORKLET_CODE], { type: 'application/javascript' })
      const workletUrl = URL.createObjectURL(blob)
      await ctx.audioWorklet.addModule(workletUrl)
      URL.revokeObjectURL(workletUrl)

      const sharedBuffer = SharedRingBuffer.createBuffer(48000 * 2) // 1 second buffer
      this.sharedRing = new SharedRingBuffer(sharedBuffer)

      const sinkNode = new AudioWorkletNode(this.context as AudioContext, WASAPI_SINK_WORKLET_NAME, {
        processorOptions: { sharedBuffer },
      })

      sinkNode.port.onmessage = (event) => {
        if (event.data?.type === 'pcm-chunk' && event.data?.data) {
          const bridgeCall =
            this.config.bridgeCall ??
            (typeof window !== 'undefined'
              ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
                  .BBeBeeBridge?.call
              : undefined)
          if (bridgeCall) {
            void bridgeCall('audio', 'writeWasapi', [event.data.data])
          }
        }
      }

      this.master.connect(sinkNode)
      this.sinkNode = sinkNode
    } catch {
      // Fallback to destination if worklet registration fails
      try {
        this.master.connect(this.context.destination)
      } catch {
        // ignore
      }
    }
  }

  private gate(): void {
    assertGranted(this[Service.resolveConfig](), 'audio')
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v))
    this.mutedAt = undefined
    this.master.gain.value = clamped
  }

  setMuted(m: boolean): void {
    if (m) {
      if (this.mutedAt === undefined) this.mutedAt = this.master.gain.value
      this.master.gain.value = 0
    } else {
      const restore = this.mutedAt ?? 1
      this.mutedAt = undefined
      this.master.gain.value = restore
    }
  }

  async listOutputDevices(): Promise<OutputDevice[]> {
    const bridgeCall =
      this.config.bridgeCall ??
      (typeof window !== 'undefined'
        ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
            .BBeBeeBridge?.call
        : undefined)

    if (bridgeCall) {
      try {
        const devices = (await bridgeCall('audio', 'getOutputDevices', [])) as OutputDevice[]
        if (Array.isArray(devices) && devices.length > 0) return devices
      } catch {
        // fallback
      }
    }

    return [{ id: 'wasapi-exclusive', label: 'Windows Audio Endpoint (WASAPI Exclusive)', isDefault: true }]
  }

  async setOutputDevice(_id: string): Promise<void> {
    // Handled by WASAPI exclusive device selection on main process
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
}

export default AudioWasapi
