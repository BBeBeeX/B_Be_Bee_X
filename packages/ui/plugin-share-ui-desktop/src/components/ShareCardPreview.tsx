import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { BackgroundMode } from '../utils/canvasRenderer.js'
import { BBEBEE_LOGO_DATA_URL } from '../assets/logo.js'

export interface ShareCardPreviewProps {
  title: string
  subtitle: string
  artwork?: string
  themeColor: string
  backgroundMode: BackgroundMode
  lyrics?: string[]
}

export function normalizeArtworkUrl(src?: string): string | undefined {
  if (!src) return undefined
  if (src.startsWith('file://')) {
    return src.replace(/^file:\/\//, 'bbebee-file://')
  }
  return src
}

export function ShareCardPreview({
  title,
  subtitle,
  artwork,
  themeColor,
  backgroundMode,
  lyrics,
}: ShareCardPreviewProps): ReactElement {
  let backgroundStyle: string
  if (backgroundMode === 'black') {
    backgroundStyle = '#000000'
  } else if (backgroundMode === 'gradient') {
    backgroundStyle = `linear-gradient(180deg, ${themeColor} 0%, ${themeColor} 17.5%, #000000 50%, #000000 100%)`
  } else {
    backgroundStyle = themeColor
  }

  const isLyricsMode = Boolean(lyrics && lyrics.length > 0)
  const displayArtwork = normalizeArtworkUrl(artwork)
  const lineCount = isLyricsMode ? Math.max(1, Math.min(6, lyrics!.length)) : 0
  const lyricsCardH = isLyricsMode
    ? Math.round(Math.min(390, Math.max(220, 130 + lineCount * 36)) * (252 / 540))
    : 247

  return h(
    'div',
    {
      style: {
        width: 252,
        height: 448,
        borderRadius: 20,
        background: backgroundStyle,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 0, 0, 0.4)',
        boxSizing: 'border-box',
        userSelect: 'none',
      },
    },
    // Floating Card (205px wide, strictly centered, matching canvas proportions)
    h(
      'div',
      {
        style: {
          width: 205,
          height: isLyricsMode ? lyricsCardH : 247,
          borderRadius: 11,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
          background: isLyricsMode ? themeColor : '#000000',
          boxSizing: 'border-box',
          padding: isLyricsMode ? '9px 10px 7px 10px' : '11px 14px 9px 14px',
        },
      },
      isLyricsMode
        ? // Lyrics Card Content (bright cover theme color, crisp white text)
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
              },
            },
            // Mini Header
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h(
                'div',
                {
                  style: {
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    overflow: 'hidden',
                    background: '#1a1e2b',
                    flexShrink: 0,
                  },
                },
                displayArtwork
                  ? h('img', {
                      src: displayArtwork,
                      alt: 'cover',
                      referrerPolicy: 'no-referrer',
                      loading: 'lazy',
                      style: { width: '100%', height: '100%', objectFit: 'cover' },
                    })
                  : h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          color: 'rgba(255,255,255,0.6)',
                          fontSize: 10,
                        },
                      },
                      '♪',
                    ),
              ),
              h(
                'div',
                { style: { minWidth: 0, flex: 1 } },
                h(
                  'div',
                  {
                    style: {
                      color: '#FFFFFF',
                      fontWeight: 700,
                      fontSize: 9,
                      lineHeight: '12px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  title,
                ),
                h(
                  'div',
                  {
                    style: {
                      color: 'rgba(255, 255, 255, 0.88)',
                      fontSize: 8,
                      fontWeight: 500,
                      lineHeight: '11px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  subtitle,
                ),
              ),
            ),
            // Lyrics Lines
            h(
              'div',
              {
                style: {
                  marginTop: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                },
              },
              lyrics!.slice(0, 6).map((line, idx) =>
                h(
                  'div',
                  {
                    key: idx,
                    style: {
                      color: '#FFFFFF',
                      fontWeight: 700,
                      fontSize: 10.5,
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  line,
                ),
              ),
            ),
            // BBeBee Logo at bottom-left
            h('img', {
              src: BBEBEE_LOGO_DATA_URL,
              alt: 'BBeBee',
              referrerPolicy: 'no-referrer',
              style: {
                width: 61,
                height: 'auto',
                alignSelf: 'flex-start',
                marginTop: 'auto',
                marginLeft: 0,
              },
            }),
          )
        : // Track / Playlist / Album Card Content
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
              },
            },
            // Large Cover Artwork (177x177)
            h(
              'div',
              {
                style: {
                  width: 177,
                  height: 177,
                  borderRadius: 7,
                  overflow: 'hidden',
                  background: '#1a1e2b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                },
              },
              displayArtwork
                ? h('img', {
                    src: displayArtwork,
                    alt: 'artwork',
                    referrerPolicy: 'no-referrer',
                    loading: 'lazy',
                    style: { width: '100%', height: '100%', objectFit: 'cover' },
                  })
                : h(
                    'div',
                    {
                      style: {
                        fontSize: 28,
                        color: 'rgba(255, 255, 255, 0.3)',
                        fontWeight: 700,
                      },
                    },
                    '♪',
                  ),
            ),
            // Metadata
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', marginTop: 8 } },
              h(
                'div',
                {
                  style: {
                    color: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: '14px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                title,
              ),
              h(
                'div',
                {
                  style: {
                    color: '#B3B9C9',
                    fontSize: 8.5,
                    fontWeight: 500,
                    lineHeight: '12px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: 2,
                  },
                },
                subtitle,
              ),
            ),
            // BBeBee Logo at bottom-left
            h('img', {
              src: BBEBEE_LOGO_DATA_URL,
              alt: 'BBeBee',
              referrerPolicy: 'no-referrer',
              style: {
                width: 65,
                height: 'auto',
                alignSelf: 'flex-start',
                marginTop: 'auto',
                marginLeft: 0,
              },
            }),
          ),
    ),
  )
}
