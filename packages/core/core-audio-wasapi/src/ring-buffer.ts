/**
 * Lock-free Single-Producer Single-Consumer (SPSC) RingBuffer for audio PCM stream.
 * Uses SharedArrayBuffer and Atomics for zero-copy and lock-free thread coordination.
 */
export class SharedRingBuffer {
  private readonly indices: Int32Array
  private readonly storage: Float32Array
  private readonly capacity: number

  constructor(sharedBuffer: SharedArrayBuffer | ArrayBuffer) {
    this.indices = new Int32Array(sharedBuffer, 0, 2)
    this.storage = new Float32Array(sharedBuffer, 8)
    this.capacity = this.storage.length
  }

  static createBuffer(capacitySamples: number): SharedArrayBuffer | ArrayBuffer {
    const byteLength = 8 + capacitySamples * 4
    if (typeof SharedArrayBuffer !== 'undefined') {
      return new SharedArrayBuffer(byteLength)
    }
    return new ArrayBuffer(byteLength)
  }

  get totalCapacity(): number {
    return this.capacity
  }

  availableRead(): number {
    const writeIdx = Atomics.load(this.indices, 0)
    const readIdx = Atomics.load(this.indices, 1)
    return (writeIdx - readIdx + this.capacity) % this.capacity
  }

  availableWrite(): number {
    const writeIdx = Atomics.load(this.indices, 0)
    const readIdx = Atomics.load(this.indices, 1)
    return (readIdx - writeIdx - 1 + this.capacity) % this.capacity
  }

  write(data: Float32Array): number {
    const writeIdx = Atomics.load(this.indices, 0)
    const readIdx = Atomics.load(this.indices, 1)

    const available = (readIdx - writeIdx - 1 + this.capacity) % this.capacity
    const toWrite = Math.min(data.length, available)

    for (let i = 0; i < toWrite; i++) {
      this.storage[(writeIdx + i) % this.capacity] = data[i]!
    }

    Atomics.store(this.indices, 0, (writeIdx + toWrite) % this.capacity)
    return toWrite
  }

  read(target: Float32Array): number {
    const writeIdx = Atomics.load(this.indices, 0)
    const readIdx = Atomics.load(this.indices, 1)

    const available = (writeIdx - readIdx + this.capacity) % this.capacity
    const toRead = Math.min(target.length, available)

    for (let i = 0; i < toRead; i++) {
      target[i] = this.storage[(readIdx + i) % this.capacity]!
    }

    Atomics.store(this.indices, 1, (readIdx + toRead) % this.capacity)
    return toRead
  }

  reset(): void {
    Atomics.store(this.indices, 0, 0)
    Atomics.store(this.indices, 1, 0)
  }
}
