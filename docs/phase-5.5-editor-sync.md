# Phase 5.5 — additive Editor → LilyBeta sync

## Source audit

- LilyBeta source: `yeonwon2/lilybeta`, base commit `3da3530` (pulled before changes).
- Editor source: `yeonwon237/edittruyenqt`, base commit `36dc446356a7000bf601ee56d7099b9af1168ecc`.
- Verification: GitHub repository homepage is `https://edittruyenqt.vercel.app`; its HTML and `https://editor.lilyhub.top` both serve `index-SiSIJSHL.js` and `index-Bu7S6kyO.css`. GitHub production deployment `5921150025` records that same commit, status success, target `edittruyenqt-r3qb8yb7d-lilyhub.vercel.app`. The deployment-specific URL is protected; no authentication bypass was attempted. This verification uses public source/deployment metadata and public custom-domain assets, not a guess from the repo name.
- Editor local main had an untracked `.claude/launch.json` that blocked fast-forward. Work proceeds in a clean worktree on `codex/phase55-editor-sync`; the original checkout/file was not overwritten.
- Editor is React/Vite with Supabase Auth and owner-scoped RLS. `projects.id` and `chapters.id` are stable UUIDs. `chapter_order` is fractional and reorderable, so it is **not identity**. `updated_date` is a server-generated timestamp. Source text for this feature is `chapters.edited` only, never the untranslated fallback columns used by some existing exports.
- LilyBeta uses Express, pg/PostgreSQL in production, SQLite for local tests; existing manual import writes `beta_books`/`beta_chapters`, then assignments, edits/revisions, notes, chapter status, review and approval snapshots. Cache keys contain user/book/chapter index and validate `content_version` from TOC. Existing reader navigation assumes dense indices `1..total_chapters`.

## Backward compatibility

Existing parsers/importers, upload modal, `/api/admin/books`, assignments, Beta edit, complete, review and approve remain unchanged. New mappings are separate tables, with **no new mandatory columns/backfill on existing books**. Manual books need no Editor configuration, ID, account, secret or mapping. Disabling integration does not disable manual import.

The only old server wiring change mounts a new router at `/api/integrations/editor` **before** the existing 50 MB body parser. This router authenticates first and limits its own requests to 2 MB. The manual upload size/behavior is unchanged.

Editor gets one additional button beside its existing save/export controls. TXT/DOCX/JSON exports and existing autosave behavior are unchanged. Clicking a sync action explicitly saves the current chapter using the existing entity update API, propagating save errors so unsaved text is not silently exported.

## Contract v1

Service credential is server-side only. No shared database credentials or Admin browser JWT.

```
POST /api/integrations/editor/sync
Authorization: Bearer <EDITOR_SYNC_SECRET>
Content-Type: application/json
```

```json
{
  "editorBookId": "stable-project-uuid",
  "book": { "title": "Tên truyện", "author": "Tác giả", "totalChapters": 300 },
  "chapters": [{
    "editorChapterId": "stable-chapter-uuid",
    "chapterIndex": 13,
    "title": "Chương 13",
    "paragraphs": ["Nội dung dòng đầu.", "Dòng tiếp theo."],
    "updatedAt": "2026-08-27T10:00:00.000Z",
    "sourceVersion": "optional-source-revision"
  }]
}
```

