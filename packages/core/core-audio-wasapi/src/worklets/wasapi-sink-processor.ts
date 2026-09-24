/**
 * The AudioWorklet processor that intercepts audio output from the Web Audio DSP graph.
 *
 * It extracts stereo interleaved Float32 PCM samples and writes them directly
 * to a SharedArrayBuffer RingBuffer (or posts them via message port) destined for
 * the native WASAPI Exclusive output thread.
 *
 * It intentionally leaves outputs empty so audio NEVER reaches context.destination
 * and bypasses Chromium's OS shared mixer.
 */
export const WASAPI_SINK_WORKLET_NAME = 'wasapi-sink-processor'

export const WASAPI_SINK_WORKLET_CODE = `
class WasapiSinkProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.sharedBuffer = null
    this.indices = null
    this.storage = null
    this.capacity = 0
    this.temp = new Float32Array(256)

    if (options && options.processorOptions && options.processorOptions.sharedBuffer) {
      this.initSharedBuffer(options.processorOptions.sharedBuffer)
    }

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'init-buffer') {
        this.initSharedBuffer(event.data.sharedBuffer)
      }
    }
  }

  initSharedBuffer(buf) {
    this.sharedBuffer = buf
    this.indices = new Int32Array(this.sharedBuffer, 0, 2)
    this.storage = new Float32Array(this.sharedBuffer, 8)
    this.capacity = this.storage.length
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (!input || !input[0]) return true

    const left = input[0]
    const right = input[1] || input[0]
    const frameCount = left.length
    const needed = frameCount * 2

    if (this.storage && this.indices) {
      const writeIdx = Atomics.load(this.indices, 0)
      const readIdx = Atomics.load(this.indices, 1)
      const available = (readIdx - writeIdx - 1 + this.capacity) % this.capacity

      if (available >= needed) {
        for (let i = 0; i < frameCount; i++) {
          this.storage[(writeIdx + i * 2) % this.capacity] = left[i]
          this.storage[(writeIdx + i * 2 + 1) % this.capacity] = right[i]
        }
        Atomics.store(this.indices, 0, (writeIdx + needed) % this.capacity)
      }
    } else {
      if (this.temp.length < needed) {
        this.temp = new Float32Array(needed)
      }
      for (let i = 0; i < frameCount; i++) {
        this.temp[i * 2] = left[i]
        this.temp[i * 2 + 1] = right[i]
      }
      this.port.postMessage({ type: 'pcm-chunk', data: this.temp.slice(0, needed) })
    }

    // Do NOT write to outputs[0], keep destination silent
    return true
  }
}

registerProcessor('wasapi-sink-processor', WasapiSinkProcessor)
`
