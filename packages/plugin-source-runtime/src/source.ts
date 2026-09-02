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

import { NetworkError, NotFoundError, RuleError } from '@BBeBee/protocol'
import type {
  AuthFlow,
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
import { evaluateRule, type TemplateScope } from '@BBeBee/source-rules'
import { capabilitiesFor } from './capabilities.js'

/** What the runtime needs from its context. Kept narrow so tests need no kernel. */
export interface SourceDeps {
  http: HttpService
  /** The track payload a search stored, keyed by track id. */
  trackPayload?(id: string): Promise<Record<string, unknown> | undefined>
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
    const declared = record.doc.ruleStream?.seekable
    if (declared) this.seekable = this.renderOptional('seekable', declared, {}) !== 'false'
  }

  get sourceId(): string {
    return this.record.id
  }

  get capabilities(): Capabilities {
    return capabilitiesFor(this.record.doc, {
      ...(this.seekable !== undefined ? { seekable: this.seekable } : {}),
    })
  }

  /**
   * The provider handed to `ctx.sources`.
   *
   * Optional members are **absent, not stubbed**: this slice serves the
   * required core and nothing else, which makes it the regression test that
   * every screen checks `capabilities` before reaching for a member.
   */
  provider(): MediaProvider {
    return {
      sourceId: this.record.id,
      displayName: this.record.name,
      capabilities: this.capabilities,
      auth: this.auth,
      getTrack: (id) => this.getTrack(id),
      resolveStream: (id, prefs) => this.resolveStream(id, prefs),
      ping: () => this.ping(),
    }
  }

  async getTrack(id: string): Promise<Track> {
    const payload = await this.payloadFor(id)
    const title = typeof payload?.title === 'string' ? payload.title : lastSegment(this.record.sourceUrl)
    return {
      urn: `BBeBee:${this.record.id}:track:${id}`,
      title,
      artists: [],
      available: true,
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

  /** Cheap by contract: one HEAD against the base URL, and no rules run. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.deps.http({
        url: this.record.sourceUrl,
        method: 'HEAD',
        timeoutMs: 5000,
      })
      return res.status < 400
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

  /**
   * Ask the server what it will serve.
   *
   * A server that refuses HEAD is common, so a failure here is not fatal —
   * playback is attempted anyway and the player's own error path deals with it.
   * A 4xx *is* fatal, because it names a URL that will not play.
   */
  private async probe(
    url: string,
  ): Promise<{ seekable: boolean; byteLength?: number; mimeType?: string } | undefined> {
    try {
      const head = await this.deps.http({ url, method: 'HEAD' })
      if (head.status >= 400) {
        throw new NotFoundError(`${head.status} for ${url}`, this.record.id)
      }
      const length = Number(head.headers['content-length'] ?? '')
      const mimeType = head.headers['content-type']
      return {
        seekable: (head.headers['accept-ranges'] ?? '').includes('bytes'),
        ...(Number.isFinite(length) && length > 0 ? { byteLength: length } : {}),
        ...(mimeType ? { mimeType } : {}),
      }
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      if (!(error instanceof NetworkError)) throw error
      return undefined
    }
  }
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