- Maximum 25 chapters/batch, 2 MB total request, 1.5 MB per chapter. Empty text is rejected. Title max 500 chars; IDs max 200 chars. `updatedAt` must include timezone and cannot be more than five minutes in the future.
- Require `sourceVersion` **or** `contentHash`. `contentHash` means SHA-256 of UTF-8 `JSON.stringify({title, paragraphs})`, with title trimmed. Server always recomputes it. The Editor backend sends this hash plus `updated_date`; it does not invent chapter versions.
- `beta_chapters.content_hash` remains the pre-existing SHA-256 of `JSON.stringify(paragraphs)`. Source hash includes title, so a title-only update also increments `content_version` and invalidates old cached titles.
- New book: always creates a distinct book and mapping; never matches by title or accepts an arbitrary `betaBookId`. New chapter identity is its stable source ID. ID collision across source books fails atomically.
- `book.totalChapters` is optional source information, separate from the count of chapters actually received. The stored source total only grows: this API does not delete source chapters. State is `PARTIAL`, `SYNCED` (all known source chapters received), or `CONFLICT`. Unknown source total remains `PARTIAL`.
- Only initial book title/author are copied. Later sync updates chapters and counts; it does not overwrite an Admin's book metadata.
- Business conflicts return HTTP 200 with **per-chapter results**; clients must inspect every result. Valid siblings commit, conflicted chapter content does not change. Malformed requests/identity collisions roll back the entire batch.
- Response: `betaBookId`, `createdBook`, `sourceType`, `syncState`, `totalChapters`, `sourceTotalChapters`, `results[]`. Each result includes source ID, target ID/index, status, accepted content version/hash and reason when blocked.
- Statuses: `CREATED`, `UPDATED`, `ALREADY_SYNCED`, `STALE_SOURCE`, `SOURCE_VERSION_CONFLICT`, `SOURCE_CONFLICT`. Same source text/title does not increase content version. An older timestamp cannot overwrite newer source. Same timestamp/version with different content is rejected. Conflict markers persist so later successful batches do not hide unresolved conflicts.

```
GET /api/integrations/editor/books/:editorBookId
Authorization: Bearer <EDITOR_SYNC_SECRET>
```

Returns this integration's mapping/checkpoints only, never manuscript text, edits or unrelated manual books. Unknown source ID returns `betaBookId: null`, `chapters: []` to support first sync. Source namespace comes from server config, never from the browser payload.

### Ordering and partial sends

Beta indices remain dense and stable. Sending just source chapter 13 first creates one target chapter at Beta index 1 (title preserved), with source index 13 in its mapping. Later source chapters append at the next available Beta index. Source reorder updates mapping metadata, **not** Beta indices, IDs, statuses or edit anchors. This avoids changing the existing reader's navigation contract. Automatic target reordering and chapter deletion are deliberately unsupported.

### Protecting Beta work

Source changes are refused if a chapter has edits (including deleted edits/history), notes, active chapter status or review/approval records.

Additionally, v1 takes a conservative safety boundary: **once a book has ever been assigned, existing source chapters are frozen**, even if a chapter still appears unread. Existing readers can retain old text in cache and send edits without a content-version precondition. Allowing source replacement at that point would require changing old reader/write semantics, which this additive phase must not do. Result is `SOURCE_CONFLICT` / `BOOK_ALREADY_ASSIGNED`; unassigned chapters can update safely, and **new chapters can still append during Beta**. No force-overwrite or automatic anchor migration endpoint exists.

PostgreSQL sync uses a transaction-scoped advisory lock for `(editor_source, editor_book_id)`, unique relational keys, and a `FOR UPDATE` lock on the target book. The book lock also serializes with assignment FK insertion. Lock/statement timeouts apply only inside the sync transaction. SQLite integration requests use a local queue; SQLite is not the production concurrency model.

## Editor bridge

`POST /api/lilybeta-sync` (same-origin server endpoint):

- Verifies Editor JWT via Supabase `/auth/v1/user` and checks configured user-ID allowlist.
- Reads project and chapters with the user's JWT and explicit owner/project filters (existing RLS applies). It does **not** use either system's service role or LilyBeta database connection.
- Browser submits only `projectId`, `action: plan|batch`, and selected chapter UUIDs. It cannot choose source text, target URL or another user's project.
- Plan reads lightweight source metadata and LilyBeta's accepted checkpoints. Batch fetches full `edited` text only for selected owned chapters, computes hash and forwards at most 25.
- UI offers current/changed/all, progress, and retry of failed batches. Oversized/malformed batches are split to isolate individual large/empty chapters; auth/config/outage errors stop further requests. LilyBeta checkpoints survive page reload, so changed-only resumes without recreating prior chapters.
- A closed/unmounted workspace cancels ongoing browser requests; server writes may already have committed. Retrying is safe because the receiver is idempotent.

