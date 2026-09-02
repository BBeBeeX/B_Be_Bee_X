/**
 * The music-source error taxonomy.
 *
 * Typed because `ctx.player` reacts differently to each class and a string
 * message cannot be branched on. Every provider maps its backend's failures
 * onto these; a raw `Error` escaping a provider is a bug.
 *
 * `rule` is the class the string-source model adds, and it is the one that
 * earns its keep daily: a backend renaming a field is a *different* failure
 * from a backend being down, and telling the user "this source needs
 * updating" instead of "something went wrong" is the difference between a
 * two-minute fix and a support request.
 *
 * See docs/06-music-sources.md §7.
 */

export type SourceErrorCode =
  | 'auth'
  | 'rate-limit'
  | 'unavailable'
  | 'not-found'
  | 'network'
  | 'provider'
  | 'rule'

export abstract class SourceError extends Error {
  abstract readonly code: SourceErrorCode
  /** Whether retrying the identical request could succeed. */
  abstract readonly retryable: boolean

  constructor(
    message: string,
    readonly sourceId?: string,
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
    sourceId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, sourceId, options)
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
    sourceId?: string,
    /** Raw payload, for the "copy details" action. Never logged verbatim. */
    readonly raw?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, sourceId, options)
  }
}

/**
 * A rule produced nothing where something was required.
 *
 * The source document is valid; the backend answered; the rule no longer
 * matches what came back. Not retryable, because retrying an identical
 * request against an identical response gives an identical nothing — the fix
 * is an edit, which is why this carries the exact rule that failed and why
 * three of these in a row marks a source stale (docs/06 §7).
 */
export class RuleError extends SourceError {
  override readonly name = 'RuleError'
  override readonly code = 'rule' as const
  override readonly retryable = false

  constructor(
    message: string,
    /** Which rule. `block` is e.g. 'ruleSearch'; `field` e.g. 'trackId'. */
    readonly rule: { block: string; field: string },
    sourceId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, sourceId, options)
  }
}

/**
 * A string is not a valid source document.
 *
 * Import-time only, and deliberately *not* a `SourceError`: there is no source
 * yet to attribute it to. Carries every issue rather than the first, because
 * the import screen lists them all and fixing one at a time is miserable.
 */
export class SourceFormatError extends Error {
  override readonly name = 'SourceFormatError'

  constructor(
    message: string,
    readonly issues: readonly { path: string; message: string }[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

export function isSourceError(value: unknown): value is SourceError {
  return value instanceof SourceError
}

/** Whether a failure is worth retrying as-is. Non-`SourceError`s are not. */
export function isRetryable(value: unknown): boolean {
  return isSourceError(value) && value.retryable
}
