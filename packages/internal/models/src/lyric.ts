export interface LyricInfo {
    id: string;
    trackId: string;
    format: 'webvtt' | 'lrc' | 'plain';
    translations?: LyricTranslation[];
    updatedAt: number;

    source?: string;
    offsetMs?: number;
}

export interface LyricTranslation {
    language: string;
    content: string;
}
