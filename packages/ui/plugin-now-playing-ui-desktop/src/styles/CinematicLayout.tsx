/**
 * Cinematic layout — 16:9 minimal anime / music video (AMV) aesthetic.
 *
 * Redesigned to match the reference style (映画歌词):
 * - Large blurred cover backdrop (opacity 0.34, blur 3.5px, scale 2, centered)
 * - Left section (~46%): larger album artwork (up to 460px) with crisp white border &
 *   pronounced double-layer bottom-right shadow (12px 16px 5px + 20px 28px 56px)
 * - Right section: cursive/handwriting title, muted artist, cinematic subtitle-style
 *   synchronized lyrics (`CinematicLyricsTemplate` from plugin-lyrics-ui-desktop —
 *   scrollable, click-to-seek), organic waveform + progress bar below lyrics
 * - Title is not higher than cover top; waveform & progress bar are not lower than cover bottom
 * - Waveform is shorter than progress bar with fine tapered ends
 * - Timestamps are larger with text shadow
 * - No playback control buttons — pure cinematic immersion
 */
import { createElement as h, useEffect, useRef, type ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { Slider } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from '../components/NowPlayingBar.js'
import { CinematicLyricsTemplate, CURSIVE_FONT } from '@BBeBee/plugin-lyrics-ui-desktop'
import type { NowPlayingLayoutProps } from './index.js'

/* ── Delicate Organic Waveform with Tapered Ends ────────────────────────── */

interface WaveformCanvasProps {
  isPlaying: boolean
  color?: string
}

function WaveformCanvas({ isPlaying }: WaveformCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animRef = useRef<number | null>(null)
  const phaseRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let active = true

    const render = () => {
      if (!active) return
      const width = canvas.width
      const height = canvas.height
      ctx.clearRect(0, 0, width, height)

      // Gentle phase advance
      phaseRef.current += isPlaying ? 0.025 : 0.004
      const phase = phaseRef.current

      // Gradient stroke that softly fades to transparent at both ends (fine ends)
      const grad = ctx.createLinearGradient(0, 0, width, 0)
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)')
      grad.addColorStop(0.12, 'rgba(255, 255, 255, 0.45)')
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.85)')
      grad.addColorStop(0.88, 'rgba(255, 255, 255, 0.45)')
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)')

      ctx.beginPath()
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.2
      ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
      ctx.shadowBlur = isPlaying ? 4 : 1

      const midY = height / 2
      const baseAmp = isPlaying ? height * 0.24 : height * 0.07

      ctx.moveTo(0, midY)
      for (let x = 0; x <= width; x += 2) {
        const progress = x / width
        // Strong power envelope for razor-sharp tapering to 0 at both edges
        const envelope = Math.pow(Math.sin(progress * Math.PI), 2.2)
        const wave1 = Math.sin(progress * 8 + phase) * baseAmp * 0.65
        const wave2 = Math.sin(progress * 14 - phase * 0.8) * baseAmp * 0.25
        const wave3 = Math.cos(progress * 4 + phase * 0.3) * baseAmp * 0.15
        const y = midY + (wave1 + wave2 + wave3) * envelope
        ctx.lineTo(x, y)
      }
      ctx.stroke()

      animRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      active = false
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [isPlaying])

  return h('canvas', {
    ref: canvasRef,
    width: 800,
    height: 24,
    'data-testid': 'cinematic-waveform',
    style: {
      width: '100%',
      maxWidth: 450,
      height: 24,
      display: 'block',
      margin: '0 auto',
      opacity: isPlaying ? 0.8 : 0.4,
      transition: 'opacity 0.5s ease',
    },
  })
}

