import { NetworkError, type NetworkErrorCategory } from "./errors"
import type { HttpMethod, RetryPolicy } from "./types"

const IDEMPOTENT_METHODS = new Set<HttpMethod>(["GET", "HEAD", "OPTIONS"])

export const defaultRetryPolicy: RetryPolicy = {
  attempts: 2,
  backoffMs: 250,
  maxBackoffMs: 2000,
  retryableErrors: ["timeout", "network", "unknown"],
  retryableStatuses: [408, 425, 429, 500, 502, 503, 504],
  retryUnsafeMethods: false,
}

export const mergeRetryPolicy = (policy?: Partial<RetryPolicy>): RetryPolicy => {
  return {
    ...defaultRetryPolicy,
    ...policy,
    retryableErrors: policy?.retryableErrors || defaultRetryPolicy.retryableErrors,
    retryableStatuses: policy?.retryableStatuses || defaultRetryPolicy.retryableStatuses,
  }
}

export const isIdempotentMethod = (method: HttpMethod) => {
  return IDEMPOTENT_METHODS.has(method)
}

export const canRetry = (input: {
  attempt: number
  error: NetworkError
  method: HttpMethod
  policy: RetryPolicy
}) => {
  if (input.attempt >= input.policy.attempts) {
    return false
  }

  if (!input.policy.retryUnsafeMethods && !isIdempotentMethod(input.method)) {
    return false
  }

  if (input.error.category === "http" && input.error.status) {
    return input.policy.retryableStatuses.includes(input.error.status)
  }

  return input.policy.retryableErrors.includes(input.error.category as NetworkErrorCategory)
}

export const getRetryDelayMs = (attempt: number, policy: RetryPolicy) => {
  return Math.min(policy.backoffMs * 2 ** Math.max(0, attempt - 1), policy.maxBackoffMs)
}

export const wait = (durationMs: number) => {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, durationMs)
  })
}
