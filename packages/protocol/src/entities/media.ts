/** Playable media: stream handles and local bindings. See docs/06 §5, docs/07 §4.5. */

import type { Uri } from '../common.js'

export type StreamQuality = 'low' | 'normal' | 'high' | 'lossless' | 'hi-res'

export const STREAM_QUALITIES: readonly StreamQuality[] = [
  'low',
  'normal',
  'high',
  'lossless',
  'hi-res',
]

/**
 * Rank a quality tier, so "best available at or below X" is a comparison.
 *
 * Returns `-1` for an unrecognised value, which sorts it below `'low'`. That
 * is the safe direction — an unknown tier is never selected over a known one —
 * but callers comparing against a literal should check for `-1` rather than
 * assume every input was valid.
 */
export function qualityRank(q: StreamQuality): number {
  return STREAM_QUALITIES.indexOf(q)
}

export interface StreamPrefs {
  quality: StreamQuality
  /** True when the network is metered. Providers should downgrade. */
  saveData: boolean
  /** What this platform can actually decode — from `ctx.codec.supportedFormats()`. */
  acceptFormats: string[]
}

/**
 * The result of resolving a track to bytes.
 *
 * Deliberately never persisted: `expiresAt` makes a stored handle a liability,
 * and re-resolving is cheap. See docs/07-data-model.md §7.
 */
export interface StreamHandle {
  kind: 'remote' | 'local'
  /** URL when remote, `Uri` when local. */
  target: string
  mimeType?: string
  codec?: string
  bitrateKbps?: number
  sampleRate?: number
  /** Known byte length, which enables an honest buffering indicator. */
  byteLength?: number
  seekable: boolean
  /** Required to fetch this stream. May contain credentials — never log. */
  headers?: Record<string, string>
  /** Epoch ms. The player re-resolves before this, and on a 403. */
  expiresAt?: number
  /** Reserved. Nothing implements this — see docs/01, non-goals. */
  drm?: { system: string; licenseUrl: string }
  /** What the provider actually served, which may be below what was asked. */
  quality?: StreamQuality
}

export type BindingOrigin = 'download' | 'scan' | 'import'

/**
 * A track materialised as a concrete local file.
 *
 * This is what "downloaded" means — there is no `isDownloaded` flag anywhere.
 * A track may have several bindings (a scanned copy and a higher-quality
 * download); the resolver picks by quality.
 */
export interface MediaBinding {
  id: string
  trackUrn: string
  uri: Uri
  format?: string
  codec?: string
  bitrateKbps?: number
  sampleRate?: number
  channels?: number
  bitDepth?: number
  sizeBytes?: number
  checksum?: string
  origin: BindingOrigin
  quality?: StreamQuality
  /** Files disappear. A binding whose file is gone is deleted, not left to fail. */
  verifiedAt?: number
  createdAt: number
}
