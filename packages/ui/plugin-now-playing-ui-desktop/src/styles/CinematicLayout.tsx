/**
 * Cinematic layout — 16:9 minimal anime / music video (AMV) aesthetic.
 *
 * Redesigned to match the reference style (映画歌词):
 * - Large blurred cover backdrop (opacity 0.50, blur 2.5px) revealing the artwork's
 *   silhouette and contours for a cinematic film-reel atmosphere
 * - Left section (~38%): square album artwork with crisp white border & pronounced
 *   bottom-right shadow
 * - Right section: cursive/handwriting title, muted artist, cinematic subtitle-style
 *   synchronized lyrics, then waveform + progress bar below lyrics
 * - No playback control buttons — pure cinematic immersion
 */
import { createElement as h, useEffect, useMemo, useRef, type ReactElement } from 'react'
import { formatDuration, parseLrc, type LyricLine, findActiveLyricIndex } from '@BBeBee/toolkit'
import { Slider } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type { LyricsService, LyricsState } from '@BBeBee/protocol'
import { CachedArtwork } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

/* ── Cursive / handwriting font stack ───────────────────────────────────── */

const CURSIVE_FONT = "'Caveat', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', cursive, sans-serif"

/* ── Gentle Organic Waveform ────────────────────────────────────────────── */

interface WaveformCanvasProps {
  isPlaying: boolean
  color?: string
}

/**
 * A delicate, organic single-stroke waveform that breathes gently when
 * playing and rests as a subtle hand-drawn line when paused.
 */
function WaveformCanvas({ isPlaying, color = 'rgba(255, 255, 255, 0.55)' }: WaveformCanvasProps): ReactElement {
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

      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.2
      ctx.shadowColor = color
      ctx.shadowBlur = isPlaying ? 4 : 1

      const midY = height / 2
      // Subtle amplitude — gentle breathing, not aggressive multi-frequency
      const baseAmp = isPlaying ? height * 0.22 : height * 0.06

      ctx.moveTo(0, midY)
      for (let x = 0; x <= width; x += 3) {
        const progress = x / width
        // Hanning window envelope for organic tapering at edges
        const envelope = Math.sin(progress * Math.PI)
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
  }, [isPlaying, color])

  return h('canvas', {
    ref: canvasRef,
    width: 680,
    height: 28,
    'data-testid': 'cinematic-waveform',
    style: {
      width: '100%',
      height: 28,
      display: 'block',
      opacity: isPlaying ? 0.75 : 0.35,
      transition: 'opacity 0.5s ease',
    },
  })
}

const IDLE_LYRICS_STATE: LyricsState = { status: 'idle', offsetMs: 0 }

/* ── Main Cinematic Layout Component ────────────────────────────────────── */

