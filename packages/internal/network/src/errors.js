export class NetworkError extends Error {
    category;
    status;
    url;
    method;
    pluginId;
    cause;
    constructor(category, message, metadata = {}) {
        super(message);
        this.name = "NetworkError";
        this.category = category;
        this.status = metadata.status;
        this.url = metadata.url;
        this.method = metadata.method;
        this.pluginId = metadata.pluginId;
        this.cause = metadata.cause;
    }
}
export const isNetworkError = (error) => {
    return error instanceof NetworkError;
};
export const normalizeUnknownError = (error, metadata = {}) => {
    if (isNetworkError(error)) {
        return error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
        return new NetworkError("abort", "The request was aborted.", {
            ...metadata,
            cause: error,
        });
    }
    if (error instanceof Error) {
        return new NetworkError("network", error.message, {
            ...metadata,
            cause: error,
        });
    }
    return new NetworkError("unknown", "An unknown network error occurred.", {
        ...metadata,
        cause: error,
    });
};
