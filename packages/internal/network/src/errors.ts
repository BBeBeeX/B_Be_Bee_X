export type NetworkErrorCategory =
  | "timeout"
  | "network"
  | "http"
  | "abort"
  | "parse"
  | "policy"
  | "unknown"

export interface NetworkErrorMetadata {
  status?: number
  url?: string
  method?: string
  pluginId?: string
  cause?: unknown
}

export class NetworkError extends Error {
  readonly category: NetworkErrorCategory
  readonly status?: number
  readonly url?: string
  readonly method?: string
  readonly pluginId?: string
  override readonly cause?: unknown

  constructor(category: NetworkErrorCategory, message: string, metadata: NetworkErrorMetadata = {}) {
    super(message)
    this.name = "NetworkError"
    this.category = category
    this.status = metadata.status
    this.url = metadata.url
    this.method = metadata.method
    this.pluginId = metadata.pluginId
    this.cause = metadata.cause
  }
}

export const isNetworkError = (error: unknown): error is NetworkError => {
  return error instanceof NetworkError
}

export const normalizeUnknownError = (
  error: unknown,
  metadata: Omit<NetworkErrorMetadata, "cause"> = {},
) => {
  if (isNetworkError(error)) {
    return error
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new NetworkError("abort", "The request was aborted.", {
      ...metadata,
      cause: error,
    })
  }

  if (error instanceof Error) {
    return new NetworkError("network", error.message, {
      ...metadata,
      cause: error,
    })
  }

  return new NetworkError("unknown", "An unknown network error occurred.", {
    ...metadata,
    cause: error,
  })
}
