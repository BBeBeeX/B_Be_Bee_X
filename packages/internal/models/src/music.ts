import {AudioFormat, AudioQuality, AvailabilityReason, CollectionItemType, SortMethodEnum} from "./enum";
import {Album, Person} from "./common";

export interface AudioPlayUrl {
    url: string;
    headers?: Record<string, string>;
    expiresAt?: number | null;
}

export interface AudioPlayItem {
    urls: AudioPlayUrl[];
    quality: AudioQuality;
    bandwidth?: number | null;
    format?: AudioFormat;
    mimeType?: string | null;
    codecs?: string | null;
}

export interface AudioPlayInfo {
    supportAudioQualities: AudioQuality[];
    audios: AudioPlayItem[];
    selectedQuality?: AudioQuality;
    expiresAt?: number | null;
}

export interface Track {
    id: string; //`t_${source}:${sourceId}` `local:${hash}`
    title: string;
    cover?: string | null;
    creator ?: Person | null;
    createdAt: number; // ms timestamp
    updatedAt: number; // ms timestamp

    durationMs: number; // ms

    artists?: Person [];
    album?: Album | null;

    source: string;         // 原始来源,插件id，本地文件的插件id为'local'
    activeSource?: string | null;  // 当前来源
    sourceId: string;
    sourceSubId?: string | null;  // bili cid

    raw?: unknown;

    available?: boolean;
    availabilityReason?: AvailabilityReason;

    description?: string | null;
    tags?: string[];
}

export interface Collection {
    id: string; //`c_${source}:${sourceId}` `local:${hash}`
    title: string;
    cover?: string | null;
    creator ?: Person | null;
    createdAt: number; // ms timestamp
    updatedAt: number; // ms timestamp

    isTop: boolean;
    isDefault: boolean;
    items: CollectionItem[];
    itemCount?: number | null;

    source: string;         // 原始来源,插件id，本地文件的插件id为'local'
    activeSource?: string | null;  // 当前来源
    sourceId: string;
    sourceSubId?: string | null;  // bili cid

    raw?: unknown;

    available?: boolean;
    availabilityReason?: AvailabilityReason;
}

export interface CollectionItem {
    id: string; // track or collection id
    type: CollectionItemType;
    sortOrder?: number;
    addedAt?: number;
}

export interface MusicLibraryState {
    collectionIds: string[];
    sortMode: SortMethodEnum;
    sortAscending: boolean;
    activeCollectionId?: string | null;
    selectedTrackIds?: string[];
}