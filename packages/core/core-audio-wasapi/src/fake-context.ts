/**
 * Fake AudioContext for testing AudioWasapi.
 */
export interface FakeClock {
  advance(ms: number): Promise<void>
  now(): number
}

class FakeParam {
  constructor(public value: number) {}
  setTargetAtTime(target: number): void {
    this.value = target
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode>()
  connectCount = 0
  disconnectCount = 0

  connect(destination: FakeNode): FakeNode {
    this.outputs.add(destination)
    this.connectCount++
    return destination
  }

  disconnect(): void {
    this.outputs.clear()
    this.disconnectCount++
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1)
}

class FakeBufferSource extends FakeNode {
  buffer: FakeAudioBuffer | null = null
  onended: (() => void) | null = null
  started = false
  stopped = false
  startOffset = 0
  startedAt = 0

  constructor(private readonly context: FakeAudioContext) {
    super()
  }

  start(_when = 0, offset = 0): void {
    if (this.started) throw new Error('cannot start a source twice')
    this.started = true
    this.startOffset = offset
    this.startedAt = this.context.currentTime
    if (this.buffer) {
      this.context.schedule(this.buffer.duration - offset, () => {
        if (this.stopped) return
        this.stopped = true
        this.onended?.()
      })
    }
  }

  stop(): void {
    if (!this.started) throw new Error('cannot stop a source that never started')
    if (this.stopped) throw new Error('cannot stop a source twice')
    this.stopped = true
  }
}

export class FakeAudioBuffer {
  constructor(
    readonly duration: number,
    readonly sampleRate: number,
    readonly numberOfChannels = 2,
  ) {}

  get length(): number {
    return Math.round(this.duration * this.sampleRate)
  }

  getChannelData(_channel: number): Float32Array {
    return new Float32Array(this.length)
  }

  copyToChannel(source: Float32Array, channelNumber: number, startInChannel = 0): void {
    void source
    void channelNumber
    void startInChannel
  }
}

interface Scheduled {
  at: number
  run(): void
}

export class FakeAudioContext {
  readonly sampleRate = 48_000
  readonly baseLatency = 0.01
  readonly destination = new FakeNode()
  currentTime = 0
  closed = false
  decodedDuration = 2

  private readonly scheduled: Scheduled[] = []
  readonly audioWorklet = {
    addModule: async (_url: string) => {},
  }

  createGain(): FakeGain {
    return new FakeGain()
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this)
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length / sampleRate, sampleRate, channels)
  }

  createAnalyser(): FakeNode {
    return new FakeNode()
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer(this.decodedDuration, this.sampleRate)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  schedule(afterSeconds: number, run: () => void): void {
    this.scheduled.push({ at: this.currentTime + Math.max(0, afterSeconds), run })
  }

  async advance(ms: number): Promise<void> {
    const target = this.currentTime + ms / 1000
    for (;;) {
      const next = this.scheduled
        .filter((s) => s.at <= target)
        .sort((a, b) => a.at - b.at)
        .shift()
      if (!next) break
      this.scheduled.splice(this.scheduled.indexOf(next), 1)
      this.currentTime = next.at
      next.run()
      await Promise.resolve()
    }
    this.currentTime = target
    await Promise.resolve()
  }
}

export function createFakeAudioContext(): FakeAudioContext {
  return new FakeAudioContext()
}
