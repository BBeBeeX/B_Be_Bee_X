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

/**
 * Total duration of a collection of items (such as tracks or playlist entries).
 * Formatted as "X 小时 Y 分钟" if >= 1 hour, or "Y 分钟 Z 秒" if < 1 hour,
 * or empty string if total duration is 0 or unmeasured.
 */
export function formatTotalDuration(items: readonly ({ durationMs?: number } | undefined)[]): string {
  const totalMs = items.reduce((sum, item) => sum + (item?.durationMs || 0), 0)
  if (totalMs <= 0) return ''
  const totalSeconds = Math.floor(totalMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  return `${minutes} 分钟 ${seconds} 秒`
}

