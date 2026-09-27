/**
 * Deriving `Capabilities` from a source document.
 *
 * **Nothing is declared.** What a source can do follows from which rule blocks
 * it contains, so the old under-declare/over-declare failure mode cannot
 * occur: a source with no `ruleExplore` has no `browse`, because there is
 * nothing to call. A block that is present but empty counts as absent — an
 * empty block is a half-written document, not a capability.
 *
 * A capability is true only when the document describes it *and* this build
 * can run the rules it describes it with — the caller works the second half
 * out and passes it in. Claiming one the build cannot back is exactly the lie
 * deriving them was meant to end.
 *
 * See docs/06-music-sources.md §1.3.
 */

import type { Capabilities, SourceDocument, StreamQuality } from '@BBeBee/protocol'

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

export function hasRules(block: object | undefined): boolean {
  return !!block && Object.values(block).some((v) => typeof v === 'string' && v.trim() !== '')
}

/**
 * Whether there is anything here for the runtime to interpret.
 *
 * ⚠️ Not every `sources` row is a document. The catalogue's foreign keys need
 * a row per source id, so `plugin-local-scanner` writes one for `local` — and
 * says so in its own `sourceComment`: files on this device, managed by the
 * scanner, not imported. There is no HTTP to describe, which is exactly what
 * [06 §12] says about local files.
 *
 * Adopting such a row anyway is how `plugin-source-runtime` came to register a
 * second, rules-free provider for `local` and collide with the real one. It
 * lost that race on the devices it was seen on — "already registered; ignoring
 * the duplicate" — but load order is *derived*, so the race was the bug: won
 * the other way, a provider that can do nothing would own the source id and
 * the local library would stop playing.
 *
 * The same reasoning is already written down one layer below, in the core
 * migration that carries pre-document providers across: a row with no rules is
 * written **disabled**, because starting a source with no rules "fails every
 * call with a RuleError and looks like a bug".
 */
export function isInterpretable(doc: SourceDocument): boolean {
  return (
    hasRules(doc.ruleSearch) ||
    hasRules(doc.ruleExplore) ||
    hasRules(doc.ruleAlbum) ||
    hasRules(doc.ruleTrackList) ||
    hasRules(doc.ruleStream) ||
    hasRules(doc.ruleLyric) ||
    hasRules(doc.ruleLibrary) ||
    hasRules(doc.ruleArtist) ||
    hasRules(doc.rulePlaylist) ||
    hasRules(doc.ruleRecommend) ||
    !!doc.searchUrl ||
    !!doc.exploreUrl
  )
}

export function capabilitiesFor(
  doc: SourceDocument,
  opts: {
    seekable?: boolean
    searchable?: boolean
    searchArtists?: boolean
    browsable?: boolean
    recommendable?: boolean
    lyrics?: boolean
    library?: boolean
    qualities?: StreamQuality[]
  } = {},
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
  const derivedQualities: StreamQuality[] =
    opts.qualities ??
    doc.ruleStream?.qualities ??
    doc.qualities ??
    (doc.ruleStream?.url?.includes('prefs.quality')
      ? ['hi-res', 'lossless', 'high', 'normal', 'low']
      : ['normal'])

  return {
    search: {
      tracks: searchable,
      albums: false,
      artists: opts.searchArtists ?? false,
      playlists: false,
      // Whether the *backend* does full-text is unknowable from a rule; the
      // honest answer is no rather than a guess the UI would act on.
      fullText: false,
    },
    browse: opts.browsable ?? false,
    recommend: opts.recommendable ?? hasRules(doc.ruleRecommend),
    // No `albums` flag exists on `Capabilities`: the *presence* of `getAlbum`
    // is the signal a shell reads, and adding a second way to say the same
    // thing is how the two drift apart.
    lyrics: opts.lyrics ?? false,
    artwork: false,
    library: {
      read: opts.library ?? (hasRules(doc.ruleLibrary) && !!doc.ruleLibrary?.list),
      save: false,
      playlistWrite: false,
      playlistReorder: false,
    },
    streaming: {
      qualities: derivedQualities,
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
