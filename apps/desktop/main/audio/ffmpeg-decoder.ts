import { spawn } from 'node:child_process'
import { toNativePath } from '../fs-path.js'
import type { AudioDecodedPcm, AudioProbeResult, AudioRequestOptions } from './types.js'

/** Exported for tests: the URI→path decoding ffmpeg must agree on. */
export function toFsPath(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://') || uriOrPath.startsWith('bbebee-file://')) {
    // `toNativePath` percent-decodes what the URI encoded — the on-disk name
    // of `9.%20One%C2%A0Last%C2%A0Kiss…` has real spaces and NBSPs, and a
    // header-less, un-decoded path makes ffmpeg answer "No such file or
    // directory" for a track the protocol handler serves without complaint.
    try {
      return toNativePath(uriOrPath)
    } catch {
      return uriOrPath.replace(/^[a-z-]+:\/\//, '')
    }
  }
  return uriOrPath
}

/**
 * Input options for a remote URL, from the source's own headers.
 *
 * Streaming CDNs (bilibili's among them) answer a header-less request with
 * `403 Forbidden`, so a decode that works for `file://` inputs dies for remote
 * ones unless the source's `Referer`/`User-Agent` ride along. User-Agent goes
 * through ffmpeg's own flag; the rest ride in `-headers`, which requires each
 * line to be CRLF-terminated.
 */
function remoteInputArgs(uri: string, options?: AudioRequestOptions): string[] {
  if (!options?.headers || !/^https?:\/\//i.test(uri)) return []
  let userAgent: string | undefined
  const lines: string[] = []
  for (const [name, value] of Object.entries(options.headers)) {
    if (/^user-agent$/i.test(name)) userAgent = value
    else lines.push(`${name}: ${value}`)
  }
  return [
    ...(userAgent ? ['-user_agent', userAgent] : []),
    ...(lines.length > 0 ? ['-headers', `${lines.join('\r\n')}\r\n`] : []),
  ]
}

export class FfmpegDecoder {
  private readonly ffmpegPath: string

  constructor(customPath?: string) {
    this.ffmpegPath =
      customPath ||
      process.env['FFMPEG_PATH'] ||
      (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  }

  async probe(uri: string, options?: AudioRequestOptions): Promise<AudioProbeResult> {
    const filePath = toFsPath(uri)
    return new Promise<AudioProbeResult>((resolve, reject) => {
      const proc = spawn(
        this.ffmpegPath,
        [...remoteInputArgs(uri, options), '-hide_banner', '-i', filePath],
        { windowsHide: true },
      )

      let stderr = ''
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      proc.on('close', () => {
        try {
          const result = this.parseFfmpegOutput(stderr)
          resolve(result)
        } catch (err) {
          reject(err)
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to invoke ffmpeg at "${this.ffmpegPath}": ${err.message}`))
      })
    })
  }

  async decodePcm(uri: string, options?: AudioRequestOptions): Promise<AudioDecodedPcm> {
    const filePath = toFsPath(uri)
    const probeInfo = await this.probe(uri, options).catch(() => ({
      sampleRate: 44100,
      channels: 2,
      bitDepth: 24,
      durationMs: 0,
    }))

    const sampleRate = probeInfo.sampleRate || 44100
    const channels = probeInfo.channels || 2
    const bitDepth = probeInfo.bitDepth || 24

    return new Promise<AudioDecodedPcm>((resolve, reject) => {
      const proc = spawn(
        this.ffmpegPath,
        [
          ...remoteInputArgs(uri, options),
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          filePath,
          '-f',
          'f32le',
          '-acodec',
          'pcm_f32le',
          'pipe:1',
        ],
        { windowsHide: true },
      )

      const chunks: Buffer[] = []
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0 && chunks.length === 0) {
          return reject(new Error(`ffmpeg decode failed with code ${code}: ${stderr}`))
        }

        const totalBuffer = Buffer.concat(chunks)
        const floatData = new Float32Array(
          totalBuffer.buffer,
          totalBuffer.byteOffset,
          totalBuffer.byteLength / 4,
        )

        const totalFrames = Math.floor(floatData.length / channels)
        const pcm: Float32Array[] = []
        for (let c = 0; c < channels; c++) {
          pcm.push(new Float32Array(totalFrames))
        }

        for (let i = 0; i < totalFrames; i++) {
          for (let c = 0; c < channels; c++) {
            pcm[c]![i] = floatData[i * channels + c]!
          }
        }

        const durationMs = probeInfo.durationMs || Math.round((totalFrames / sampleRate) * 1000)

        resolve({
          sampleRate,
          channels,
          bitDepth,
          durationMs,
          pcm,
        })
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to invoke ffmpeg: ${err.message}`))
      })
    })
  }

  private parseFfmpegOutput(stderr: string): AudioProbeResult {
    let sampleRate = 44100
    let channels = 2
    let bitDepth: number | undefined = undefined
    let durationMs = 0
    let codec: string | undefined = undefined
    let format: string | undefined = undefined

    // Input #0, flac, from '...'
    const formatMatch = /Input #0,\s*([^,]+),/i.exec(stderr)
    if (formatMatch) {
      format = formatMatch[1]?.trim()
    }

    // Duration: 00:03:45.67
    const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
    if (durationMatch) {
      const hours = Number(durationMatch[1])
      const minutes = Number(durationMatch[2])
      const seconds = Number(durationMatch[3])
      durationMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
    }

    // Audio: alac, 96000 Hz, stereo, s32p (24 bit)
    // Audio: flac, 44100 Hz, stereo, s16
    const audioStreamMatch =
      /Stream\s*#\d+:\d+(?:\[[^\]]+\])?(?:\([^)]*\))?:\s*Audio:\s*([a-zA-Z0-9_-]+)[^,]*,?\s*(\d+)\s*Hz,?\s*([^,]+)/i.exec(
        stderr,
      )

    if (audioStreamMatch) {
      codec = audioStreamMatch[1]?.toLowerCase()
      sampleRate = Number(audioStreamMatch[2]) || 44100
      const channelStr = audioStreamMatch[3]?.toLowerCase() || ''
      if (channelStr.includes('stereo')) {
        channels = 2
      } else if (channelStr.includes('mono')) {
        channels = 1
      } else if (channelStr.includes('5.1')) {
        channels = 6
      } else if (channelStr.includes('7.1')) {
        channels = 8
      }
    }

    // Bit depth (e.g. s32p (24 bit) or s16 or s24)
    const bitDepthMatch = /\b(?:s|u)(\d+)(?:p|le|be)?\s*(?:\((\d+)\s*bit\))?/i.exec(stderr)
    if (bitDepthMatch) {
      if (bitDepthMatch[2]) {
        bitDepth = Number(bitDepthMatch[2])
      } else if (bitDepthMatch[1]) {
        bitDepth = Number(bitDepthMatch[1])
      }
    }

    return {
      sampleRate,
      channels,
      bitDepth: bitDepth || 16,
      durationMs,
      codec,
      format,
    }
  }
}
