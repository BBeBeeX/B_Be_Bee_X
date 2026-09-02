/**
 * The core schema.
 *
 * Forward-only and versioned. Every table here is specified in
 * docs/07-data-model.md §4 — that document is the reference, this is the
 * executable form of it.
 *
 * Conventions: timestamps are epoch-ms INTEGERs, booleans are 0/1 INTEGERs,
 * JSON lives in TEXT columns with a `_json` suffix, and foreign keys to
 * catalogue rows are URN TEXT rather than integer ids.
 */

import type { Migration } from '@BBeBee/protocol'

export const CORE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: [
      /* ── Sources, accounts, sessions ───────────────────────────────── */
      // The imported document *is* the row. `doc_json` is the string
      // verbatim rather than shredded into columns, because export must emit
      // what was imported: reordered keys or a dropped unknown field would
      // mean a user's document came back changed, and the first time that
      // happens they stop trusting export. See docs/07 §4.1.
      `CREATE TABLE sources (
        id                 TEXT PRIMARY KEY,
        source_url         TEXT NOT NULL UNIQUE,
        name               TEXT NOT NULL,
        source_group       TEXT,
        source_type        TEXT NOT NULL DEFAULT 'music',
        doc_json           TEXT NOT NULL,
        doc_hash           TEXT NOT NULL,
        enabled            INTEGER NOT NULL DEFAULT 1,
        sort_order         INTEGER NOT NULL DEFAULT 0,
        capabilities_json  TEXT,
        allowed_hosts_json TEXT,
        locally_modified   INTEGER NOT NULL DEFAULT 0,
        origin_uri         TEXT,
        imported_at        INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        last_check_at      INTEGER,
        last_error         TEXT,
        fail_count         INTEGER NOT NULL DEFAULT 0,
        respond_time_ms    INTEGER
      )`,
      `CREATE INDEX idx_sources_enabled ON sources(enabled, sort_order)`,
      // Per-source state a rule persisted via `src.vars`. Credential-grade:
      // never exported, cleared by signOut(). See docs/06 §3.4.
      `CREATE TABLE source_vars (
        source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, key)
      )`,
      `CREATE TABLE accounts (
        source_id      TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
        remote_user_id TEXT,
        display_name   TEXT,
        status         TEXT NOT NULL,
        expires_at     INTEGER,
        updated_at     INTEGER NOT NULL
      )`,
      // Mobile only. Desktop keeps cookies in Chromium's persisted partition.
      // Ciphertext only: the AES key lives in ctx.secrets, so a leaked
      // database file yields nothing. See docs/04 §2.1.
      `CREATE TABLE cookie_jars (
        name       TEXT PRIMARY KEY,
        ciphertext BLOB NOT NULL,
        iv         BLOB NOT NULL,
        key_ref    TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      /* ── Artwork ───────────────────────────────────────────────────── */
      `CREATE TABLE artworks (
        id             TEXT PRIMARY KEY,
        source_url     TEXT,
        local_uri      TEXT,
        width          INTEGER,
        height         INTEGER,
        blurhash       TEXT,
        dominant_color TEXT,
        bytes          INTEGER,
        fetched_at     INTEGER
      )`,
      `CREATE INDEX idx_artworks_local ON artworks(local_uri) WHERE local_uri IS NOT NULL`,

      /* ── Catalogue ─────────────────────────────────────────────────── */
      `CREATE TABLE artists (
        urn         TEXT PRIMARY KEY,
        source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        remote_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        sort_name   TEXT,
        artwork_id  TEXT REFERENCES artworks(id),
        bio         TEXT,
        fetched_at  INTEGER NOT NULL,
        raw_json    TEXT
      )`,
      `CREATE INDEX idx_artists_source ON artists(source_id)`,
      `CREATE INDEX idx_artists_sort ON artists(sort_name)`,

      `CREATE TABLE albums (
        urn          TEXT PRIMARY KEY,
        source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        remote_id    TEXT NOT NULL,
        title        TEXT NOT NULL,
        sort_title   TEXT,
        album_type   TEXT,
        release_date TEXT,
        year         INTEGER,
        track_count  INTEGER,
        disc_count   INTEGER,
        artwork_id   TEXT REFERENCES artworks(id),
        is_various   INTEGER NOT NULL DEFAULT 0,
        fetched_at   INTEGER NOT NULL,
        raw_json     TEXT
      )`,
      `CREATE INDEX idx_albums_source ON albums(source_id)`,
      `CREATE INDEX idx_albums_year ON albums(year)`,

      `CREATE TABLE tracks (
        urn               TEXT PRIMARY KEY,
        source_id         TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        remote_id         TEXT NOT NULL,
        title             TEXT NOT NULL,
        sort_title        TEXT,
        album_urn         TEXT REFERENCES albums(urn) ON DELETE SET NULL,
        track_no          INTEGER,
        disc_no           INTEGER,
        duration_ms       INTEGER,
        year              INTEGER,
        explicit          INTEGER NOT NULL DEFAULT 0,
        bpm               REAL,
        replay_gain_track REAL,
        replay_gain_album REAL,
        peak_track        REAL,
        available         INTEGER NOT NULL DEFAULT 1,
        qualities_json    TEXT,
        artwork_id        TEXT REFERENCES artworks(id),
        fetched_at        INTEGER NOT NULL,
        raw_json          TEXT
      )`,
      `CREATE INDEX idx_tracks_album ON tracks(album_urn, disc_no, track_no)`,
      `CREATE INDEX idx_tracks_source ON tracks(source_id)`,
      `CREATE INDEX idx_tracks_title ON tracks(sort_title)`,

      // A join with a role, not an artist string: "Artist feat. Other" as free
      // text makes the featured artist unbrowsable.
      `CREATE TABLE track_artists (
        track_urn  TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
        artist_urn TEXT NOT NULL REFERENCES artists(urn) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'main',
        ordinal    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (track_urn, artist_urn, role)
      )`,
      `CREATE INDEX idx_track_artists_artist ON track_artists(artist_urn)`,
      `CREATE TABLE album_artists (
        album_urn  TEXT NOT NULL REFERENCES albums(urn) ON DELETE CASCADE,
        artist_urn TEXT NOT NULL REFERENCES artists(urn) ON DELETE CASCADE,
        ordinal    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (album_urn, artist_urn)
      )`,
      `CREATE TABLE genres (id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
      `CREATE TABLE track_genres (
        track_urn TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
        genre_id  TEXT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
        PRIMARY KEY (track_urn, genre_id)
      )`,

      /* ── Identity linking ──────────────────────────────────────────── */
      `CREATE TABLE external_ids (
        urn       TEXT NOT NULL,
        namespace TEXT NOT NULL,
        value     TEXT NOT NULL,
        PRIMARY KEY (urn, namespace, value)
      )`,
      `CREATE INDEX idx_external_lookup ON external_ids(namespace, value)`,
      // CHECK keeps the relation symmetric without storing it twice, which
      // would risk the two directions disagreeing.
      `CREATE TABLE track_links (
        urn_a      TEXT NOT NULL,
        urn_b      TEXT NOT NULL,
        confidence REAL NOT NULL,
        method     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (urn_a, urn_b),
        CHECK (urn_a < urn_b)
      )`,
      `CREATE INDEX idx_links_b ON track_links(urn_b)`,

      /* ── Local media ───────────────────────────────────────────────── */
      // A binding is what "downloaded" means; there is no is_downloaded flag.
      `CREATE TABLE media_bindings (
        id           TEXT PRIMARY KEY,
        track_urn    TEXT NOT NULL REFERENCES tracks(urn) ON DELETE CASCADE,
        uri          TEXT NOT NULL,
        format       TEXT,
        codec        TEXT,
        bitrate_kbps INTEGER,
        sample_rate  INTEGER,
        channels     INTEGER,
        bit_depth    INTEGER,
        size_bytes   INTEGER,
        checksum     TEXT,
        origin       TEXT NOT NULL,
        quality      TEXT,
        verified_at  INTEGER,
        created_at   INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_bindings_track ON media_bindings(track_urn)`,
      `CREATE UNIQUE INDEX idx_bindings_uri ON media_bindings(uri)`,

      `CREATE TABLE scan_roots (
        id            TEXT PRIMARY KEY,
        uri           TEXT NOT NULL UNIQUE,
        recursive     INTEGER NOT NULL DEFAULT 1,
        enabled       INTEGER NOT NULL DEFAULT 1,
        include_globs TEXT,
        exclude_globs TEXT,
        last_scan_at  INTEGER,
        last_error    TEXT
      )`,
      // (size, mtime) is the incremental-scan key: unchanged files cost one stat.
      `CREATE TABLE scan_entries (
        uri        TEXT PRIMARY KEY,
        root_id    TEXT NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
        size       INTEGER NOT NULL,
        mtime      INTEGER NOT NULL,
        track_urn  TEXT REFERENCES tracks(urn) ON DELETE SET NULL,
        status     TEXT NOT NULL,
        error      TEXT,
        scanned_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_scan_entries_root ON scan_entries(root_id, status)`,

      /* ── Playlists and library ─────────────────────────────────────── */
      `CREATE TABLE playlists (
        urn              TEXT PRIMARY KEY,
        source_id        TEXT REFERENCES sources(id) ON DELETE CASCADE,
        remote_id        TEXT,
        name             TEXT NOT NULL,
        description      TEXT,
        artwork_id       TEXT REFERENCES artworks(id),
        owner            TEXT,
        is_public        INTEGER NOT NULL DEFAULT 0,
        is_smart         INTEGER NOT NULL DEFAULT 0,
        smart_query_json TEXT,
        track_count      INTEGER,
        duration_ms      INTEGER,
        revision         INTEGER NOT NULL DEFAULT 0,
        remote_revision  TEXT,
        sync_state       TEXT NOT NULL DEFAULT 'clean',
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL
      )`,
      // `position` is a fractional index, so moving one track in a 5,000-track
      // playlist writes exactly one row instead of renumbering the tail.
      `CREATE TABLE playlist_items (
        id           TEXT PRIMARY KEY,
        playlist_urn TEXT NOT NULL REFERENCES playlists(urn) ON DELETE CASCADE,
        position     TEXT NOT NULL,
        track_urn    TEXT NOT NULL,
        added_at     INTEGER NOT NULL,
        added_by     TEXT,
        note         TEXT
      )`,
      `CREATE INDEX idx_playlist_items ON playlist_items(playlist_urn, position)`,

      `CREATE TABLE library_items (
        urn         TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        source_id   TEXT NOT NULL,
        added_at    INTEGER NOT NULL,
        pinned      INTEGER NOT NULL DEFAULT 0,
        sort_key    TEXT
      )`,
      `CREATE INDEX idx_library_kind ON library_items(kind, added_at DESC)`,
      `CREATE TABLE collections (
        id         TEXT PRIMARY KEY,
        parent_id  TEXT REFERENCES collections(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        position   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE collection_items (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        urn           TEXT NOT NULL,
        position      TEXT NOT NULL,
        PRIMARY KEY (collection_id, urn)
      )`,

      /* ── Playback ──────────────────────────────────────────────────── */
      `CREATE TABLE queue_items (
        id                  TEXT PRIMARY KEY,
        position            TEXT NOT NULL,
        track_urn           TEXT NOT NULL,
        source_context_json TEXT,
        added_by            TEXT NOT NULL,
        added_at            INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_queue_position ON queue_items(position)`,
      `CREATE TABLE playback_state (
        id               INTEGER PRIMARY KEY CHECK (id = 1),
        current_item_id  TEXT REFERENCES queue_items(id) ON DELETE SET NULL,
        position_ms      INTEGER NOT NULL DEFAULT 0,
        repeat_mode      TEXT NOT NULL DEFAULT 'off',
        shuffle          INTEGER NOT NULL DEFAULT 0,
        shuffle_seed     INTEGER,
        volume           REAL NOT NULL DEFAULT 1.0,
        muted            INTEGER NOT NULL DEFAULT 0,
        output_device_id TEXT,
        device_id        TEXT NOT NULL,
        updated_at       INTEGER NOT NULL
      )`,
      // Append-only truth; track_stats is the derived cache.
      `CREATE TABLE play_history (
        id             TEXT PRIMARY KEY,
        track_urn      TEXT NOT NULL,
        started_at     INTEGER NOT NULL,
        ended_at       INTEGER,
        ms_played      INTEGER NOT NULL DEFAULT 0,
        completed      INTEGER NOT NULL DEFAULT 0,
        skipped        INTEGER NOT NULL DEFAULT 0,
        source_json    TEXT,
        device_id      TEXT,
        scrobble_state TEXT NOT NULL DEFAULT 'none'
      )`,
      `CREATE INDEX idx_history_track ON play_history(track_urn, started_at DESC)`,
      `CREATE INDEX idx_history_time ON play_history(started_at DESC)`,
      `CREATE INDEX idx_history_scrobble ON play_history(scrobble_state) WHERE scrobble_state = 'pending'`,
      `CREATE TABLE track_stats (
        urn            TEXT PRIMARY KEY,
        play_count     INTEGER NOT NULL DEFAULT 0,
        skip_count     INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER,
        rating         INTEGER,
        loved          INTEGER NOT NULL DEFAULT 0
      )`,

      /* ── Downloads ─────────────────────────────────────────────────── */
      `CREATE TABLE download_policies (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        enabled       INTEGER NOT NULL DEFAULT 1,
        scope_json    TEXT NOT NULL,
        quality       TEXT NOT NULL,
        wifi_only     INTEGER NOT NULL DEFAULT 1,
        max_bytes     INTEGER,
        charging_only INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      )`,
      // bytes_done and resume_token are written after every chunk, so a kill
      // mid-transfer costs one chunk. See docs/02 §4.
      `CREATE TABLE download_tasks (
        id           TEXT PRIMARY KEY,
        track_urn    TEXT NOT NULL,
        target_uri   TEXT NOT NULL,
        state        TEXT NOT NULL,
        quality      TEXT,
        bytes_done   INTEGER NOT NULL DEFAULT 0,
        bytes_total  INTEGER,
        etag         TEXT,
        resume_token TEXT,
        priority     INTEGER NOT NULL DEFAULT 0,
        attempts     INTEGER NOT NULL DEFAULT 0,
        last_error   TEXT,
        binding_id   TEXT REFERENCES media_bindings(id) ON DELETE SET NULL,
        policy_id    TEXT REFERENCES download_policies(id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        finished_at  INTEGER
      )`,
      `CREATE INDEX idx_downloads_state ON download_tasks(state, priority DESC, created_at)`,
      `CREATE UNIQUE INDEX idx_downloads_track ON download_tasks(track_urn) WHERE state != 'done'`,

      /* ── DSP and settings ──────────────────────────────────────────── */
      `CREATE TABLE effect_chains (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 0,
        scope      TEXT NOT NULL DEFAULT 'global',
        created_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX idx_chain_active ON effect_chains(scope) WHERE is_active = 1`,
      `CREATE TABLE effect_nodes (
        chain_id    TEXT NOT NULL REFERENCES effect_chains(id) ON DELETE CASCADE,
        effect_id   TEXT NOT NULL,
        ordinal     INTEGER NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        params_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (chain_id, effect_id)
      )`,
      `CREATE INDEX idx_effect_order ON effect_nodes(chain_id, ordinal)`,
      `CREATE TABLE presets (
        id          TEXT PRIMARY KEY,
        effect_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        params_json TEXT NOT NULL,
        builtin     INTEGER NOT NULL DEFAULT 0
      )`,
      // Keys are namespaced by plugin id; scope separates what should follow
      // the user from what is genuinely per-machine.
      `CREATE TABLE settings (
        key        TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'global',
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, scope)
      )`,

      /* ── Plugins ───────────────────────────────────────────────────── */
      `CREATE TABLE plugin_records (
        id           TEXT PRIMARY KEY,
        version      TEXT NOT NULL,
        source       TEXT NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        config_json  TEXT,
        install_uri  TEXT,
        integrity    TEXT,
        installed_at INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        last_error   TEXT,
        fail_count   INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE capability_grants (
        plugin_id  TEXT NOT NULL REFERENCES plugin_records(id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        granted_by TEXT NOT NULL DEFAULT 'user',
        PRIMARY KEY (plugin_id, capability)
      )`,

      /* ── Lyrics and cache ──────────────────────────────────────────── */
      `CREATE TABLE lyrics (
        track_urn    TEXT NOT NULL,
        source_id    TEXT NOT NULL,
        format       TEXT NOT NULL,
        content      TEXT NOT NULL,
        synced       INTEGER NOT NULL DEFAULT 0,
        offset_ms    INTEGER NOT NULL DEFAULT 0,
        language     TEXT NOT NULL DEFAULT '',
        is_preferred INTEGER NOT NULL DEFAULT 0,
        fetched_at   INTEGER NOT NULL,
        PRIMARY KEY (track_urn, source_id, language)
      )`,
      // LRU within a class, each with its own quota: evicting artwork costs a
      // re-fetch, evicting a partial stream costs the user their place.
      `CREATE TABLE cache_entries (
        key            TEXT PRIMARY KEY,
        class          TEXT NOT NULL,
        uri            TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL,
        last_access_at INTEGER NOT NULL,
        expires_at     INTEGER,
        created_at     INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_cache_evict ON cache_entries(class, last_access_at)`,
    ],
  },
  {
    version: 2,
    // Full-text search, separate from v1 so a build without FTS5 fails here
    // rather than leaving the whole schema unapplied.
    up: [
      // `contentless_delete=1` is REQUIRED. A plain `content=''` table cannot
      // be DELETEd from or UPDATEd at all ("cannot DELETE from contentless
      // fts5 table"), so a renamed or removed track would leave its row in the
      // index forever and searches would return stale hits without bound.
      // Needs SQLite >= 3.43; Node 22.12+ and Electron 44 both ship newer.
      //
      // ⚠️ Even with the flag, a partial UPDATE is rejected — the whole row
      // must be rewritten. Re-index as DELETE + INSERT on the same rowid.
      //
      // External content (content='tracks') is not an option here: the indexed
      // `artist_names` column is an aggregate over `track_artists`, not a
      // column of `tracks`.
      `CREATE VIRTUAL TABLE tracks_fts USING fts5(
        title, artist_names, album_title,
        content='', contentless_delete=1,
        tokenize='unicode61 remove_diacritics 2'
      )`,
      // FTS5 addresses rows by integer rowid, but the catalogue is keyed by
      // URN. This maps between them so a track can be re-indexed or removed
      // by URN without a full rebuild.
      `CREATE TABLE tracks_fts_map (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        urn   TEXT NOT NULL UNIQUE REFERENCES tracks(urn) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_tracks_fts_map_urn ON tracks_fts_map(urn)`,
    ],
  },
]
