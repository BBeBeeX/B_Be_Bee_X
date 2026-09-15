/**
 * Byte sizes, as a person reads them.
 *
 * Written once for the same reason `formatDuration` is: a download's size is
 * shown in both shells, and two spellings of 1.5 MB is the kind of drift that
 * ships unnoticed.
 *
 * Decimal units, because that is what a file manager, a store listing and a
 * storage setting all show — a size that disagrees with the one next to it on
 * the same screen is worse than one that disagrees with `du`.
 */

/**
 * `1.5 MB`, `0 B`, `—` when unknown.
 *
 * One decimal below ten keeps `1.5 MB` and `9.9 MB` informative without
 * printing `1234.5 MB`; above that a whole number is what anyone repeats out
 * loud.
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1000) return `${Math.round(bytes)} B`

  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