## Configuration / rollout

Feature is disabled unless explicitly configured. Do not set secret names with a `VITE_` prefix.

**LilyBeta server**:

```
EDITOR_SYNC_SECRET=<new-random-secret-at-least-32-characters>
EDITOR_SYNC_ADMIN_ID=<existing-active-LilyBeta-admin-profile-id>
EDITOR_SYNC_SOURCE=editor.lilyhub.top
```

**Editor server (Vercel function)**:

```
LILYBETA_SYNC_SECRET=<same-secret>
LILYBETA_SYNC_USER_IDS=<comma-separated-Supabase-user-UUIDs-allowed-to-sync>
LILYBETA_API_URL=https://beta.lilyhub.top
SUPABASE_URL=<Editor's-own-Supabase-project-URL>
SUPABASE_ANON_KEY=<Editor's-own-public-anon-key>
```

Editor can reuse its configured `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` server-side if unprefixed equivalents are absent. No LilyBeta `DATABASE_URL`, password, service-role key, or browser JWT is shared with Editor.

1. Back up production and apply LilyBeta migrations using the current deployment process: PostgreSQL `002_editor_sync.sql`, SQLite `007_editor_sync.sql` for local/test only. Existing migration runner tracks versions; do not apply both dialects to one DB.
2. Verify manual upload → assign → edit → complete → review → approve first. New PostgreSQL tables have RLS enabled without client policies; runtime server DB role must own/bypass these policies as configured for existing server access.
3. Deploy both repositories; configure matching secret, active Beta admin ID and narrow Editor user allowlist. Vercel functions should allow enough time for a 25-chapter batch (upstream request deadline 30 seconds; browser 45 seconds). Plain `vite` only runs the frontend, not Vercel `/api` functions; use the existing Vercel development environment for integrated local application use.
4. Send one test chapter, retry it, send a second batch, then test conflict on an assigned chapter.
5. To disable new syncing, remove/rotate integration secret or clear Editor allowlist. Do not drop mappings to roll back: they are needed for stable identity when re-enabled. Imported books remain usable by the old Beta workflow.

No secrets were generated for production, no production database was mutated, and no deployment was performed as part of local implementation.

## Verification

```sh
# LilyBeta: old suites first, then sync on SQLite and embedded PostgreSQL
NODE_ENV=test DATABASE_PROVIDER=sqlite npm test
npm run build
# Optional local round trip through the actual Editor bridge implementation
EDITOR_SYNC_TEST_CHECKOUT=/absolute/path/to/Editor npm run test:sync
EDITOR_SYNC_TEST_CHECKOUT=/absolute/path/to/Editor npm run test:sync:postgres
# Editor
npm run test:sync
npm run build
```

- Existing regression suites pass after additive migrations.
- New tests parse an actual TXT file, use the unchanged manual upload API, assign/read/edit/complete/review/approve, then run the same workflow on Editor-created books.
- Sync tests cover 20+10 incremental chapters, idempotency/concurrent first sync, hashes, title cache version, stale versions, invalid batches, rollback on cross-book identity collisions, sparse current chapters, reordering, unchanged manual data, persistent conflicts, append after approval, and RLS for new tables.
- The same suite runs against SQLite and PGlite's embedded PostgreSQL engine with production SQL migrations applied twice. This validates SQL/JSONB/boolean/timestamp behavior; it does **not** validate hosted Supabase networking/pooling or multi-process Vercel concurrency. Live PostgreSQL deployment testing remains a rollout requirement.
- Editor bridge tests cover user authentication, allowlist, ownership, no raw-source fallback, scoped UUIDs, checkpoints and non-disclosure of secrets.
- Browser QA uses `tests/sync-preview.js` with synthetic Editor identity/source and a real local LilyBeta API: current 1/1, changed 25/29 then simulated network failure, retry remaining 4/4, changed 0/0, whole 30/30. Verified one Beta book / 30 distinct target chapter IDs. The harness is opt-in, loopback-only, and not imported by production.