export function CinematicLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, onSeekChange, onSeekCommit } = props
  const isPlaying = state.status === 'playing'

  // Actual track title and artist from real-time transport state
  const trackTitle = state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'No Surprises')
  const trackArtist = state.nowPlaying?.artist ?? (state.trackUrn ? '—' : 'Radiohead')

  return h(
    'div',
    {
      'data-testid': 'layout-cinematic',
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#0D1118',
        color: '#FFFFFF',
        fontFamily: tokens.font.family,
        boxSizing: 'border-box',
        padding: '24px 48px',
      },
    },

    /* ── Layer 1: Large Cover Backdrop (opacity: 0.34, blur: 3.5px, scale 2, centered) ── */
    h(
      'div',
      {
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          zIndex: 0,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.34,
            filter: 'blur(3.5px) saturate(1.2) brightness(0.85)',
            transform: 'scale(2)',
          },
        },
        h(CachedArtwork, {
          ctx,
          artwork: state.nowPlaying?.artwork,
          seed: state.trackUrn,
          size: 900,
          radius: 0,
        }),
      ),
    ),

    /* ── Layer 2: Main 16:9 Framed Stage ── */
    h(
      'div',
      {
        style: {
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 1240,
          aspectRatio: '16 / 9',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box',
          padding: '16px 32px',
        },
      },

      /* ── Two Column Area: Left Artwork + Right Info/Lyrics/Progress ── */
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            width: '100%',
            gap: 56,
            minHeight: 0,
          },
        },

        /* LEFT SECTION: Large Album Artwork (~46% width, up to 460px) */
        h(
          'div',
          {
            style: {
              flex: '0 0 46%',
              maxWidth: 480,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          h(
            'div',
            {
              style: {
                position: 'relative',
                width: '100%',
                aspectRatio: '1 / 1',
                maxHeight: 460,
                maxWidth: 460,
                borderRadius: 2,
                // Crisp white border
                border: '2px solid rgba(255, 255, 255, 0.9)',
                // Double-layer pronounced bottom-right shadow (12px 16px 5px + 20px 28px 56px)
                boxShadow:
                  '12px 16px 5px rgba(0, 0, 0, 0.65), 20px 28px 56px rgba(0, 0, 0, 0.55)',
                overflow: 'hidden',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
              },
            },
            h(CachedArtwork, {
              ctx,
              artwork: state.nowPlaying?.artwork,
              seed: state.trackUrn,
              size: 460,
              radius: 0,
            }),
          ),
        ),

        /* RIGHT SECTION: Bounded to cover height (460px) so title is not above and progress is not below */
        h(
          'div',
          {
            style: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              textAlign: 'center',
              minWidth: 0,
              height: 460,
              maxHeight: 460,
              boxSizing: 'border-box',
              paddingTop: 8,
              paddingBottom: 4,
            },
          },

          /* Track Title (cursive/handwriting font) & Artist — at top */
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                maxWidth: '90%',
                flexShrink: 0,
              },
            },
            h(
              'h1',
              {
                style: {
                  margin: 0,
                  fontSize: 46,
                  fontWeight: 400,
                  letterSpacing: '0.5px',
                  color: '#FFFFFF',
                  fontFamily: CURSIVE_FONT,
                  textShadow: '0 2px 18px rgba(0, 0, 0, 0.5)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                },
              },
              trackTitle,
            ),
            h(
              'p',
              {
                style: {
                  margin: 0,
                  fontSize: 15,
                  color: 'rgba(255, 255, 255, 0.6)',
                  letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              trackArtist,
            ),
          ),

          /* Synced Lyrics — scrollable cinematic template (click-to-seek),
             fills the middle of the column */
          h(CinematicLyricsTemplate, {
            ctx,
            displayPosition,
            trackUrn: state.trackUrn,
            isPlaying,
            canSeek: can.canSeek,
            onSeek: onSeekCommit,
          }),

          /* Waveform + Progress Bar — at bottom of right column, not below cover bottom */
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                width: '100%',
                flexShrink: 0,
              },
            },

            /* 1. Gentle Organic Waveform (nested slightly inside progress bar, fine ends) */
            h(
              'div',
              { style: { width: '100%', maxWidth: 450 } },
              h(WaveformCanvas, { isPlaying }),
            ),

            /* 2. Progress Slider (extended, ~520px max width) */
            h(
              'div',
              { style: { width: '100%', maxWidth: 520 } },
              h(Slider, {
                value: duration ? Math.min(displayPosition, duration) : displayPosition,
                max: duration ?? 0,
                disabled: !can.canSeek,
                accessibilityLabel: 'Seek',
                onChange: onSeekChange,
                onCommit: onSeekCommit,
              }),
            ),

            /* 3. Timestamps below progress bar (larger font + shadow, matching 520px width) */
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  maxWidth: 520,
                  marginTop: 2,
                },
              },
              h(
                'span',
                {
                  'data-testid': 'cinematic-current-time',
                  style: {
                    fontSize: 16,
                    fontFamily: CURSIVE_FONT,
                    fontStyle: 'italic',
                    color: 'rgba(255, 255, 255, 0.9)',
                    textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 1px 3px rgba(0, 0, 0, 0.9)',
                    minWidth: 46,
                    textAlign: 'left',
                  },
                },
                formatDuration(displayPosition),
              ),
              h(
                'span',
                {
                  'data-testid': 'cinematic-total-duration',
                  style: {
                    fontSize: 16,
                    fontFamily: CURSIVE_FONT,
                    fontStyle: 'italic',
                    color: 'rgba(255, 255, 255, 0.9)',
                    textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 1px 3px rgba(0, 0, 0, 0.9)',
                    minWidth: 46,
                    textAlign: 'right',
                  },
                },
                formatDuration(duration),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}
