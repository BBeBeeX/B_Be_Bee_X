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
import { WasapiAudioHandle, type AudioLogger } from './wasapi-audio-handle.js'
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
  private targetVolume = 0.8
  private sinkNode?: AudioNode
  private sharedRing?: SharedRingBuffer
  private mutedAt?: number
  private readonly interruptionListeners = new Set<(e: InterruptionEvent) => void>()
  private readonly routeListeners = new Set<(e: RouteChangeEvent) => void>()
  private workletInitialized = false
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
    return this.activeHardwareSampleRate ?? this.context.sampleRate
  }

  get hardwareBitDepth(): number {
    return this.activeHardwareBitDepth ?? (this.config.enableExclusive !== false ? 24 : 16)
  }

  get hardwareChannels(): number {
    return this.activeHardwareChannels ?? 2
  }

  get currentDeviceLabel(): string | undefined {
    return this.activeDeviceLabel
  }

  get outputLatencyMs(): number {
    return 15 // WASAPI Exclusive mode achieves 10-20ms low latency
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
          const initRes = (await bridgeCall('audio', 'initWasapi', [
            {
              sampleRate: decoded.sampleRate,
              channels: decoded.channels,
              bitDepth: decoded.bitDepth || 24,
            },
          ]).catch((err) => {
            this.ctx.logger?.warn('wasapi: initWasapi error: %s', String(err))
          })) as { actualSampleRate?: number; actualBitDepth?: number; ok?: boolean } | undefined

          this.activeHardwareSampleRate = initRes?.actualSampleRate ?? decoded.sampleRate
          this.activeHardwareBitDepth = initRes?.actualBitDepth ?? decoded.bitDepth ?? 24
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

      this.activeHardwareSampleRate = buffer.sampleRate
      this.activeHardwareChannels = buffer.numberOfChannels
      this.activeHardwareBitDepth = 16

      const bridgeCall =
        this.config.bridgeCall ??
        (typeof window !== 'undefined'
          ? (window as unknown as { BBeBeeBridge?: { call?: (s: string, m: string, a: unknown[]) => Promise<unknown> } })
              .BBeBeeBridge?.call
          : undefined)
      if (bridgeCall) {
        const initRes = (await bridgeCall('audio', 'initWasapi', [
          {
            sampleRate: buffer.sampleRate,
            channels: buffer.numberOfChannels,
            bitDepth: 16,
          },
        ]).catch(() => undefined)) as { actualSampleRate?: number; actualBitDepth?: number } | undefined
        if (initRes?.actualSampleRate) {
          this.activeHardwareSampleRate = initRes.actualSampleRate
        }
        if (initRes?.actualBitDepth) {
          this.activeHardwareBitDepth = initRes.actualBitDepth
        }
      }
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
