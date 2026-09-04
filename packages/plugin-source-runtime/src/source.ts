/**
 * One imported source, presented as a `MediaProvider`.
 *
 * This is the M1 slice (docs/11 MD-7): a source row, a fiber, a `=` template,
 * and a stream. `ruleStream` is rendered against the stored track payload and
 * the active `StreamPrefs`; everything else in docs/06 — the selector engines,
 * search, explore, login, `@js:` — arrives with the rest of the runtime.
 *
 * The important property even at this size is that `ruleStream` depends only
 * on `{{source.*}}`, `{{track.*}}` and `{{prefs.*}}` — never on state left
 * over from a search. The user plays from their library hours later, offline
 * from whatever produced the track, and resolution must still work.
 */

import {
  AuthError,
  hostAllowedBy,
  NetworkError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RuleError,
  UnavailableError,
} from '@BBeBee/protocol'
import type {
  AuthFlow,
  PageRequest,
  SearchQuery,
  SearchResult,
  AuthStatus,
  Capabilities,
  Disposable,
  HttpService,
  MediaProvider,
  ProviderAuth,
  SourceRecord,
  StreamHandle,
  StreamPrefs,
  Track,
} from '@BBeBee/protocol'
import { formatUrn } from '@BBeBee/protocol'
import { engineAvailable, parseRule, type TemplateScope } from '@BBeBee/source-rules'
import { evaluateRule } from '@BBeBee/source-rules'
import { capabilitiesFor } from './capabilities.js'
import { fetchDocument, parseUrlObject } from './fetch.js'
import { evaluateListRule, rowToTrack } from './list-rule.js'

/** What the runtime needs from its context. Kept narrow so tests need no kernel. */
export interface SourceDeps {
  http: HttpService
  /** The track payload a search stored, keyed by track id. */
  trackPayload?(id: string): Promise<Record<string, unknown> | undefined>
  /**
   * Where a note about a rule that half-worked goes.
   *
   * Optional so a test can construct a source without a context, but supplied
   * in production: a rule dropping rows is the kind of thing that otherwise
   * only shows up as "the search is missing things".
   */
  log?(message: string): void
}

/**
 * Auth synthesised from the document.
 *
 * A document with no login fields is `flow: 'none'` and its two methods are
 * trivial — which is precisely the case that proves requiring `auth` on every
 * provider costs nothing. `variable` is the other flow this slice can express;
 * `form` and `webview` need the login pipeline, which is M2.
 */
class DocumentAuth implements ProviderAuth {
  readonly flow: AuthFlow
  status: AuthStatus = { state: 'authenticated' }
  private readonly listeners = new Set<(s: AuthStatus) => void>()

  constructor(record: SourceRecord) {
    this.flow = record.doc.variableComment
      ? { kind: 'variable', comment: record.doc.variableComment }
      : { kind: 'none' }
  }

  async signIn(): Promise<void> {
    this.set({ state: 'authenticated' })
  }

  async signOut(): Promise<void> {
    // The jar, the secrets namespace and `source_vars` are cleared by the
    // runtime around this call — they live outside the provider, in the
    // source's isolated scope. See docs/06 §5.1.
    this.set({ state: 'anonymous' })
  }

  onStatusChange(cb: (s: AuthStatus) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  private set(status: AuthStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }
}

export class DocumentSource {
  private readonly auth: DocumentAuth
  /** Learned from a HEAD when the document does not say. */
  private seekable: boolean | undefined

  constructor(
    private readonly record: SourceRecord,
    private readonly deps: SourceDeps,
  ) {
    this.auth = new DocumentAuth(record)
    // ⚠️ No rule is evaluated here. `seekable` used to be rendered in the
    // constructor against an empty scope, so a perfectly reasonable document
    // — `seekable: '={{prefs.saveData}}'` — threw a RuleError during
    // construction, which propagated through `startOne` out of `apply` and
    // marked the *whole plugin* FAILED. Every source became unusable, on
    // every boot. A rule is evaluated when it has a scope to be evaluated in.
  }

  get sourceId(): string {
    return this.record.id
  }

