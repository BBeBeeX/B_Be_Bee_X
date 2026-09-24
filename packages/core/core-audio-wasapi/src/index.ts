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
  private readonly config: AudioWasapiConfig

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
    this.chainOutput = this.master
    this.chainInput.connect(this.master)

    // Initial setup: do NOT connect to this.context.destination if exclusive is enabled.
    // In environments where WASAPI is not active or during unit test, fallback to destination.
    if (config.enableExclusive === false) {
      this.master.connect(this.context.destination)
    }
    this.ctx.logger?.info(
      'core-audio-wasapi: initialized (sampleRate: %d, exclusive: %s)',
      this.sampleRate,
      config.enableExclusive !== false,
    )
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
    this.ctx.logger?.debug?.('wasapi: dipVolume duration %dms', durationMs)
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
    this.ctx.logger?.info('wasapi: loading %s (strategy: %s)', String(src), opts.strategy ?? 'stream')
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
        this.ctx.logger?.debug?.('wasapi: attempting bridge decodePcm for %s', String(src))
        const decoded = (await bridgeCall('audio', 'decodePcm', [src])) as {
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
          // Initialize WASAPI exclusive stream on main process
          this.ctx.logger?.info('wasapi: initializing WASAPI exclusive output (%dHz, %dch)', decoded.sampleRate, decoded.channels)
          await bridgeCall('audio', 'initWasapi', [
            {
              sampleRate: decoded.sampleRate,
              channels: decoded.channels,
              bitDepth: decoded.bitDepth || 24,
            },
          ]).catch((err) => {
            this.ctx.logger?.warn('wasapi: initWasapi error: %s', String(err))
          })

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
    } catch (decodeErr) {
      this.ctx.logger?.error('wasapi: decodeAudioData failed for %s: %s', src, String(decodeErr))
      throw decodeErr
    }
    opts.signal?.throwIfAborted()

    opts.onBuffered?.(buffer.duration)
    return new WasapiAudioHandle(this.context, buffer, undefined, this.ctx.logger)
  }

  private async ensureSinkWorklet(): Promise<void> {
    if (this.workletInitialized) return
    this.workletInitialized = true

    const ctx = this.context as BaseAudioContext & {
      audioWorklet?: { addModule(url: string): Promise<void> }
    }

    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      // Testing or environment without AudioWorklet support: fallback to destination
      this.ctx.logger?.warn('wasapi: audioWorklet not available in this environment, falling back to destination')
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
      this.ctx.logger?.info('wasapi: sink worklet initialized and connected')
    } catch (err) {
      this.ctx.logger?.error('wasapi: failed to initialize sink worklet, falling back to destination: %s', String(err))
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
    this.ctx.logger?.debug?.('wasapi: setVolume %d', clamped)
    this.mutedAt = undefined
    this.master.gain.value = clamped
  }

  setMuted(m: boolean): void {
    this.ctx.logger?.debug?.('wasapi: setMuted %s', m)
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
    await unlockMediaDeviceLabels()

    const devices: OutputDevice[] = []
    const media = (globalThis as {
      navigator?: { mediaDevices?: { enumerateDevices: () => Promise<Array<{ deviceId: string; kind: string; label: string }>> } }
    }).navigator?.mediaDevices

    let rawOutputs: Array<{ deviceId: string; kind: string; label: string }> = []
    if (media?.enumerateDevices) {
      try {
        const raw = await media.enumerateDevices()
        rawOutputs = raw.filter((d) => d.kind === 'audiooutput')
      } catch {
        // ignore
      }
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
        const fetched = (await bridgeCall('audio', 'getOutputDevices', [])) as OutputDevice[]
        if (Array.isArray(fetched) && fetched.length > 0) {
          bridgeDevices = fetched
        }
      } catch {
        // fallback
      }
    }

    if (rawOutputs.length > 0) {
      for (let i = 0; i < rawOutputs.length; i++) {
        const out = rawOutputs[i]!
        let label = out.label

        // Match with bridgeDevices solely for metadata (label & virtual card detection)
        let matchedBridge: OutputDevice | undefined
        if (bridgeDevices.length > 0) {
          if (!isGenericPlaceholder(label)) {
            const cleanL = normalizeBaseLabel(label)
            matchedBridge = bridgeDevices.find((b) => {
              const cleanB = normalizeBaseLabel(b.label)
              return cleanB === cleanL || cleanB.includes(cleanL) || cleanL.includes(cleanB)
            })
          }
          if (!matchedBridge) {
            if (out.deviceId === 'default') {
              matchedBridge = bridgeDevices.find((b) => b.isDefault) ?? bridgeDevices[0]
            } else if (i < bridgeDevices.length) {
              matchedBridge = bridgeDevices[i]
            }
          }
        }

        if (isGenericPlaceholder(label) && matchedBridge?.label && !isGenericPlaceholder(matchedBridge.label)) {
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
      this.ctx.logger?.debug?.('wasapi: listOutputDevices returned %d devices', devices.length)
      return devices
    }

    if (bridgeDevices.length > 0) {
      const fallbackLabel = cleanAndTagDeviceLabel(bridgeDevices[0]!.label).label || '音频输出设备'
      this.ctx.logger?.debug?.('wasapi: listOutputDevices fallback to bridge devices (1 device)')
      return [
        {
          id: 'default',
          label: fallbackLabel,
          isDefault: true,
          isVirtual: Boolean(bridgeDevices[0]!.isVirtual),
        },
      ]
    }

    this.ctx.logger?.debug?.('wasapi: listOutputDevices default fallback')
    return [{ id: 'default', label: '音频输出设备', isDefault: true, isVirtual: false }]
  }

  async setOutputDevice(id: string): Promise<void> {
    this.ctx.logger?.info('wasapi: setOutputDevice(%s)', id)
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
            nativeId = fetched.find((f) => f.isDefault)?.id || 'default'
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
                }
              }
            }
          }
        }
      } catch {
        // ignore
      }
      await bridgeCall('audio', 'setOutputDevice', [nativeId]).catch(() => {})
    }

    // Safety guard: never pass OS IDs (PnP InstanceId, MMDevice ID, ALSA hw) to Chromium setSinkId
    let targetId = id === 'default' ? '' : id
    if (targetId && (targetId.includes('\\') || targetId.includes('{') || targetId.startsWith('hw:'))) {
      targetId = ''
    }

    const sink = (this.context as BaseAudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId
    if (typeof sink === 'function') {
      await sink.call(this.context, targetId).catch(() => {})
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
      if (this.sinkNode) {
        this.sinkNode.disconnect()
        this.sinkNode = undefined
      }
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

async function unlockMediaDeviceLabels(): Promise<void> {
  if (mediaDeviceLabelsUnlocked) return
  const nav = (globalThis as unknown as {
    navigator?: {
      permissions?: { query?: (q: { name: string }) => Promise<{ state: string }> }
      mediaDevices?: {
        getUserMedia?: (c: { audio: boolean }) => Promise<{ getTracks: () => Array<{ stop: () => void }> }>
      }
    }
  }).navigator
  if (!nav?.mediaDevices) return

  try {
    if (typeof nav.permissions?.query === 'function') {
      const status = await nav.permissions.query({ name: 'speaker-selection' }).catch(() => null)
      if (status?.state === 'granted') {
        mediaDeviceLabelsUnlocked = true
        return
      }
    }

    if (typeof nav.mediaDevices.getUserMedia === 'function') {
      const stream = await nav.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          // ignore
        }
      }
      mediaDeviceLabelsUnlocked = true
    }
  } catch {
    // ignore
  }
}

export const name = 'core-audio-wasapi'

export async function apply(ctx: Context, config: AudioWasapiConfig = {}) {
  ctx.logger?.info('core-audio-wasapi: loaded')
  const fiber = await ctx.plugin(AudioWasapi, config)
  return () => void fiber.dispose()
}

export default AudioWasapi
