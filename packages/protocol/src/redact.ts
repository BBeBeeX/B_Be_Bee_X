/**
 * The trace redactor.
 *
 * A rule trace is *designed* to be shared — docs/06 §10 says "copy trace" is
 * what a user hands to a source author. That makes every string in one a
 * potential credential leak, and the common case is not exotic: a Subsonic URL
 * carries `u=` and `t=`, and `{{source.var}}` interpolates a password into a
 * query string as a matter of routine.
 *
 * So redaction is a type obligation (`Redacted`) rather than a convention, and
 * this is the only way to produce one.
 */

import type { Redacted } from './services/source-document.js'

/**
 * Parameter names whose values never survive redaction.
 *
 * Deliberately over-broad. A false positive costs a `***` in a trace someone
 * was reading; a false negative is a credential in a forum thread. `t` and `s`
 * are here because Subsonic's auth scheme uses exactly those two for a
 * password hash and its salt.
 */
const SECRET_KEYS =
  /^(?:t|s|p|pw|pass|passwd|password|pwd|key|token|id_token|access_token|refresh_token|jwt|api_?key|x-api-key|apikey|client_secret|secret|auth|authorization|session|session_?id|sessionid|sid|sig|signature|cookie|salt|credential|bearer)$/i

/** Header names whose values never survive redaction. */
const SECRET_HEADERS =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|password|token|x-auth-token|x-access-token)$/i

const PLACEHOLDER = '***'

/** Cap on any single trace field. A trace is for reading, not for archiving. */
const MAX_LENGTH = 2000

/**
 * Redact and truncate a string for a trace.
 *
 * `extra` holds values that are secret because of *where they came from*
 * rather than what they look like — the source variable, a stored `src.vars`
 * value — and are removed wherever they appear, including URL-encoded.
 */
export function redactForTrace(value: string, extra: readonly string[] = []): Redacted {
  let out = value

  // Values we know are secrets go first: they may appear anywhere, and after
  // structural redaction there would be no way to recognise them.
  for (const secret of extra) {
    if (!secret || secret.length < 3) continue
    out = replaceAll(out, secret, PLACEHOLDER)
    try {
      const encoded = encodeURIComponent(secret)
      if (encoded !== secret) out = replaceAll(out, encoded, PLACEHOLDER)
    } catch {
      // A lone surrogate cannot be encoded; the literal pass above still ran.
    }
  }

  out = redactUrls(out)
  out = redactStructured(out)

  return truncate(out) as Redacted
}

/** A URL with its userinfo and secret query parameters removed. */
export function redactUrl(url: string, extra: readonly string[] = []): Redacted {
  return redactForTrace(url, extra)
}

/**
 * Already-safe text, marked as such.
 *
 * For strings the runtime itself produced — a rule's own source, a block name,
 * a count. Deliberately explicit at the call site so "is this safe?" is a
 * question someone answered rather than skipped.
 */
export function assertSafeForTrace(value: string): Redacted {
  return truncate(value) as Redacted
}

function redactUrls(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => {
    let parsed: URL
    try {
      parsed = new URL(match)
    } catch {
      return match
    }
    if (parsed.username || parsed.password) {
      parsed.username = PLACEHOLDER
      parsed.password = ''
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_KEYS.test(key)) parsed.searchParams.set(key, PLACEHOLDER)
    }
    return parsed.toString()
  })
}

/**
 * Secrets outside a URL: header dumps, form bodies, JSON payloads.
 *
 * ⚠️ The header arm returns the **original match** when it does not redact.
 * Rebuilding it as `${name}: ${value}` normalised the whitespace, and since
 * `https://host/x` reads as the header `https` with value `//host/x`, every
 * redacted URL came back as `https: //host/x` — unparseable. A trace exists to
 * be pasted somewhere; corrupting the URLs in it defeats the point.
 */
function redactStructured(text: string): string {
  return text
    .replace(
      /^([ \t]*[A-Za-z0-9-]+)([ \t]*:[ \t]*)(.+)$/gm,
      (match, name: string, sep: string, value: string) => {
        // A scheme, not a header. `https://…` is the common case and the one
        // that used to be mangled.
        if (value.startsWith('//')) return match
        return SECRET_HEADERS.test(name.trim()) ? `${name}${sep}${PLACEHOLDER}` : match
      },
    )
    // `k=v` in a query string or form body, quoted or bare.
    .replace(
      /\b([A-Za-z_][A-Za-z0-9_-]*)=("[^"]*"|'[^']*'|[^&\s"']+)/g,
      (match, key: string, value: string) => {
        if (!SECRET_KEYS.test(key)) return match
        const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : ''
        return `${key}=${quote}${PLACEHOLDER}${quote}`
      },
    )
    // `"k": "v"` in a JSON body — a login response is the obvious case, and
    // the colon channel is invisible to both regexes above.
    .replace(
      /("([A-Za-z_][A-Za-z0-9_-]*)"\s*:\s*)"[^"]*"/g,
      (match, prefix: string, key: string) =>
        SECRET_KEYS.test(key) ? `${prefix}"${PLACEHOLDER}"` : match,
    )
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement)
}

function truncate(value: string): string {
  return value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH)}… (truncated)`
}