  get capabilities(): Capabilities {
    return capabilitiesFor(this.record.doc, {
      ...(this.seekable !== undefined ? { seekable: this.seekable } : {}),
      searchable: this.searchable,
    })
  }

  /**
   * The provider handed to `ctx.sources`.
   *
   * Optional members are **absent, not stubbed**: this slice serves the
   * required core and nothing else, which makes it the regression test that
   * every screen checks `capabilities` before reaching for a member.
   */
  /**
   * Whether this document's search rules can actually run in this build.
   *
   * A document may describe a search whose rules need an engine this build
   * does not have — `@css:` without a markup parser, `@js:` without `ctx.js`.
   * Declaring `search: true` then produces a capability the UI offers and the
   * runtime cannot honour, which is exactly the over-declaration deriving
   * capabilities exists to prevent (docs/06 §1.3).
   */
  private get searchable(): boolean {
    const doc = this.record.doc
    if (!doc.searchUrl || !doc.ruleSearch?.trackList) return false
    return rulesRunnable([
      doc.searchUrl,
      ...Object.values(doc.ruleSearch).filter((r): r is string => typeof r === 'string'),
    ])
  }

  provider(): MediaProvider {
    // `capabilities` is a getter, not a value. Snapshotting it at registration
    // froze `streaming.seekable` at its default of true, so what the HEAD
    // probe learned never reached the UI — an over-declaration of exactly the
    // kind deriving capabilities exists to prevent (docs/11 §4.10).
    const capabilities = () => this.capabilities
    return {
      sourceId: this.record.id,
      displayName: this.record.name,
      get capabilities() {
        return capabilities()
      },
      auth: this.auth,
      getTrack: (id) => this.getTrack(id),
      resolveStream: (id, prefs) => this.resolveStream(id, prefs),
      ping: () => this.ping(),
      // Absent, not stubbed, when the document does not describe a search or
      // this build cannot run its rules. `ctx.sources` skips a provider whose
      // `search` is missing rather than calling one that throws.
      ...(this.searchable ? { search: (q, page) => this.search(q, page) } : {}),
    }
  }

  async getTrack(id: string): Promise<Track> {
    const payload = await this.payloadFor(id)
    const title = typeof payload?.title === 'string' ? payload.title : lastSegment(this.record.sourceUrl)
    return {
      urn: formatUrn({ sourceId: this.record.id, kind: 'track', id }),
      title,
      artists: [],
      available: true,
    }
  }

  /**
   * Search the backend.
   *
   * Render `searchUrl`, fetch it, run `ruleSearch` over what came back. The
   * page number is 1-based and reaches the template as `{{page}}`; a document
   * that ignores it simply returns the same page, which is why the runtime
   * stops when a page repeats rather than trusting `hasMore`.
   */
  async search(query: SearchQuery, page?: PageRequest): Promise<SearchResult> {
    const doc = this.record.doc
    if (!doc.searchUrl || !doc.ruleSearch) {
      throw new RuleError(
        'this source has no searchUrl or ruleSearch',
        { block: 'ruleSearch', field: 'trackList' },
        this.record.id,
      )
    }

    const pageNumber = pageNumberOf(page)
    const scope: TemplateScope = {
      source: { url: this.record.sourceUrl, name: this.record.name },
      key: query.text,
      page: pageNumber,
      baseUrl: this.record.sourceUrl,
    }

    const rendered = evaluateRule(doc.searchUrl, scope, {
      block: 'searchUrl',
      field: 'searchUrl',
      sourceId: this.record.id,
    })
    const target = parseUrlObject(rendered)
    this.assertAllowed(target.url)

    const fetched = await fetchDocument(
      this.deps.http,
      target,
      this.headers(scope),
      this.record.id,
    )

    const { rows, dropped } = evaluateListRule(doc.ruleSearch, {
      document: fetched.value,
      scope: { ...scope, baseUrl: fetched.baseUrl },
      sourceId: this.record.id,
      block: 'ruleSearch',
    })
    if (dropped > 0) {
      // Counted rather than hidden: a search quietly returning three of
      // twenty results reads as a thin backend, not as a broken rule.
      this.deps.log?.(
        `${this.record.id}: ruleSearch dropped ${dropped} result(s) missing trackId or title`,
      )
    }

    const tracks = rows.map((row) => rowToTrack(row, this.record.id, 'ruleSearch'))
    return {
      tracks: {
        items: tracks,
        // The backend rarely says, and inventing a total produces a progress
        // bar that lies (docs/06 §4.3).
        hasMore: tracks.length > 0,
        ...(tracks.length > 0 ? { cursor: String(pageNumber + 1) } : {}),
      },
    }
  }

