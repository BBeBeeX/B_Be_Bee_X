export interface Person   {
    id?: string | null;
    name?: string | null;
    avatar?: string | null;
    raw?: unknown;
}

export interface Album {
    id?: string | null;
    title: string;
    cover?: string | null;
    releaseDate?: string | null;
    raw?: unknown;
}

export interface PageParams {
    page?: number;
    pageSize?: number;
    cursor?: string;
}

export interface PageResult<T> {
    items: T[];
    page?: number;
    pageSize?: number;
    hasMore: boolean;
    nextCursor?: string;
    total?: number;
}
