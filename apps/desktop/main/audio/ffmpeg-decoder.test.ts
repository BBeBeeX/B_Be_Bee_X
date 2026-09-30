/**
 * The URI→path conversion ffmpeg sees.
 *
 * The bug this pins: `bbebee-file://` URIs percent-encode the on-disk name,
 * and the decoder used to hand ffmpeg the encoded bytes verbatim — so a track
 * on disk as `9. One Last Kiss -宇多田ヒカル.flac` arrived as
 * `9.%20One%C2%A0Last%C2%A0Kiss%20-…flac` and ffmpeg answered "No such file
 * or directory", while the protocol handler (which decodes) served the very
 * same file to the buffered fallback without complaint.
 */

import { describe, expect, it } from 'vitest'
import { toFsPath } from './ffmpeg-decoder.js'

describe('toFsPath', () => {
  const uri =
    'bbebee-file:///F:/music/ACG/Eva/9.%20One%C2%A0Last%C2%A0Kiss%20-%E5%AE%87%E5%A4%9A%E7%94%B0%E3%83%92%E3%82%AB%E3%83%AB.flac'

  it('percent-decodes a bbebee-file URI to the on-disk name', () => {
    const decoded = toFsPath(uri)
    // The drive-letter shape differs by host OS (fileURLToPath semantics);
    // the encoded name must decode on either. `%C2%A0` is a non-breaking
    // space: the track name separates One/Last/Kiss with NBSPs, not spaces.
    const expected = process.platform === 'win32'
      ? 'F:\\music\\ACG\\Eva\\9. One\u00A0Last\u00A0Kiss -宇多田ヒカル.flac'
      : 'F:/music/ACG/Eva/9. One\u00A0Last\u00A0Kiss -宇多田ヒカル.flac'
    expect(decoded).toBe(expected)
  })

  it('passes plain paths and opaque URIs through untouched', () => {
    expect(toFsPath('F:\\music\\x.flac')).toBe('F:\\music\\x.flac')
    expect(toFsPath('/home/u/x.flac')).toBe('/home/u/x.flac')
    expect(toFsPath('https://cdn.example.com/song.m4s')).toBe('https://cdn.example.com/song.m4s')
  })

  it('still decodes plain file:// URIs', () => {
    const decoded = toFsPath('file:///home/u/One%20Last%20Kiss.flac')
    const expected = process.platform === 'win32'
      ? '\\home\\u\\One Last Kiss.flac'
      : '/home/u/One Last Kiss.flac'
    expect(decoded).toBe(expected)
  })
})