  /** Headers the document declares, rendered against the current scope. */
  private headers(scope: TemplateScope): Record<string, string> | undefined {
    const rule = this.record.doc.header
    if (!rule) return undefined
    const rendered = evaluateRule(rule, scope, {
      block: 'header',
      field: 'header',
      sourceId: this.record.id,
    })
    try {
      const parsed: unknown = JSON.parse(rendered)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
      return Object.keys(out).length > 0 ? out : undefined
    } catch {
      throw new RuleError(
        'header must render to a JSON object',
        { block: 'header', field: 'header' },
        this.record.id,
      )
    }
  }

  /**
   * The moment a URN becomes bytes.
   *
   * Everything in scope here is either the document's own (`source`), stored
   * with the track (`track`), or the caller's (`prefs`). A rule that reaches
   * for anything else fails with a `RuleError` naming itself, which is what
   * makes the difference between "this source needs updating" and "something
   * went wrong".
   */
  async resolveStream(id: string, prefs: StreamPrefs): Promise<StreamHandle> {
    const rules = this.record.doc.ruleStream
    if (!rules) {
      throw new RuleError(
        `source ${this.record.id} has no ruleStream`,
        { block: 'ruleStream', field: 'url' },
        this.record.id,
      )
    }

    const scope = await this.scopeFor(id, prefs)
    const target = evaluateRule(rules.url, scope, {
      block: 'ruleStream',
      field: 'url',
      sourceId: this.record.id,
    })

    // The one artifact that leaves this package and is fetched by something
    // else: `ctx.audio` loads it directly, outside the source's scoped http.
    // Without this check the egress allowlist would govern one optional HEAD
    // and nothing that actually moves bytes — nominal, not real.
    this.assertAllowed(target)

    const declaredSeekable = rules.seekable
      ? this.renderOptional('seekable', rules.seekable, scope) !== 'false'
      : undefined
    const probe = declaredSeekable === undefined ? await this.probe(target) : undefined

    const mimeType = this.renderOptional('mimeType', rules.mimeType, scope) ?? probe?.mimeType
    const byteLength = numberOr(this.renderOptional('byteLength', rules.byteLength, scope)) ?? probe?.byteLength
    const expiresAt = numberOr(this.renderOptional('expiresAt', rules.expiresAt, scope))
    const bitrateKbps = numberOr(this.renderOptional('bitrateKbps', rules.bitrateKbps, scope))
    const headers = parseHeaders(this.renderOptional('headers', rules.headers, scope))

    this.seekable = declaredSeekable ?? probe?.seekable ?? this.seekable ?? true

    return {
      kind: 'remote',
      target,
      seekable: this.seekable,
      ...(mimeType ? { mimeType } : {}),
      ...(byteLength ? { byteLength } : {}),
      ...(bitrateKbps ? { bitrateKbps } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(headers ? { headers } : {}),
    }
  }

  /**
   * Cheap by contract: one HEAD against the base URL, and no rules run.
   *
   * "Reachable" is the question, not "healthy". A server that refuses HEAD or
   * demands credentials is reachable — reporting it unreachable would make the
   * source list say the network is down when the network is fine.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.deps.http({
        url: this.record.sourceUrl,
        method: 'HEAD',
        timeoutMs: 5000,
      })
      if (res.status === 405 || res.status === 501) return true
      if (res.status === 401 || res.status === 403) return true
      return res.status < 500
    } catch {
      return false
    }
  }

  private async scopeFor(id: string, prefs: StreamPrefs): Promise<TemplateScope> {
    const payload = await this.payloadFor(id)
    return {
      source: { url: this.record.sourceUrl, name: this.record.name },
      track: { id, ...(payload ?? {}) },
      prefs: { ...prefs },
      baseUrl: this.record.sourceUrl,
    }
  }

  private async payloadFor(id: string): Promise<Record<string, unknown> | undefined> {
    if (!this.deps.trackPayload) return undefined
    return this.deps.trackPayload(id)
  }

  /** Optional rules resolve to `undefined` when absent, and throw when broken. */
  private renderOptional(
    field: string,
    rule: string | undefined,
    scope: TemplateScope,
  ): string | undefined {
    if (!rule) return undefined
    return evaluateRule(rule, scope, {
      block: 'ruleStream',
      field,
      sourceId: this.record.id,
    })
  }

  /** Refuse a URL to a host this source did not declare. */
  private assertAllowed(target: string): void {
    let host: string
    try {
      // `hostname` keeps IPv6 brackets and may carry a trailing FQDN dot;
      // `declaredHostMatches` normalises both, so `example.org.` cannot get
      // one verdict here and another at the HTTP gate.
      host = new URL(target).hostname
    } catch {
      throw new ProviderError(`ruleStream.url produced a malformed URL`, this.record.id)
    }
    if (!hostAllowedBy(host, this.record.allowedHosts)) {
      throw new UnavailableError(
        `${this.record.id} did not declare ${host}; add it to allowedHosts and re-import`,
        this.record.id,
      )
    }
  }

  /**
   * Ask the server what it will serve.
   *
   * ⚠️ A status code is not a diagnosis, and collapsing them all into
   * `NotFoundError` made three separate lies: a HEAD-refusing server (405/501,
   * which the code itself called common) was reported as a dead URL; an
   * expired session (401/403) skipped the re-login path; and a transient 500
   * became non-retryable, so a blip halted playback and a health check killed
   * a live source.
   */
  private async probe(
    url: string,
  ): Promise<{ seekable: boolean; byteLength?: number; mimeType?: string } | undefined> {
    let head
    try {
      head = await this.deps.http({ url, method: 'HEAD' })
    } catch (error) {
      // Transport failure. Not fatal: plenty of servers dislike HEAD, and the
      // player's own error path handles a target that turns out to be dead.
      if (error instanceof NetworkError) return undefined
      throw error
    }

    if (head.status < 400) {
      const length = Number(head.headers['content-length'] ?? '')
      const mimeType = head.headers['content-type']
      return {
        seekable: (head.headers['accept-ranges'] ?? '').includes('bytes'),
        ...(Number.isFinite(length) && length > 0 ? { byteLength: length } : {}),
        ...(mimeType ? { mimeType } : {}),
      }
    }

    // The server answered, and what it said matters.
    if (head.status === 405 || head.status === 501) return undefined // no HEAD; assume playable
    if (head.status === 404 || head.status === 410) {
      throw new NotFoundError(`${head.status} for ${url}`, this.record.id)
    }
    if (head.status === 401 || head.status === 403) {
      throw new AuthError(`${head.status} for ${url}`, this.record.id)
    }
    if (head.status === 429) {
      throw new RateLimitError(`rate limited by ${new URL(url).hostname}`, 60_000, this.record.id)
    }
    if (head.status >= 500) {
      throw new NetworkError(`${head.status} from ${url}`, this.record.id)
    }
    throw new ProviderError(`${head.status} for ${url}`, this.record.id)
  }
}

/** A page cursor is an opaque string that happens to be a number here. */
function pageNumberOf(page: PageRequest | undefined): number {
  const parsed = Number(page?.cursor ?? '1')
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

/** Whether every rule in a set uses only engines this build can run. */
function rulesRunnable(rules: string[]): boolean {
  return rules.every((rule) =>
    parseRule(rule).alternatives.every((alt) =>
      alt.parts.every((part) => part.atoms.every((atom) => engineAvailable(atom.engine))),
    ),
  )
}

function numberOr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v
    }
    return Object.keys(out).length ? out : undefined
  } catch {
    return undefined
  }
}

function lastSegment(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? url)
  } catch {
    return url
  }
}