export function CinematicLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, onSeekChange, onSeekCommit } = props
  const isPlaying = state.status === 'playing'

  /* Synchronized lyrics query */
  const lyricsService = serviceOf<LyricsService>(ctx, 'lyrics')
  const lyricsState = useServiceState<LyricsState>(
    ctx,
    ['lyrics/changed'],
    () => lyricsService?.state ?? IDLE_LYRICS_STATE,
  )

  const parsedLines = useMemo(() => {
    if (!lyricsState?.lyrics?.content) return []
    const parsed = parseLrc(lyricsState.lyrics.content, { offsetMs: lyricsState.offsetMs })
    return parsed.lines
  }, [lyricsState?.lyrics?.content, lyricsState?.offsetMs])

  const activeIndex = useMemo(() => {
    if (parsedLines.length === 0) return -1
    return findActiveLyricIndex(parsedLines, displayPosition * 1000, lyricsState?.offsetMs ?? 0)
  }, [parsedLines, displayPosition, lyricsState?.offsetMs])

  // Cinematic subtitle focus: show current line + surrounding lines
  const visibleLyricSlots = useMemo(() => {
    if (parsedLines.length === 0) return []
    const slots: Array<{ line: LyricLine | null; offset: number }> = [
      { line: parsedLines[activeIndex - 1] ?? null, offset: -1 },
      { line: parsedLines[activeIndex] ?? null, offset: 0 },
      { line: parsedLines[activeIndex + 1] ?? null, offset: 1 },
      { line: parsedLines[activeIndex + 2] ?? null, offset: 2 },
    ]
    return slots
  }, [parsedLines, activeIndex])

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
        // Neutral dark base — the blurred cover backdrop provides the actual color
        background: '#0D1118',
        color: '#FFFFFF',
        fontFamily: tokens.font.family,
        boxSizing: 'border-box',
        padding: '24px 36px',
      },
    },

    /* ── Layer 1: Large Cover Backdrop — visible silhouette (opacity 0.50, blur 2.5px) ── */
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
          // High opacity + minimal blur to reveal cover artwork contours
          opacity: 0.50,
          filter: 'blur(2.5px) saturate(1.2) brightness(0.85)',
          transform: 'scale(1.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box',
          padding: '28px 48px',
          gap: 24,
        },
      },

      /* ── Top / Middle Area: Left Artwork + Right Info/Lyrics/Progress ── */
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            flex: 1,
            gap: 56,
            minHeight: 0,
          },
        },

        /* LEFT SECTION: Large Square Album Artwork (~38% width) */
        h(
          'div',
          {
            style: {
              flex: '0 0 38%',
              maxWidth: 420,
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
                maxHeight: 380,
                maxWidth: 380,
                borderRadius: 2,
                // Crisp white border
                border: '2px solid rgba(255, 255, 255, 0.85)',
                // Pronounced bottom-right shadow
                boxShadow: '12px 16px 32px rgba(0, 0, 0, 0.75), 20px 28px 56px rgba(0, 0, 0, 0.50)',
                overflow: 'hidden',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
              },
            },
            h(CachedArtwork, {
              ctx,
              artwork: state.nowPlaying?.artwork,
              seed: state.trackUrn,
              size: 380,
              radius: 0,
            }),
          ),
        ),

        /* RIGHT SECTION: Title, Artist, Lyrics, then Waveform + Progress below */
        h(
          'div',
          {
            style: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              minWidth: 0,
              height: '100%',
              gap: 24,
            },
          },

          /* Track Title (cursive/handwriting font) & Artist */
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                maxWidth: '90%',
              },
            },
            h(
              'h1',
              {
                style: {
                  margin: 0,
                  fontSize: 48,
                  fontWeight: 400,
                  letterSpacing: '0.5px',
                  color: '#FFFFFF',
                  fontFamily: CURSIVE_FONT,
                  textShadow: '0 2px 18px rgba(0, 0, 0, 0.45)',
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
                  color: 'rgba(255, 255, 255, 0.55)',
                  letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              trackArtist,
            ),
          ),

          /* Synced Lyrics — Cinematic Subtitle Focus */
          h(
            'div',
            {
              'data-testid': 'cinematic-lyrics-block',
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                width: '100%',
                minHeight: 100,
              },
            },
            visibleLyricSlots.length > 0
              ? visibleLyricSlots.map((slot, idx) => {
                  if (!slot.line) return null
                  const isCurrent = slot.offset === 0
                  const isPrev = slot.offset === -1
                  const opacity = isCurrent ? 1 : isPrev ? 0.32 : slot.offset === 1 ? 0.40 : 0.18
                  const fontSize = isCurrent ? 24 : 16
                  const fontWeight = isCurrent ? 500 : 400

                  return h(
                    'div',
                    {
                      key: idx,
                      'data-active': isCurrent ? 'true' : undefined,
                      style: {
                        opacity,
                        fontSize,
                        fontWeight,
                        color: '#FFFFFF',
                        letterSpacing: isCurrent ? '1.5px' : '0.5px',
                        lineHeight: 1.5,
                        textAlign: 'center',
                        textShadow: isCurrent ? '0 2px 12px rgba(0, 0, 0, 0.5)' : 'none',
                        transition: 'all 0.4s cubic-bezier(0.2, 0, 0, 1)',
                        maxWidth: '90%',
                      },
                    },
                    h('div', null, slot.line.text),
                    slot.line.translation
                      ? h(
                          'div',
                          {
                            style: {
                              fontSize: isCurrent ? 18 : 14,
                              fontStyle: 'italic',
                              fontFamily: CURSIVE_FONT,
                              opacity: 0.85,
                              marginTop: 3,
                              letterSpacing: '0.3px',
                            },
                          },
                          slot.line.translation,
                        )
                      : null,
                  )
                })
              : h(
                  'div',
                  {
                    style: {
                      fontSize: 20,
                      opacity: 0.40,
                      fontStyle: 'italic',
                      fontFamily: CURSIVE_FONT,
                      color: 'rgba(255, 255, 255, 0.7)',
                    },
                  },
                  lyricsState?.status === 'loading-lyrics'
                    ? '♪ 歌词检索中… ♪'
                    : lyricsState?.supportsLyricSource === false
                      ? '♪ 当前音源未启用外部歌词源 ♪'
                      : state.status === 'playing'
                        ? '♪ 愿音乐治愈所有的伤痕 ♪'
                        : 'No Surprises',
                ),
          ),

          /* Waveform + Progress Bar — below lyrics, inside right section */
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                width: '100%',
                marginTop: 'auto',
                paddingTop: 16,
              },
            },

            /* Gentle Organic Waveform */
            h(WaveformCanvas, { isPlaying }),

            /* Progress Slider (thin line) */
            h(
              'div',
              { style: { width: '100%' } },
              h(Slider, {
                value: duration ? Math.min(displayPosition, duration) : displayPosition,
                max: duration ?? 0,
                disabled: !can.canSeek,
                accessibilityLabel: 'Seek',
                onChange: onSeekChange,
                onCommit: onSeekCommit,
              }),
            ),

            /* Timestamps below progress bar */
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                },
              },
              h(
                'span',
                {
                  'data-testid': 'cinematic-current-time',
                  style: {
                    fontSize: 13,
                    fontFamily: CURSIVE_FONT,
                    fontStyle: 'italic',
                    color: 'rgba(255, 255, 255, 0.65)',
                    minWidth: 42,
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
                    fontSize: 13,
                    fontFamily: CURSIVE_FONT,
                    fontStyle: 'italic',
                    color: 'rgba(255, 255, 255, 0.65)',
                    minWidth: 42,
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
