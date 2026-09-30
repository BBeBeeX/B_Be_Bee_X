/**
 * WebGL-accelerated audio spectrum and waveform renderer.
 *
 * Provides GPU-accelerated rendering for VisualizerCanvas with vertex/fragment shaders.
 * Falls back gracefully to 2D Canvas if WebGL is unavailable or un-accelerated.
 */

import type { VisualizerColorTheme, VisualizerStyle } from '@BBeBee/protocol'

const VS_SOURCE = `
  attribute vec2 a_position;
  attribute vec4 a_color;
  varying vec4 v_color;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_color = a_color;
  }
`

const FS_SOURCE = `
  precision mediump float;
  varying vec4 v_color;

  void main() {
    gl_FragColor = v_color;
  }
`

export class WebGlVisualizer {
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private positionBuffer: WebGLBuffer | null = null
  private colorBuffer: WebGLBuffer | null = null
  private aPosition = -1
  private aColor = -1

  constructor(canvas: HTMLCanvasElement) {
    try {
      this.gl = canvas.getContext('webgl', { alpha: true, antialias: true })
      if (!this.gl) return
      this.initShaders()
    } catch {
      this.gl = null
    }
  }

  get isSupported(): boolean {
    return this.gl !== null && this.program !== null
  }

  private initShaders(): void {
    const gl = this.gl
    if (!gl) return

    const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE)
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE)
    if (!vs || !fs) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      return
    }

    this.program = program
    this.aPosition = gl.getAttribLocation(program, 'a_position')
    this.aColor = gl.getAttribLocation(program, 'a_color')

    this.positionBuffer = gl.createBuffer()
    this.colorBuffer = gl.createBuffer()
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl
    if (!gl) return null
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  render(
    freq: Uint8Array | null,
    _wave: Uint8Array | null,
    style: VisualizerStyle,
    theme: VisualizerColorTheme,
    width: number,
    height: number,
  ): boolean {
    const gl = this.gl
    if (!gl || !this.program || !this.positionBuffer || !this.colorBuffer) return false

    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Render bars in WebGL
    if (style === 'bars') {
      const binCount = freq ? freq.length : 32
      const barCount = Math.min(binCount, 48)
      const positions: number[] = []
      const colors: number[] = []

      const gap = 3 / width
      const totalWidth = 2.0 // -1 to 1 in WebGL coords
      const barWidth = Math.max(0.01, (totalWidth - (barCount - 1) * gap) / barCount)

      for (let i = 0; i < barCount; i++) {
        const val = freq ? (freq[i] ?? 0) / 255 : 0
        const barHeight = Math.max(0.04, val * 1.8) // map to 0..2
        const x1 = -1.0 + i * (barWidth + gap)
        const x2 = x1 + barWidth
        const y1 = -1.0
        const y2 = y1 + barHeight

        // Quad triangles: (x1, y1), (x2, y1), (x1, y2), (x1, y2), (x2, y1), (x2, y2)
        positions.push(x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2)

        const posFactor = i / barCount
        const [r, g, b] = this.getThemeRgb(theme, posFactor)
        // Top vertices (y2) have higher brightness, bottom (y1) lower
        const colTop = [r, g, b, 0.95]
        const colBot = [r * 0.7, g * 0.7, b * 0.7, 0.4]

        colors.push(...colBot, ...colBot, ...colTop, ...colTop, ...colBot, ...colTop)
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(this.aPosition)
      gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(this.aColor)
      gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, 0, 0)

      gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2)
      return true
    }

    return false // Fall back to 2D canvas for other complex paths
  }

  private getThemeRgb(theme: VisualizerColorTheme, pos: number): [number, number, number] {
    switch (theme) {
      case 'neon':
        return [(96 * (1 - pos)) / 255, (255 - 15 * pos) / 255, (180 + 75 * pos) / 255]
      case 'rainbow': {
        const hue = pos * 300
        return this.hslToRgb(hue / 360, 0.85, 0.6)
      }
      case 'monochrome':
        return [0.92, 0.92, 0.96]
      case 'accent':
      default:
        return [(95 + (169 - 95) * pos) / 255, (135 + (156 - 135) * pos) / 255, 1.0]
    }
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const r = this.hueToRgb(p, q, h + 1 / 3)
    const g = this.hueToRgb(p, q, h)
    const b = this.hueToRgb(p, q, h - 1 / 3)
    return [r, g, b]
  }

  private hueToRgb(p: number, q: number, t: number): number {
    let tAdj = t
    if (tAdj < 0) tAdj += 1
    if (tAdj > 1) tAdj -= 1
    if (tAdj < 1 / 6) return p + (q - p) * 6 * tAdj
    if (tAdj < 1 / 2) return q
    if (tAdj < 2 / 3) return p + (q - p) * (2 / 3 - tAdj) * 6
    return p
  }

  dispose(): void {
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program)
      this.program = null
    }
    this.gl = null
  }
}
