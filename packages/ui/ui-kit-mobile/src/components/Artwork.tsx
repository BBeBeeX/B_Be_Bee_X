import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import { identicon } from '@BBeBee/ui-core'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'

export function Artwork(props: ArtworkProps): ReactElement {
  const native = nativePrimitives()
  const { size, radius = tokens.radius.sm } = props
  const uri = props.artwork?.sourceUrl
  const dominant = props.artwork?.dominantColor
  // No image and no colour from a real cover, but an identity (the caller's
  // seed, else the artwork row's own id) → a generated identicon, so an
  // artwork-less library is still a grid of distinct, stable squares rather
  // than one anonymous grey. Derived data never outranks real data: a
  // `dominantColor` extracted from an actual cover wins; with neither, the
  // plain colour square stands. The pattern comes from `ui-core`, so the same
  // album hashes to the same square on both platforms.
  const pattern = uri || dominant ? undefined : identicon(props.seed || props.artwork?.id)
  // The dominant colour is the background, so it shows while the image loads:
  // no grey flash and no layout shift on scroll (docs/08 4).
  return h(
    native.View as never,
    {
      ...common(props),
      style: {
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: pattern?.background ?? dominant ?? c().bg.overlay,
      },
    },
    uri
      ? h(native.Image as never, {
          source: { uri },
          style: { width: '100%', height: '100%' },
          resizeMode: 'cover',
        })
      : pattern
        ? // Five rows of five `View`s rather than `react-native-svg`: the SVG
          // package is a native module, and the grid is the one thing plain
          // views do exactly as well.
          h(
            native.View as never,
            { style: { flex: 1, flexDirection: 'column' } },
            [0, 1, 2, 3, 4].map((row) =>
              h(
                native.View as never,
                { key: row, style: { flex: 1, flexDirection: 'row' } },
                pattern.cells.slice(row * 5, row * 5 + 5).map((on, column) =>
                  h(native.View as never, {
                    key: column,
                    style: {
                      flex: 1,
                      backgroundColor: on ? pattern.foreground : 'transparent',
                    },
                  }),
                ),
              ),
            ),
          )
        : null,
  )
}
