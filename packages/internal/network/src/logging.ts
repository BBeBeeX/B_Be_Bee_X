import { logger } from "@b_be_bee/logger"

import type { NetworkHeaders, NetworkLogEvent, NetworkLogger } from "./types"

const SENSITIVE_HEADER_PATTERNS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "token",
  "credential",
  "secret",
]

const SENSITIVE_QUERY_PATTERNS = ["token", "credential", "secret", "password", "cookie", "key"]
const REDACTED = "[redacted]"

export const redactHeaders = (headers?: NetworkHeaders): NetworkHeaders | undefined => {
  if (!headers) return undefined
  const redacted: NetworkHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase()
    redacted[name] = SENSITIVE_HEADER_PATTERNS.some((pattern) => normalized.includes(pattern))
      ? REDACTED
      : value
  }
  return redacted
}

export const redactUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    for (const key of parsed.searchParams.keys()) {
      const normalized = key.toLowerCase()
      if (SENSITIVE_QUERY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
        parsed.searchParams.set(key, REDACTED)
      }
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export const createConsoleNetworkLogger = (): NetworkLogger => ({
  log(event: NetworkLogEvent) {
    const safeEvent = {
      ...event,
      headers: redactHeaders(event.headers),
      url: redactUrl(event.url),
    }
    logger.info("[network]", safeEvent)
  },
})

export const emitLog = (logger: NetworkLogger | undefined, event: NetworkLogEvent) => {
  logger?.log({
    ...event,
    headers: redactHeaders(event.headers),
    url: redactUrl(event.url),
  })
}
