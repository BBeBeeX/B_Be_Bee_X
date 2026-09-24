import type { AudioSourceHandle, Disposable } from '@BBeBee/protocol'

export interface AudioLogger {
  debug?(message: string, ...args: unknown[]): void
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
}

export class WasapiAudioHandle implements AudioSourceHandle {
  readonly node: GainNode
  readonly durationMs: number

  private source?: AudioBufferSourceNode
  private startedAt = 0
  private offsetSeconds = 0
  private playing = false
  private disposed = false
  private readonly endedListeners = new Set<() => void>()
  private readonly stallListeners = new Set<(stalled: boolean) => void>()

  private readonly context: BaseAudioContext
  private readonly buffer: AudioBuffer
  private readonly logger?: AudioLogger

  constructor(
    context: BaseAudioContext,
    buffer: AudioBuffer,
    durationMs?: number,
    logger?: AudioLogger,
  ) {
    this.context = context
    this.buffer = buffer
    this.logger = logger
    this.node = context.createGain()
    this.durationMs = durationMs ?? Math.round(buffer.duration * 1000)
    this.logger?.debug?.('wasapi: [handle] handle created (duration: %dms)', this.durationMs)
  }

  get positionMs(): number {
    if (!this.playing) return Math.round(this.offsetSeconds * 1000)
    const elapsed = this.context.currentTime - this.startedAt
    return Math.round(Math.min(this.offsetSeconds + elapsed, this.buffer.duration) * 1000)
  }

  play(atMs?: number): void {
    if (this.disposed) return
    if (atMs !== undefined) this.offsetSeconds = Math.max(0, atMs / 1000)
    this.logger?.debug?.('wasapi: [handle] play (offsetSeconds: %s)', this.offsetSeconds)
    this.stopSource()

    const source = this.context.createBufferSource()
    source.buffer = this.buffer
    source.connect(this.node)

    source.onended = () => {
      if (this.source !== source) return
      this.logger?.debug?.('wasapi: [handle] playback ended')
      this.playing = false
      this.offsetSeconds = this.buffer.duration
      for (const listener of this.endedListeners) listener()
    }

    this.startedAt = this.context.currentTime
    this.playing = true
    this.source = source
    source.start(0, this.offsetSeconds)
  }

  pause(): void {
    if (this.disposed || !this.playing) return
    const elapsed = this.context.currentTime - this.startedAt
    this.offsetSeconds = Math.min(this.offsetSeconds + elapsed, this.buffer.duration)
    this.playing = false
    this.logger?.debug?.('wasapi: [handle] pause (position: %dms)', Math.round(this.offsetSeconds * 1000))
    this.stopSource()
  }

  stop(): void {
    if (this.disposed) return
    this.logger?.debug?.('wasapi: [handle] stop')
    this.playing = false
    this.offsetSeconds = 0
    this.stopSource()
  }

  seek(atMs: number): void {
    if (this.disposed) return
    this.logger?.debug?.('wasapi: [handle] seek to %dms', atMs)
    const wasPlaying = this.playing
    this.offsetSeconds = Math.max(0, Math.min(atMs / 1000, this.buffer.duration))
    this.stopSource()
    if (wasPlaying) {
      this.play(this.offsetSeconds * 1000)
    }
  }

  onEnded(cb: () => void): Disposable {
    this.endedListeners.add(cb)
    return () => {
      this.endedListeners.delete(cb)
    }
  }

  onStalled(cb: (stalled: boolean) => void): Disposable {
    this.stallListeners.add(cb)
    return () => {
      this.stallListeners.delete(cb)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.logger?.debug?.('wasapi: [handle] handle disposed')
    this.disposed = true
    this.playing = false
    this.stopSource()
    this.endedListeners.clear()
    this.stallListeners.clear()
    this.node.disconnect()
  }

  private stopSource(): void {
    if (!this.source) return
    const s = this.source
    this.source = undefined
    try {
      s.onended = null
      s.stop()
      s.disconnect()
    } catch {
      // In case source was already stopped or unstarted
    }
  }
}
