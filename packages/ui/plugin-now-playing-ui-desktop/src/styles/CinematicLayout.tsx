/**
 * Cinematic layout — 16:9 minimal anime / music video (AMV) aesthetic.
 *
 * Inspired by high-end editorial and cinematic lyric players:
 * - 16:9 aspect ratio centered layout on a deep cover-toned background
 * - Faint blurred cover backdrop (opacity ~0.12, blur 80px)
 * - Left section (~38% width): large square album artwork with white border & deep shadow
 * - Right section: actual song title, artist, and 3-5 line synchronized lyrics with
 *   bright high-contrast active line (and bilingual translation) and fading neighbors
 * - Bottom area: delicate real-time audio waveform canvas, thin progress bar with
 *   actual current time / total duration, and minimal playback controls
 */
import { createElement as h, useEffect, useMemo, useRef, type ReactElement } from 'react'
import { formatDuration, parseLrc, type LyricLine, findActiveLyricIndex } from '@BBeBee/toolkit'
import { IconButton, Slider } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type { LyricsService, LyricsState } from '@BBeBee/protocol'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

/* ── Delicate Reactive Audio Waveform ───────────────────────────────────── */

interface WaveformCanvasProps {
  isPlaying: boolean
  color?: string
}

function WaveformCanvas({ isPlaying, color = '#7bb4e3' }: WaveformCanvasProps): ReactElement {
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

      // Advance phase when playing, slow crawl when paused
      phaseRef.current += isPlaying ? 0.045 : 0.008
      const phase = phaseRef.current

      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.75
      ctx.shadowColor = color
      ctx.shadowBlur = isPlaying ? 8 : 3

      const midY = height / 2
      const baseAmp = isPlaying ? height * 0.38 : height * 0.1

      ctx.moveTo(0, midY)
      for (let x = 0; x <= width; x += 4) {
        const progress = x / width
        // Window function (hanning) to taper the wave at edges
        const envelope = Math.sin(progress * Math.PI)
        const wave1 = Math.sin(progress * 12 + phase) * baseAmp * 0.6
        const wave2 = Math.sin(progress * 22 - phase * 1.5) * baseAmp * 0.3
        const wave3 = Math.cos(progress * 6 + phase * 0.5) * baseAmp * 0.2
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
    height: 38,
    'data-testid': 'cinematic-waveform',
    style: {
      width: '100%',
      height: 38,
      display: 'block',
      opacity: isPlaying ? 0.88 : 0.4,
      transition: 'opacity 0.4s ease',
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

  // Extract 3-5 lyric lines centered on active index
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
        // Deep cover-toned navy background
        background: 'radial-gradient(ellipse at 35% 45%, #182236 0%, #111724 65%, #0B0F18 100%)',
        color: '#FFFFFF',
        fontFamily: tokens.font.family,
        boxSizing: 'border-box',
        padding: '24px 36px',
      },
    },

    /* ── Layer 1: Ambient Faint Blurred Artwork Backdrop (opacity ~0.12, blur 80px) ── */
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
          opacity: 0.14,
          filter: 'blur(80px) saturate(1.4)',
          transform: 'scale(1.25)',
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
          justifyContent: 'space-between',
          boxSizing: 'border-box',
          padding: '28px 48px',
        },
      },

      /* ── Top / Middle Area: Left Artwork + Right Info/Lyrics ── */
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
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
                borderRadius: tokens.radius.md,
                // Ref image signature: crisp white border + deep dark soft shadow
                border: '2px solid rgba(255, 255, 255, 0.85)',
                boxShadow: '16px 24px 50px rgba(0, 0, 0, 0.65)',
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

        /* RIGHT SECTION: Track Title, Artist & Synced Lyrics */
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
              gap: 28,
            },
          },

          /* Track Title & Artist (using actual playback data) */
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                maxWidth: '90%',
              },
            },
            h(
              'h1',
              {
                style: {
                  margin: 0,
                  fontSize: 38,
                  fontWeight: 500,
                  letterSpacing: '0.2px',
                  color: '#FFFFFF',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  textShadow: '0 2px 16px rgba(0, 0, 0, 0.4)',
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
                  fontSize: 16,
                  color: 'rgba(255, 255, 255, 0.65)',
                  letterSpacing: '0.4px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              trackArtist,
            ),
          ),

          /* Synced Lyrics Container */
          h(
            'div',
            {
              'data-testid': 'cinematic-lyrics-block',
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                width: '100%',
                minHeight: 140,
              },
            },
            visibleLyricSlots.length > 0
              ? visibleLyricSlots.map((slot, idx) => {
                  if (!slot.line) return null
                  const isCurrent = slot.offset === 0
                  const isPrev = slot.offset === -1
                  const opacity = isCurrent ? 1 : isPrev ? 0.35 : slot.offset === 1 ? 0.45 : 0.2
                  const fontSize = isCurrent ? 24 : isPrev ? 16 : 17
                  const fontWeight = isCurrent ? 600 : 400

                  return h(
                    'div',
                    {
                      key: idx,
                      'data-active': isCurrent ? 'true' : undefined,
                      style: {
                        opacity,
                        fontSize,
                        fontWeight,
                        color: isCurrent ? '#FFFFFF' : 'rgba(255, 255, 255, 0.85)',
                        lineHeight: 1.45,
                        textAlign: 'center',
                        textShadow: isCurrent ? '0 2px 14px rgba(0, 0, 0, 0.6)' : 'none',
                        transition: 'all 0.38s cubic-bezier(0.2, 0, 0, 1)',
                        maxWidth: '90%',
                      },
                    },
                    h('div', null, slot.line.text),
                    slot.line.translation
                      ? h(
                          'div',
                          {
                            style: {
                              fontSize: fontSize * 0.78,
                              fontStyle: 'italic',
                              opacity: 0.88,
                              marginTop: 2,
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
                      opacity: 0.45,
                      fontStyle: 'italic',
                      color: 'rgba(255, 255, 255, 0.7)',
                    },
                  },
                  state.status === 'playing' ? '♪ 愿音乐治愈所有的伤痕 ♪' : 'No Surprises',
                ),
          ),
        ),
      ),

      /* ── Bottom Area: Audio Waveform, Progress Bar & Minimal Controls ── */
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            width: '100%',
            marginTop: 18,
          },
        },

        /* 1. Thin Audio Waveform Visualization */
        h(WaveformCanvas, { isPlaying, color: '#7bb4e3' }),

        /* 2. Playback Progress Slider + Actual Timestamps */
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              width: '100%',
            },
          },
          /* Current Playback Time */
          h(
            'span',
            {
              'data-testid': 'cinematic-current-time',
              style: {
                fontSize: 14,
                fontFamily: 'monospace, sans-serif',
                color: 'rgba(255, 255, 255, 0.75)',
                minWidth: 42,
                textAlign: 'right',
              },
            },
            formatDuration(displayPosition),
          ),

          /* Sleek Progress Slider */
          h(
            'div',
            { style: { flex: 1 } },
            h(Slider, {
              value: duration ? Math.min(displayPosition, duration) : displayPosition,
              max: duration ?? 0,
              disabled: !can.canSeek,
              accessibilityLabel: 'Seek',
              onChange: onSeekChange,
              onCommit: onSeekCommit,
            }),
          ),

          /* Total Duration */
          h(
            'span',
            {
              'data-testid': 'cinematic-total-duration',
              style: {
                fontSize: 14,
                fontFamily: 'monospace, sans-serif',
                color: 'rgba(255, 255, 255, 0.75)',
                minWidth: 42,
                textAlign: 'left',
              },
            },
            formatDuration(duration),
          ),
        ),

        /* 3. Minimal Playback Controls */
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 20,
              marginTop: 4,
            },
          },
          h(PlayModeButton, { ctx, mode: state.playMode }),
          h(IconButton, {
            icon: 'skip-back',
            accessibilityLabel: 'Previous track',
            disabled: !can.canPrevious,
            onPress: () => void ctx.player.previous(),
          }),
          h(IconButton, {
            icon: can.canPause ? 'pause-filled' : 'play-filled',
            accessibilityLabel: can.canPause ? 'Pause' : 'Play',
            variant: 'primary',
            size: tokens.size.iconLarge,
            disabled: !can.canPlay && !can.canPause,
            onPress: () => ctx.player.togglePlay(),
          }),
          h(IconButton, {
            icon: 'skip-forward',
            accessibilityLabel: 'Next track',
            disabled: !can.canNext,
            onPress: () => void ctx.player.next(),
          }),
          h(VolumeControl, { ctx, volume: state.volume, muted: state.muted }),
        ),
      ),
    ),
  )
}
