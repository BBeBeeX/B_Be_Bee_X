/**
 * In-process FFT and spectrum processor for native audio-engine.
 *
 * Implements:
 * - Hanning windowing to minimize spectral leakage
 * - Radix-2 Cooley-Tukey FFT
 * - Magnitude calculation and dB normalization to 0..255 (Web Audio AnalyserNode semantics)
 * - Temporal smoothing (smoothingTimeConstant)
 * - Time-domain waveform extraction centered at 128
 */

export interface FftProcessorOptions {
  fftSize?: number
  minDecibels?: number
  maxDecibels?: number
  smoothingTimeConstant?: number
}

export class FftProcessor {
  private fftSize: number
  private minDecibels: number
  private maxDecibels: number
  private smoothingTimeConstant: number

  private windowLut: Float32Array
  private prevFrequencyData: Float32Array
  private real: Float32Array
  private imag: Float32Array

  constructor(options: FftProcessorOptions = {}) {
    this.fftSize = options.fftSize ?? 128
    this.minDecibels = options.minDecibels ?? -100
    this.maxDecibels = options.maxDecibels ?? -30
    this.smoothingTimeConstant = options.smoothingTimeConstant ?? 0.82

    const binCount = this.fftSize / 2
    this.windowLut = new Float32Array(this.fftSize)
    this.prevFrequencyData = new Float32Array(binCount)
    this.real = new Float32Array(this.fftSize)
    this.imag = new Float32Array(this.fftSize)

    this.computeWindowLut()
  }

  get frequencyBinCount(): number {
    return this.fftSize / 2
  }

  get size(): number {
    return this.fftSize
  }

  setFftSize(newSize: number): void {
    if (newSize === this.fftSize) return
    // Ensure power of 2
    const size = Math.max(32, Math.min(2048, 1 << Math.round(Math.log2(newSize))))
    this.fftSize = size
    const binCount = size / 2
    this.windowLut = new Float32Array(size)
    this.prevFrequencyData = new Float32Array(binCount)
    this.real = new Float32Array(size)
    this.imag = new Float32Array(size)
    this.computeWindowLut()
  }

  setSmoothingTimeConstant(value: number): void {
    this.smoothingTimeConstant = Math.max(0, Math.min(1, value))
  }

  private computeWindowLut(): void {
    const N = this.fftSize
    for (let i = 0; i < N; i++) {
      // Hanning window
      this.windowLut[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
    }
  }

  /**
   * Process a chunk of Float32 audio samples (mono or downmixed stereo).
   * Returns normalized byte frequency spectrum (0..255) and time domain (0..255).
   */
  process(samples: Float32Array | number[]): {
    frequencyData: Uint8Array
    timeDomainData: Uint8Array
  } {
    const N = this.fftSize
    const binCount = N / 2
    const sampleLen = samples.length

    // Extract time domain and prepare real part with window
    const timeDomain = new Uint8Array(N)
    for (let i = 0; i < N; i++) {
      const s = i < sampleLen ? (samples[i] ?? 0) : 0
      // Time domain: map -1.0..+1.0 to 0..255 centered around 128
      const clamped = Math.max(-1, Math.min(1, s))
      timeDomain[i] = Math.round(128 + clamped * 127)

      // Windowed real input for FFT
      this.real[i] = s * this.windowLut[i]!
      this.imag[i] = 0
    }

    // Perform Cooley-Tukey Radix-2 FFT in-place
    this.transform(this.real, this.imag)

    // Compute magnitude and normalize to dB (0..255)
    const frequencyData = new Uint8Array(binCount)
    const range = this.maxDecibels - this.minDecibels
    const invRange = range > 0 ? 255 / range : 1

    for (let i = 0; i < binCount; i++) {
      const re = this.real[i]!
      const im = this.imag[i]!
      const mag = Math.sqrt(re * re + im * im) / N

      // Convert to dB
      const db = mag > 0.000001 ? 20 * Math.log10(mag) : this.minDecibels

      // Normalize to 0..255
      const normalized = Math.max(0, Math.min(255, (db - this.minDecibels) * invRange))

      // Apply smoothing time constant
      const smoothed =
        this.smoothingTimeConstant * this.prevFrequencyData[i]! +
        (1 - this.smoothingTimeConstant) * normalized
      this.prevFrequencyData[i] = smoothed
      frequencyData[i] = Math.round(smoothed)
    }

    return { frequencyData, timeDomainData: timeDomain }
  }

  /**
   * In-place Radix-2 Decimation-In-Time FFT
   */
  private transform(real: Float32Array, imag: Float32Array): void {
    const n = real.length
    if ((n & (n - 1)) !== 0) return // Must be power of 2

    // Bit-reversal permutation
    let j = 0
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        const tempR = real[i]!
        real[i] = real[j]!
        real[j] = tempR
        const tempI = imag[i]!
        imag[i] = imag[j]!
        imag[j] = tempI
      }
      let k = n >> 1
      while (k <= j) {
        j -= k
        k >>= 1
      }
      j += k
    }

    // Cooley-Tukey computation
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1
      const angle = (-2 * Math.PI) / len
      const wStepR = Math.cos(angle)
      const wStepI = Math.sin(angle)

      for (let i = 0; i < n; i += len) {
        let wR = 1
        let wI = 0
        for (let k = 0; k < halfLen; k++) {
          const idxEven = i + k
          const idxOdd = i + k + halfLen

          const oddR = real[idxOdd]!
          const oddI = imag[idxOdd]!

          const tr = wR * oddR - wI * oddI
          const ti = wR * oddI + wI * oddR

          real[idxOdd] = real[idxEven]! - tr
          imag[idxOdd] = imag[idxEven]! - ti
          real[idxEven] = real[idxEven]! + tr
          imag[idxEven] = imag[idxEven]! + ti

          const nextWR = wR * wStepR - wI * wStepI
          wI = wR * wStepI + wI * wStepR
          wR = nextWR
        }
      }
    }
  }
}
