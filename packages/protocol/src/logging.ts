/**
 * Logging contracts.
 *
 * Cordis provides `ctx.logger` itself, already scoped per plugin, so BBeBee
 * defines no logging *service*. What it adds is transports — each an ordinary
 * plugin registering a Cordis exporter — plus the redaction every transport
 * must apply. See docs/04-core-services.md §16.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

/**
 * Mirror of Cordis's `LoggerLevel`, which upstream declares as an ambient
 * `const enum` and therefore cannot be imported under isolatedModules.
 * Asserted against the live runtime in the kernel's assumption tests.
 */
export const LOG_LEVEL = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
} as const

export const LEVEL_NAMES: readonly LogLevel[] = ['error', 'warn', 'info', 'debug']

export function levelName(level: number): LogLevel {
  return LEVEL_NAMES[level] ?? 'info'
}

/** One normalised log line. What transports receive after redaction. */
export interface LogRecord {
  /** Monotonic sequence number, for stable ordering within a session. */
  sn: number
  /** Epoch ms. */
  time: number
  level: LogLevel
  /** The plugin's name, supplied by Cordis. */
  scope: string
  message: string
  meta?: Record<string, unknown>
}

export interface LogTransport {
  write(record: LogRecord): void
  flush?(): Promise<void>
}

/* ── Redaction ──────────────────────────────────────────────────────────── */

/**
 * Keys whose values never reach a log file.
 *
 * Music-source plugins put credentials in headers routinely, and a log file
 * the user is about to attach to a bug report must not contain them. This is
 * a hard requirement on every transport, not a nicety.
 */
export const REDACTED_KEYS: readonly string[] = [
  'token',
  'access_token',
  'refresh_token',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'session',
  'credential',
  'private_key',
  'privatekey',
  // OAuth: an authorization code is a bearer credential for its short life,
  // and redirect URLs carrying one land in logs constantly.
  'code_verifier',
  'client_secret',
  'signature',
]

/**
 * Keys that merely *contain* a sensitive substring but are not themselves
 * sensitive. Without this, `author` matches `auth` and every track's artist
 * credit is redacted out of the logs.
 */
const KEY_ALLOWLIST = new Set(['author', 'authors', 'authored', 'authority'])

export const REDACTED = '[redacted]'

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (KEY_ALLOWLIST.has(lower)) return false
  const k = lower.replace(/[-_\s]/g, '')
  return REDACTED_KEYS.some((s) => k.includes(s.replace(/[-_]/g, '')))
}

/**
 * Strip credentials from a value, recursively.
 *
 * Handles the three shapes that actually leak: a sensitive key anywhere in an
 * object, credentials in a URL's userinfo or query string, and bearer tokens
 * embedded in a free-text message.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[deep]'
  if (typeof value === 'string') return redactString(value)
  // JSON.stringify throws on BigInt, and an exception thrown from inside a log
  // exporter can take down the logging chain — the one subsystem that must not
  // fail while you are diagnosing a failure.
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'symbol') return value.toString()
  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack }
  }

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(v, depth + 1)
  }
  return out
}

/** Query parameters that carry credentials, beyond the key dictionary. */
const SENSITIVE_QUERY_KEYS = [...REDACTED_KEYS, 'code', 'key', 'sig', 'state']

const SENSITIVE_QUERY = new RegExp(`([?&](?:${SENSITIVE_QUERY_KEYS.join('|')})=)[^&\\s]+`, 'gi')
const BEARER = /\b(bearer|basic|token)\s+[\w.\-+/=]{8,}/gi
// Matches both `scheme://user:pass@host` and the passwordless `scheme://token@host`.
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi

export function redactString(value: string): string {
  return value
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(SENSITIVE_QUERY, `$1${REDACTED}`)
    .replace(BEARER, `$1 ${REDACTED}`)
}
