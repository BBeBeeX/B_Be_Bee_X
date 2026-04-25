import { TrackerMapper } from "./enums"
import { trackManager } from "./track-manager"

export class TrackerPoints {
  // App
  appInit(props: {
    electron?: boolean
    rn?: boolean
    loading_time?: number
    using_indexed_db?: boolean
    data_hydrated_time?: number
    version?: string
  }) {
    this.track(TrackerMapper.AppInit, props)
  }

  /**
   * For desktop UI only
   */
  uiRenderInit(spentTime: number) {
    this.track(TrackerMapper.UiRenderInit, { spent_time: spentTime })
  }

  navigateEntry(props: { feedId?: string; entryId?: string; timelineId?: string }) {
    this.track(TrackerMapper.NavigateEntry, props)
  }

  integration(props: { type: string; event: string }) {
    this.track(TrackerMapper.Integration, props)
  }

  switchToMasonry() {
    this.track(TrackerMapper.SwitchToMasonry)
  }

  wideMode(props: { mode: "wide" | "normal" }) {
    this.track(TrackerMapper.WideMode, props)
  }

  entryContentHeaderImageGalleryClick(props: { feedId?: string }) {
    this.track(TrackerMapper.EntryContentHeaderImageGalleryClick, props)
  }
  searchOpen() {
    this.track(TrackerMapper.SearchOpen)
  }

  playerOpenDuration(props: {
    duration: number
    status?: "playing" | "loading" | "paused"
    trigger?: "manual" | "beforeunload"
  }) {
    this.track(TrackerMapper.PlayerOpenDuration, props)
  }

  private track(code: TrackerMapper, properties?: Record<string, unknown>) {
    trackManager.getTrackFn()(code, properties)
  }

  get manager() {
    return trackManager
  }
}

export type AllTrackers = keyof TrackerPoints
