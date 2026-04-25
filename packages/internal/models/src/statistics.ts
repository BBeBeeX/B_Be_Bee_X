export interface PlayStatisticsDetail {
    id: string;
    trackId: string;
    playedAt: number;
    playedDurationMs: number; // ms
    position?: number | null;
    completed?: boolean;
}

export interface PlayStatisticsSummary  {
    id: string;
    trackId: string;
    playCount: number;
    totalPlayedDurationMs: number; // ms
    lastPlayedAt?: number | null;
}