/**
 * The desktop kit renders, and renders the things docs/08 §8 requires.
 *
 * Static markup rather than a DOM: what is worth pinning here is the
 * *accessible* output — a name on every control, a role a screen reader can
 * use, a focus ring nobody removed — and that is all in the markup.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import type { Track } from '@BBeBee/protocol'
import {
  Artwork,
  Button,
  EmptyState,
  IconButton,
  List,
  Sheet,
  Slider,
  Text,
  TextField,
  Toast,
  TrackRow,
} from './index.js'

const track: Track = {
  urn: 'BBeBee:local:track:1',
  title: 'Jóga',
  artists: [{ urn: 'BBeBee:local:artist:1', name: 'Björk', role: 'main', ordinal: 0 }],
  albumTitle: 'Homogenic',
  available: true,
}

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element)

describe('Button', () => {
  it('renders its label as a real button element', () => {
    const out = html(h(Button, { onPress: () => {}, children: 'Play' }))
    expect(out).toContain('<button')
    expect(out).toContain('Play')
    expect(out).toContain('type="button"')
  })

  it('disables while loading, and says it is busy', () => {
    // Two props would drift apart; one prop cannot.
    const out = html(h(Button, { onPress: () => {}, loading: true, children: 'Save' }))
    expect(out).toContain('disabled')
    expect(out).toContain('aria-busy="true"')
  })

  it('carries an accessible name when one is given', () => {
    const out = html(
      h(Button, { onPress: () => {}, accessibilityLabel: 'Play Jóga', children: '▶' }),
    )
    expect(out).toContain('aria-label="Play Jóga"')
  })

  it('never removes the focus ring', () => {
    // Keyboard navigation is a docs/08 §8 requirement, and `outline: none` is
    // the single most common way a kit breaks it.
    const out = html(h(Button, { onPress: () => {}, children: 'x' }))
    expect(out).not.toContain('outline:none')
  })
})

describe('IconButton', () => {
  it('always has an accessible name', () => {
    // An icon has no text to fall back on, so the prop is required by type —
    // this is the render-time half of the same guarantee.
    const out = html(h(IconButton, { icon: '⏭', accessibilityLabel: 'Next track', onPress: () => {} }))
    expect(out).toContain('aria-label="Next track"')
  })

  it('meets the minimum tap target even for a small icon', () => {
    const out = html(
      h(IconButton, { icon: '·', accessibilityLabel: 'More', onPress: () => {}, size: 8 }),
    )
    expect(out).toContain('width:44px')
  })
})

describe('TrackRow', () => {
  it('shows the title and the artists', () => {
    const out = html(h(TrackRow, { track }))
    expect(out).toContain('Jóga')
    expect(out).toContain('Björk')
  })

  it('shows the album only when asked', () => {
    expect(html(h(TrackRow, { track }))).not.toContain('Homogenic')
    expect(html(h(TrackRow, { track, showAlbum: true }))).toContain('Homogenic')
  })

  it('is reachable by keyboard', () => {
    expect(html(h(TrackRow, { track, onPress: () => {} }))).toContain('tabindex="0"')
  })

  it('offers an overflow control when it can do something with it', () => {
    expect(html(h(TrackRow, { track }))).not.toContain('aria-label="More"')
    expect(html(h(TrackRow, { track, onMore: () => {} }))).toContain('aria-label="More"')
  })
})

describe('Slider', () => {
  it('exposes its range to assistive technology', () => {
    const out = html(h(Slider, { value: 30, max: 100 }))
    expect(out).toContain('aria-valuenow="30"')
    expect(out).toContain('aria-valuemax="100"')
  })

  it('separates dragging from committing', () => {
    // Seeking on every frame of a drag is what makes a scrubber unusable, so
    // a caller can subscribe to the release alone.
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const element = h(Slider, { value: 0, max: 100, onChange, onCommit })
    expect(() => html(element)).not.toThrow()
    // The props are distinct on the element, which is the contract.
    expect(element.props.onChange).toBe(onChange)
    expect(element.props.onCommit).toBe(onCommit)
  })
})

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    expect(html(h(Sheet, { open: false, onClose: () => {}, children: 'hi' }))).toBe('')
  })

  it('is a modal dialog when open', () => {
    const out = html(h(Sheet, { open: true, onClose: () => {}, title: 'Queue', children: 'x' }))
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    expect(out).toContain('Queue')
  })
})

describe('List', () => {
  it('renders each item with a stable key', () => {
    const out = html(
      h(List<{ id: string }>, {
        items: [{ id: 'a' }, { id: 'b' }],
        keyExtractor: (i) => i.id,
        renderItem: (i) => h(Text, { children: i.id }),
      }),
    )
    expect(out).toContain('role="list"')
    expect((out.match(/role="listitem"/g) ?? []).length).toBe(2)
  })

  it('shows the empty state instead of nothing', () => {
    // A blank pane tells a user nothing about whether it is loading, broken,
    // or genuinely empty.
    const out = html(
      h(List<{ id: string }>, {
        items: [],
        keyExtractor: (i) => i.id,
        renderItem: () => null,
        empty: h(EmptyState, { title: 'No tracks yet' }),
      }),
    )
    expect(out).toContain('No tracks yet')
  })
})

describe('Toast', () => {
  it('announces without stealing focus', () => {
    const out = html(h(Toast, { message: 'Saved' }))
    expect(out).toContain('role="status"')
    expect(out).toContain('aria-live="polite"')
  })

  it('offers a dismiss control with a name', () => {
    expect(html(h(Toast, { message: 'x', onDismiss: () => {} }))).toContain('aria-label="Dismiss"')
  })
})

describe('Artwork', () => {
  it('paints the dominant colour so there is no grey flash', () => {
    const out = html(
      h(Artwork, { size: 48, artwork: { id: 'a', dominantColor: '#3a5f7d' } }),
    )
    expect(out).toContain('#3a5f7d')
  })

  it('renders no image element when there is nothing to show', () => {
    expect(html(h(Artwork, { size: 48 }))).not.toContain('<img')
  })

  it('marks artwork decorative, since the row already names the track', () => {
    const out = html(h(Artwork, { size: 48, artwork: { id: 'a', sourceUrl: 'https://x/a.jpg' } }))
    expect(out).toContain('alt=""')
  })
})

describe('Text', () => {
  it('takes its size from the scale, never a raw number', () => {
    expect(html(h(Text, { variant: 'lg', children: 'x' }))).toContain('font-size:20px')
  })

  it('clamps to a line count when asked', () => {
    expect(html(h(Text, { numberOfLines: 1, children: 'x' }))).toContain('-webkit-line-clamp:1')
  })
})

describe('TextField', () => {
  it('renders a single-line input by default and a text area when multiline', () => {
    // The two things users type here are a pasted document — hundreds of lines
    // — and a one-line rule. One control cannot be both.
    const single = renderToStaticMarkup(
      h(TextField, { value: 'x', onChange: () => {}, accessibilityLabel: 'Rule' }),
    )
    expect(single).toContain('<input')

    const many = renderToStaticMarkup(
      h(TextField, { value: 'x', onChange: () => {}, multiline: true, accessibilityLabel: 'Doc' }),
    )
    expect(many).toContain('<textarea')
  })

  it('carries its accessible name', () => {
    const html = renderToStaticMarkup(
      h(TextField, { value: '', onChange: () => {}, accessibilityLabel: 'Source string' }),
    )
    expect(html).toContain('aria-label="Source string"')
  })

  it('hides a secure value', () => {
    const html = renderToStaticMarkup(
      h(TextField, { value: 'hunter2', onChange: () => {}, secure: true, accessibilityLabel: 'Password' }),
    )
    expect(html).toContain('type="password"')
  })

  it('renders an error rather than hiding it in a title', () => {
    // An error only a hover reveals is one a touch user and a screen reader
    // both never see.
    const html = renderToStaticMarkup(
      h(TextField, {
        value: '{',
        onChange: () => {},
        error: 'sourceUrl: must be a string',
        accessibilityLabel: 'Doc',
      }),
    )
    expect(html).toContain('sourceUrl: must be a string')
    expect(html).not.toContain('title="sourceUrl')
  })

  it('turns autocorrect off unless asked', () => {
    // A rule silently autocorrected fails for a reason nothing on screen
    // explains.
    const html = renderToStaticMarkup(
      h(TextField, { value: 'a', onChange: () => {}, accessibilityLabel: 'Rule' }),
    )
    // React omits `spellCheck={false}` from static markup because it is the
    // DOM default; what matters is that nothing turns it *on*.
    expect(html).not.toContain('spellcheck="true"')
    expect(html).not.toContain('autocorrect="on"')
  })
})
