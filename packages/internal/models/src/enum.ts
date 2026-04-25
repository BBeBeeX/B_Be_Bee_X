export enum AudioQuality {
    unknown = 'unknown',
    low = 'low',
    medium = 'medium',
    high = 'high',
    lossless = 'lossless',
}
export const AudioQualityName: Record<AudioQuality, string> = {
    [AudioQuality.unknown]: "unknown",
    [AudioQuality.low]: "low",
    [AudioQuality.medium]: "medium",
    [AudioQuality.high]: "high",
    [AudioQuality.lossless]: "lossless",
} as const

export const AudioQualityPriority: Record<AudioQuality, number> = {
    [AudioQuality.unknown]: 0,
    [AudioQuality.low]: 1,
    [AudioQuality.medium]: 2,
    [AudioQuality.high]: 3,
    [AudioQuality.lossless]: 4
} as const

export enum SortMethodEnum {
    default_ = 'default',
    createTime = 'createTime',
    updateTime = 'updateTime',
    title = 'title',
}

export enum RepeatModeEnum {
    off = 'off',
    one = 'one',
    all = 'all',
    shuffle = 'shuffle',
}

export type AudioFormat = 'mp3' | 'aac' | 'flac' | 'm4a' | 'ogg' | 'opus' | 'wav' | 'hls' | 'dash' | 'unknown';

export type AvailabilityReason = 'normal' | 'auth_required' | 'vip_required' | 'region_blocked' | 'copyright_restricted' | 'removed' | 'network_error' | 'unknown';

export type CollectionItemType = 'track' | 'collection';
