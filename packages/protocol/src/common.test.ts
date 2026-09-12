import { describe, expect, it } from 'vitest'
import { uriContains } from './common.js'

describe('uriContains', () => {
  it('respects segment boundaries', () => {
    expect(uriContains('file:///app/BBeBee', 'file:///app/BBeBee/music')).toBe(true)
    expect(uriContains('file:///app/BBeBee', 'file:///app/BBeBee')).toBe(true)
    expect(uriContains('file:///app/BBeBee', 'file:///app/BBeBee-backup')).toBe(false)
    expect(uriContains('file:///app/BBeBee/', 'file:///app/BBeBee/music')).toBe(true)
  })

  it('handles Windows drive letters and URL pathnames', () => {
    const base = 'file:///C:/Users/Administrator/Documents/Tencent%20Files/747261306/FileRecv'
    const pathname = '/C:/Users/Administrator/Documents/Tencent%20Files/747261306/FileRecv'
    const subpath = '/C:/Users/Administrator/Documents/Tencent%20Files/747261306/FileRecv/song.mp3'
    const nativePath = 'C:\\Users\\Administrator\\Documents\\Tencent Files\\747261306\\FileRecv\\song.mp3'

    expect(uriContains(base, pathname)).toBe(true)
    expect(uriContains(base, subpath)).toBe(true)
    expect(uriContains(base, nativePath)).toBe(true)
    expect(uriContains(pathname, nativePath)).toBe(true)
  })

  it('handles Windows drive casing and case-insensitivity', () => {
    const base = 'file:///C:/Music'
    const lowerDrive = 'file:///c:/music/song.mp3'
    const lowerCase = 'file:///C:/music/Song.mp3'
    const outside = 'file:///D:/Music/song.mp3'

    expect(uriContains(base, lowerDrive)).toBe(true)
    expect(uriContains(base, lowerCase)).toBe(true)
    expect(uriContains(base, outside)).toBe(false)
  })

  it('handles percent-encoding and spaces uniformly', () => {
    const encoded = 'file:///C:/My%20Music'
    const decoded = 'file:///C:/My Music/Track 1.flac'
    const native = 'C:\\My Music\\Track 1.flac'

    expect(uriContains(encoded, decoded)).toBe(true)
    expect(uriContains(encoded, native)).toBe(true)
    expect(uriContains(decoded, encoded)).toBe(false)
  })
})
