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
    backgroundStyle = `linear-gradient(180deg, ${themeColor} 0%, ${themeColor} 20%, #000000 50%, #000000 100%)`
  } else {
    backgroundStyle = themeColor
  }

  const isLyricsMode = Boolean(lyrics && lyrics.length > 0)
  const displayArtwork = normalizeArtworkUrl(artwork)

  return h(
    'div',
    {
      style: {
        width: 250,
        height: 440,
        borderRadius: 20,
        background: backgroundStyle,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 0, 0, 0.4)',
        padding: 16,
        boxSizing: 'border-box',
        userSelect: 'none',
      },
    },
    // Floating Card
    h(
      'div',
      {
        style: {
          width: '100%',
          borderRadius: 16,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
          background: isLyricsMode ? themeColor : '#000000',
        },
      },
      // Inner card container
      h(
        'div',
        {
          style: {
            background: 'transparent',
            padding: isLyricsMode ? '12px 14px 8px 14px' : 14,
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
          },
        },
        isLyricsMode
          ? // Lyrics Card Content (bright cover theme color, crisp white text)
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              // Mini Header
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(
                  'div',
                  {
                    style: {
                      width: 32,
                      height: 32,
                      borderRadius: 6,
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
                            fontSize: 13,
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
                        fontSize: 12,
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
                        fontSize: 10,
                        fontWeight: 500,
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
                    margin: '2px 0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  },
                },
                lyrics!.slice(0, 5).map((line, idx) =>
                  h(
                    'div',
                    {
                      key: idx,
                      style: {
                        color: '#FFFFFF',
                        fontWeight: 700,
                        fontSize: 12,
                        lineHeight: 1.35,
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
                style: { width: 68, height: 'auto', alignSelf: 'flex-start', marginTop: 4, marginLeft: 0 },
              }),
            )
          : // Track / Playlist / Album Card Content
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              // Large Cover Artwork
              h(
                'div',
                {
                  style: {
                    width: '100%',
                    aspectRatio: '1/1',
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: '#1a1e2b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
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
                          fontSize: 32,
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
                { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                h(
                  'div',
                  {
                    style: {
                      color: '#FFFFFF',
                      fontSize: 14,
                      fontWeight: 700,
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
                      fontSize: 11,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  subtitle,
                ),
              ),
              // BBeBee Logo at bottom-left (proportional to canvas 160px: 76px)
              h('img', {
                src: BBEBEE_LOGO_DATA_URL,
                alt: 'BBeBee',
                referrerPolicy: 'no-referrer',
                style: { width: 76, height: 'auto', alignSelf: 'flex-start', marginTop: 6, marginLeft: 0 },
              }),
            ),
      ),
    ),
  )
}
