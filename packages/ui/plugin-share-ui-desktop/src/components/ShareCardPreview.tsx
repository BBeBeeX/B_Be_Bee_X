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
    backgroundStyle = `linear-gradient(180deg, ${themeColor} 0%, ${themeColor} 50%, #000000 100%)`
  } else {
    backgroundStyle = themeColor
  }

  const isLyricsMode = Boolean(lyrics && lyrics.length > 0)

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
          background: themeColor,
        },
      },
      // Semi-transparent black mask layer
      h(
        'div',
        {
          style: {
            background: 'rgba(0, 0, 0, 0.48)',
            padding: isLyricsMode ? 14 : 14,
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
          },
        },
        isLyricsMode
          ? // Lyrics Card Content
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              // Mini Header
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                h(
                  'div',
                  {
                    style: {
                      width: 36,
                      height: 36,
                      borderRadius: 6,
                      overflow: 'hidden',
                      background: '#1a1e2b',
                      flexShrink: 0,
                    },
                  },
                  artwork
                    ? h('img', {
                        src: artwork,
                        alt: 'cover',
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
                            color: 'rgba(255,255,255,0.4)',
                            fontSize: 14,
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
                        color: '#B3B9C9',
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
                    margin: '8px 0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
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
                        fontSize: 13,
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
              // BBeBee Logo at bottom
              h('img', {
                src: BBEBEE_LOGO_DATA_URL,
                alt: 'BBeBee',
                style: { height: 20, width: 'auto', alignSelf: 'flex-start', marginTop: 4 },
              }),
            )
          : // Track / Playlist Card Content
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
                artwork
                  ? h('img', {
                      src: artwork,
                      alt: 'artwork',
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
              // BBeBee Logo
              h('img', {
                src: BBEBEE_LOGO_DATA_URL,
                alt: 'BBeBee',
                style: { height: 22, width: 'auto', alignSelf: 'flex-start', marginTop: 2 },
              }),
            ),
      ),
    ),
  )
}
