import type { TrackerMapper } from "./enums"

export type Tracker = (
  code: TrackerMapper,
  properties?: Record<string, unknown>,
) => Promise<unknown> | unknown
