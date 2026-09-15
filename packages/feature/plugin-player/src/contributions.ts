/**
 * The contribution ids `plugin-player` still owns.
 *
 * Commands only, and deliberately so: the screens this plugin used to carry —
 * the now-playing page and bar, the up-next list — moved to surface plugins
 * (`plugin-now-playing`, `plugin-queue`), and their view ids moved with them.
 * What remains is the transport's own keybindable verbs, which do not depend
 * on a view existing at all (docs/08 §3).
 */

export const PLAYER_COMMANDS = {
  togglePlay: 'player.togglePlay',
  next: 'player.next',
  previous: 'player.previous',
} as const
