/**
 * Provider capability predicates.
 *
 * A module of its own so the service and the view hooks answer "can this
 * source be searched?" the same way. The search screen draws a toggle per
 * source from this answer, and `searchAll` skips what it refuses — if the two
 * ever disagreed, a source with no matches and a source never asked would be
 * indistinguishable on screen.
 */

import type { MediaProvider } from '@BBeBee/protocol'

/**
 * Whether a source can answer a search at all — method *and* capability.
 *
 * A provider without `search` has nothing to call; one whose derived
 * capabilities say no search type is offered is a source that would answer
 * nothing, and asking it is a request per keystroke for no result.
 */
export function canSearchProvider(provider: MediaProvider | undefined): boolean {
  if (!provider || typeof provider.search !== 'function') return false
  const { search } = provider.capabilities
  return search.tracks || search.albums || search.artists || search.playlists
}
