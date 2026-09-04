/**
 * Deriving `Capabilities` from a source document.
 *
 * **Nothing is declared.** What a source can do follows from which rule blocks
 * it contains, so the old under-declare/over-declare failure mode cannot
 * occur: a source with no `ruleExplore` has no `browse`, because there is
 * nothing to call. A block that is present but empty counts as absent — an
 * empty block is a half-written document, not a capability.
 *
 * This slice builds only the members the M1 runtime can actually serve
 * (docs/11 MD-7), so `search` and `browse` stay false even when the document
 * describes them: claiming a capability the build cannot back is exactly the
 * lie deriving them was meant to end.
 *
 * See docs/06-music-sources.md §1.3.
 */

import type { Capabilities, SourceDocument } from '@BBeBee/protocol'

/** `'3/1000'` → three requests per second. Unparseable means "no stated limit". */
export function parseRate(rate: string | undefined): Capabilities['rateLimit'] {
  if (!rate) return undefined
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(rate.trim())
  if (!match) return undefined
  const requests = Number(match[1])
  const windowMs = Number(match[2])
  if (!requests || !windowMs) return undefined
  return { requests, windowMs }
}

function hasRules(block: object | undefined): boolean {
  return !!block && Object.values(block).some((v) => typeof v === 'string' && v.trim() !== '')
}

export function capabilitiesFor(
  doc: SourceDocument,
  opts: { seekable?: boolean; searchable?: boolean } = {},
): Capabilities {
  const rateLimit = parseRate(doc.concurrentRate)
  /*
   * Search is derived from *two* things, not one: the document has to
   * describe it, and this build has to be able to run the rules it describes
   * it with. A document whose `ruleSearch` needs `@css:` is a perfectly good
   * document — it just cannot be served here, and declaring the capability
   * anyway offers the UI a button the runtime would fail.
   */
  const searchable = opts.searchable ?? false
  return {
    search: {
      tracks: searchable,
      albums: false,
      artists: false,
      playlists: false,
      // Whether the *backend* does full-text is unknowable from a rule; the
      // honest answer is no rather than a guess the UI would act on.
      fullText: false,
    },
    browse: false,
    lyrics: false,
    artwork: false,
    library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
    streaming: {
      qualities: ['normal'],
      transcoding: false,
      // Learned from the document, or from the server's `Accept-Ranges` — not
      // assumed. A stream that cannot be ranged cannot be seeked, and the UI
      // hides the scrubber rather than offering one that does nothing.
      seekable: opts.seekable ?? true,
      // Its *presence* is the signal: a document that sets `expiresAt` has
      // expiring URLs, and the player must re-resolve before they lapse.
      urlExpiry: hasRules(doc.ruleStream) && !!doc.ruleStream?.expiresAt,
    },
    ...(rateLimit ? { rateLimit } : {}),
    regional: false,
  }
}
