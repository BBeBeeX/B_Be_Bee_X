/**
 * The `sources` table: imported documents, and everything the app knows about
 * them.
 *
 * `doc_json` is the imported string **verbatim**, not the parsed document
 * re-serialised. Export must emit what was imported — reordered keys, a
 * dropped unknown field, or reformatted whitespace would mean a user's
 * document came back changed, and the first time that happens they stop
 * trusting export (docs/07 §4.1).
 */

import type { DbService, SourceDocument, SourceRecord, SourceType, SqlValue } from '@BBeBee/protocol'
import { hash32 } from './identity.js'

interface SourceRow {
  id: string
  source_url: string
  name: string
  source_group: string | null
  source_type: string
  doc_json: string
  doc_hash: string
  enabled: number
  sort_order: number
  allowed_hosts_json: string | null
  locally_modified: number
  origin_uri: string | null
  imported_at: number
  updated_at: number
  last_check_at: number | null
  last_error: string | null
  fail_count: number
  respond_time_ms: number | null
}

const COLUMNS = `id, source_url, name, source_group, source_type, doc_json, doc_hash,
                 enabled, sort_order, allowed_hosts_json, locally_modified, origin_uri,
                 imported_at, updated_at, last_check_at, last_error, fail_count, respond_time_ms`

export class SourceStore {
  constructor(private readonly db: DbService) {}

  async all(): Promise<SourceRecord[]> {
    const rows = await this.db.query<SourceRow>(
      `SELECT ${COLUMNS} FROM sources ORDER BY sort_order, name`,
    )
    return rows.map(toRecord).filter((r): r is SourceRecord => r !== undefined)
  }

  async byUrl(sourceUrl: string): Promise<SourceRecord | undefined> {
    const row = await this.db.get<SourceRow>(
      `SELECT ${COLUMNS} FROM sources WHERE source_url = ?`,
      [sourceUrl],
    )
    return row && toRecord(row)
  }

  /**
   * Insert or replace one source.
   *
   * `capabilities_json` is written by the runtime once it has derived them;
   * this only stores what the document itself determines, so a row is never
   * left claiming a capability its rules cannot back.
   */
  async put(record: SourceRecord): Promise<void> {
    await this.db.exec(
      `INSERT INTO sources (${COLUMNS})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         source_url = excluded.source_url,
         name = excluded.name,
         source_group = excluded.source_group,
         source_type = excluded.source_type,
         doc_json = excluded.doc_json,
         doc_hash = excluded.doc_hash,
         enabled = excluded.enabled,
         sort_order = excluded.sort_order,
         allowed_hosts_json = excluded.allowed_hosts_json,
         locally_modified = excluded.locally_modified,
         origin_uri = excluded.origin_uri,
         updated_at = excluded.updated_at`,
      [
        record.id,
        record.sourceUrl,
        record.name,
        record.group ?? null,
        record.type,
        record.docJson,
        record.docHash,
        record.enabled ? 1 : 0,
        record.sortOrder,
        JSON.stringify(record.allowedHosts),
        record.locallyModified ? 1 : 0,
        record.originUri ?? null,
        record.importedAt,
        record.updatedAt,
        record.lastCheckAt ?? null,
        record.lastError ?? null,
        record.failCount,
        record.respondTimeMs ?? null,
      ] satisfies SqlValue[],
    )
  }

  async setEnabled(id: string, on: boolean, now: number): Promise<void> {
    await this.db.exec(`UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?`, [
      on ? 1 : 0,
      now,
      id,
    ])
  }

  /**
   * Remove a source.
   *
   * ⚠️ The two modes differ in what survives, and the difference is forced by
   * the schema rather than chosen: catalogue rows are `REFERENCES sources(id)
   * ON DELETE CASCADE`, so deleting the row *necessarily* takes the library
   * with it. There is no third option where the row is gone and the tracks
   * remain — that would be orphaned rows with unresolvable URNs.
   *
   *   forgetCatalogue: true   delete the row; the cascade drops its tracks,
   *                           albums, artists, account and vars
   *   forgetCatalogue: false  keep the row as a disabled tombstone, so the
   *                           library stays browsable and re-importing the
   *                           same document revives it with the same id
   *
   * The default is `false`, because losing a library to a mis-tapped button is
   * far worse than a stale row nothing reads.
   */
  async remove(id: string, opts: { forgetCatalogue?: boolean } = {}, now = Date.now()): Promise<void> {
    if (opts.forgetCatalogue) {
      await this.db.exec(`DELETE FROM sources WHERE id = ?`, [id])
      return
    }
    await this.db.exec(
      `UPDATE sources SET enabled = 0, updated_at = ? WHERE id = ?`,
      [now, id],
    )
  }

  async recordCheck(
    id: string,
    result: { ok: boolean; respondTimeMs?: number; message?: string; at: number },
  ): Promise<void> {
    await this.db.exec(
      `UPDATE sources
         SET last_check_at = ?, last_error = ?, respond_time_ms = ?,
             fail_count = CASE WHEN ? THEN 0 ELSE fail_count + 1 END
       WHERE id = ?`,
      [result.at, result.message ?? null, result.respondTimeMs ?? null, result.ok ? 1 : 0, id],
    )
  }

  /** Written by the runtime once capabilities are derived from the document. */
  async setCapabilities(id: string, capabilitiesJson: string): Promise<void> {
    await this.db.exec(`UPDATE sources SET capabilities_json = ? WHERE id = ?`, [
      capabilitiesJson,
      id,
    ])
  }
}

function toRecord(row: SourceRow): SourceRecord | undefined {
  let doc: SourceDocument
  try {
    doc = JSON.parse(row.doc_json) as SourceDocument
  } catch {
    // A row whose document will not parse is unusable but must not take the
    // rest of the list with it — the source list is how a user would notice.
    return undefined
  }
  return {
    id: row.id,
    sourceUrl: row.source_url,
    name: row.name,
    ...(row.source_group ? { group: row.source_group } : {}),
    type: (row.source_type as SourceType) ?? 'music',
    doc,
    docJson: row.doc_json,
    docHash: row.doc_hash || hash32(row.doc_json),
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    allowedHosts: parseHosts(row.allowed_hosts_json),
    locallyModified: row.locally_modified === 1,
    ...(row.origin_uri ? { originUri: row.origin_uri } : {}),
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
    ...(row.last_check_at ? { lastCheckAt: row.last_check_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    failCount: row.fail_count,
    ...(row.respond_time_ms ? { respondTimeMs: row.respond_time_ms } : {}),
  }
}

function parseHosts(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
