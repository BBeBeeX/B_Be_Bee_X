/**
 * The music-source error taxonomy.
 *
 * Typed because `ctx.player` reacts differently to each class and a string
 * message cannot be branched on. Every provider maps its backend's failures
 * onto these; a raw `Error` escaping a provider is a bug.
 *
 * See docs/06-music-sources.md §6.
 */

export type SourceErrorCode =
  | 'auth'
  | 'rate-limit'
  | 'unavailable'
  | 'not-found'
  | 'network'
  | 'provider'

export abstract class SourceError extends Error {
  abstract readonly code: SourceErrorCode
  /** Whether retrying the identical request could succeed. */
  abstract readonly retryable: boolean

  constructor(
    message: string,
    readonly instanceId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/** Credentials are missing, rejected, or expired beyond refresh. */
export class AuthError extends SourceError {
  override readonly name = 'AuthError'
  override readonly code = 'auth' as const
  override readonly retryable = false
}

/** The backend asked us to slow down. */
export class RateLimitError extends SourceError {
  override readonly name = 'RateLimitError'
  override readonly code = 'rate-limit' as const
  override readonly retryable = true

  constructor(
    message: string,
    readonly retryAfterMs: number,
    instanceId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, instanceId, options)
  }
}

/** The item exists but cannot be played here — region lock, licence, tier. */
export class UnavailableError extends SourceError {
  override readonly name = 'UnavailableError'
  override readonly code = 'unavailable' as const
  override readonly retryable = false
}

/** The item is gone. */
export class NotFoundError extends SourceError {
  override readonly name = 'NotFoundError'
  override readonly code = 'not-found' as const
  override readonly retryable = false
}

/** Transport failed — offline, DNS, TLS, timeout. */
export class NetworkError extends SourceError {
  override readonly name = 'NetworkError'
  override readonly code = 'network' as const
  override readonly retryable = true
}

/** The backend misbehaved in a way we have no specific handling for. */
export class ProviderError extends SourceError {
  override readonly name = 'ProviderError'
  override readonly code = 'provider' as const
  override readonly retryable = false

  constructor(
    message: string,
    instanceId?: string,
    /** Raw payload, for the "copy details" action. Never logged verbatim. */
    readonly raw?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, instanceId, options)
  }
}

export function isSourceError(value: unknown): value is SourceError {
  return value instanceof SourceError
}

/** Whether a failure is worth retrying as-is. Non-`SourceError`s are not. */
export function isRetryable(value: unknown): boolean {
  return isSourceError(value) && value.retryable
}
