/**
 * Time rendering shared by both shells.
 *
 * Written once because a duration is shown in every list row, every transport
 * bar and every now-playing screen, and the two kits drifting on how a
 * two-hour track is spelled is the kind of inconsistency nobody notices until
 * it ships.
 */

/**
 * `mm:ss`, or `h:mm:ss` past an hour.
 *
 * Unknown durations render as a placeholder rather than `0:00`, which would
 * claim a live stream is zero seconds long. Fractional seconds truncate: a
 * track showing 3:34 the instant before it ends is right; showing 3:35 for a
 * 3:34 track is the kind of wrong a user notices once and remembers.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`
}
