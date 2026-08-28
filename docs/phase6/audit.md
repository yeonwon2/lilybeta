> Superseded: yêu cầu mới dùng xuất TXT/DOCX/PDF ở LilyBeta, giữ nguyên importer LilyHub. Không triển khai direct publish hay ZIP pipeline. Xem [quyết định mới](../approved-file-export.md).

# Phase 6 pre-implementation audit — 2026-08-28

## Status and scope decision

**PHASE 6 BLOCKED — acceptance/scope decision required.** This is an audit, not an implemented publish pipeline. No publishing endpoint, migration, credentials or production write has been introduced. Only read-only production schema queries were executed. Source checkouts are isolated on `codex/phase6-publish`; existing local untracked files were preserved.

LilyHub's unmodified latest source fails its existing full-project typecheck: **246 diagnostics in 50 files** after a fresh dependency installation. This intersects Reader/Auth, forms and shared UI outside the requested publish pipeline. The request simultaneously requires whole-project typecheck PASS and prohibits unrelated refactoring. Approval is needed to extend scope to fix baseline errors, or explicitly accept the documented pre-existing baseline while requiring no new errors in Phase 6. Neither approval has been assumed. The feature implementation and all Phase 6 E2E cases remain pending; no completion claim is made.

## Source of truth

- LilyBeta `yeonwon2/lilybeta`: `a83ef73c2e243f1b0809657a96ec94640b762f66`.
- LilyHub `yeonwon237/GEMINI-LILYHUB`: `b170ec2d69db96a6b49df93fbe5b2112adca04e9`.
- Both remotes fetched before audit. LilyHub latest changes revert Worker-based shared content caching and remove a reader snapshot waterfall; do not reinstate reverted behavior accidentally.
- Actual LilyHub Supabase project confirmed in authenticated dashboard: `vnchwolfbckhhherrzjk`, organization `Supabase`, linked repo `yeonwon237/GEMINI-LILYHUB`. Editor uses a different project (`xerwnjdijzkxskugyuiv`).
- README still describes Base44, but active publishing is browser Supabase + Cloudflare Worker/R2. No new Base44 backend should be inferred from README alone.

## Actual production schema (read-only information_schema/pg_indexes)

`novels.id` and `chapters.id` are **TEXT**, NOT UUID columns. Both primary keys are unique; the chapter `(novel_id, chapter_number)` index is **non-unique**. Do not add a global uniqueness constraint blindly or map by title/chapter number.

`chapters`: id text NOT NULL; novel_id text nullable; chapter_number numeric nullable; title/content text nullable; word_count numeric default 0; views text default '0'; votes bigint NOT NULL default 0; content_key text nullable; hot boolean NOT NULL default false; created_at/updated_at/created_date/updated_date timestamptz default now().

`novels`: id text NOT NULL; title/author/translator/category/status/cover_url/description text nullable; tags jsonb default []; views/votes text default '0'; rating text default '5.0'; status default 'Đang cập nhật'; chapter_count bigint NOT NULL default 0; created_at/updated_at/created_date/updated_date timestamptz default now().

There is no initial novels/chapters CREATE TABLE migration in the repository. The above was verified against production, not guessed from frontend sanitizers. Remaining schema audit before implementation: installed trigger definitions, policies and foreign keys, plus duplicate/noncanonical chapter-number checks, without fetching manuscripts.

## Existing LilyHub publish/write semantics

Relevant paths:

- `src/components/admin/NovelForm.jsx`: manual create/update through `base44.entities.Novel` with strict persistence.
- `src/components/admin/ChapterForm.jsx`: single publish/update; optional announcement; new chapter sets novel `has_new_chapter`.
- `src/components/admin/MultiChapterDraft.jsx` and `chapterPublishing.js`: batch operations, 10 concurrent records/chunk, per-chapter results.
- `src/api/base44Client.js`: Supabase-backed entity adapter, sanitizers/normalizers and local query invalidation. The name does not imply Base44 hosts the active data.
- `cloudflare/lilyhub-worker/worker.js`: admin-authenticated R2 writes, anonymous proxy cache, reader/auth/comments routes.

Chapter write is **R2-first → Supabase metadata pointer → snapshot notification**. New content is plain text at `chapters/{uuid}.txt`. Updates retain the chapter ID but generate a **new content_key** before moving the metadata pointer. Previous object cleanup is best-effort after DB success. Counters/hot fields must not be overwritten by source publishing. `chapters.content` is legacy storage, not the content write destination.

Novel count is maintained by `chapters_sync_novel_count` (migration `20260804_novel_chapter_count.sql`), not frontend recount/download of all chapter bodies. Novel metadata such as slug, genre, has_new_chapter and audio_parts is encoded in `description` as `<!--META:...-->`; overwriting this field carelessly loses unrelated metadata. New publishing must reuse/extract narrow pure business helpers where safe and preserve this representation.

Manual edit/delete paths and optional notifications must remain intact. Linking a pre-existing book must never silently adopt/overwrite an occupied chapter number. UI needs an explicit target order/chapter mapping policy, not an inferred title match.

## Cache audit

- Chapter R2 keys are immutable on update. Reader fetches from public `media.lilyhub.top`, with Worker fallback. Existing reader comments mention old TTLs; actual Worker headers are authoritative.
- Anonymous REST proxy caches per URL for 300 seconds at edge and 30 seconds in browser; authenticated requests bypass shared cache.
- `snapshot.js` builds novels (up to 50 metadata rows) and roleplay-games snapshots, with a short-lived pointer to immutable R2 blobs.
- Manual entity writes currently schedule `regenerateAllSnapshots`; new integration must not rebuild unrelated games. Reuse `regenerateSnapshot(env, 'novels')` only where book metadata/count changes, coalescing batches.
- Changing an R2 content key alone does not invalidate already-cached chapter metadata/navigation URLs. A scoped invalidation/version mechanism must be designed and verified; per-data-center cache.delete is not proof of global invalidation. Do not reintroduce the recently reverted whole-reader waterfall, purge the whole site, or change unrelated cache policy.

## Approved source audit (LilyBeta)

`approveChapter` persists `beta_chapter_reviews.approved_edits_snapshot` and increments `review_snapshot_version` per review/assignment. Snapshot entries pin accepted afterText and offsets.

**Do not use `getApprovedChapterVersion` as the publishing source.** It currently reconstructs from live edit-review rows and defaults to one active assignment; it does not consume the stored approval snapshot. Existing UI/API behavior remains unchanged. New publish logic must explicitly identify the approved review/assignment, require APPROVED, reconstruct only from the saved snapshot, validate anchors/base content, and persist an immutable payload/hash before remote I/O. Multiple reader assignments must never be combined implicitly.

A publish operation must pin review ID + snapshot version + canonical hash + target mapping. Reapproval/reopen cannot silently publish newer live edits. A failed/timeout response must reconcile the exact operation, not send a different version with the same idempotency key.

## Proposed implementation boundaries (not implemented)

1. Add optional book/chapter mapping and publish-operation tables on both sides; existing manual rows require no mapping/backfill.
2. LilyBeta Admin-only APIs for link/create, lightweight readiness/status, and bounded selected/ready publish. Beta Readers must get 403.
3. LilyHub dedicated Worker integration route with a server-only scoped credential, strict operation validation, body limit and persistent concurrency/idempotency controls. LilyBeta receives no DB/R2 credential.
4. Receiver uses a recoverable R2/DB operation protocol: immutable content key, transactional metadata/mapping/idempotency result, safe retries across response loss, compare-and-swap against intervening LilyHub manual edits. Do not delete potentially committed R2 content on ambiguous DB timeouts.
5. Per-chapter states/results and explicit outdated-version update; batch confirmation and retry only failed/pending operations. No automatic public overwrite after reapproval.
6. Existing-book mapping must preserve 150 existing chapters; define append/target-number selection explicitly. UUID-like strings remain opaque TEXT IDs.
7. Durable audit records include triggering Admin, approved review/version/hash, target IDs and sanitized errors.

## Baseline verification

| Check | LilyBeta | LilyHub |
|---|---|---|
| Current source fetched | PASS | PASS |
| Build | PASS (`npm run build`, includes TypeScript) | PASS (`npm run build`) |
| Existing test suite | PASS (`npm test`, includes manual workflow, Editor sync SQLite/PGlite and mobile tests) | PASS (7 tests: Han-Viet utilities + chapter cleaner) |
| Lint | No script | PASS (`npm run lint`) |
| Full typecheck | PASS through build | **FAIL: 246 diagnostics / 50 files** (`npm run typecheck`) |
| Phase 6 integration/E2E A–H | NOT IMPLEMENTED / NOT RUN | NOT IMPLEMENTED / NOT RUN |
| Live manual Reader/comments/likes/auth regression | NOT RUN this phase | NOT RUN this phase |

LilyHub initially lacked jszip in reused local dependencies. That environment-only build failure was resolved by a fresh install in the isolated worktree; the final build PASS above is from that installation. Do not confuse it with the persistent typecheck failure. `docs/phase6/lilyhub-typecheck-baseline.txt` retains the exact final diagnostics. Examples: Register.jsx 18, SettingsForm.jsx 17, Reader.jsx 16, select.jsx 12, form.jsx 10. Tests are narrow; seven passing unit tests do not establish full LilyHub backward compatibility.

## Performance and delivery inventory

No publish endpoint exists yet, so query counts/payload sizes/N+1/E2E performance are **not measured**. Planned measurement must instrument actual requests and DB calls for one chapter and partial-failure batches, including storage and scoped snapshot work. No full-book body download is acceptable.

This delivery changes documentation only. No migration, endpoint, env variable, production secret, worker deployment, public chapter or data migration was added. Secret generation/configuration instructions will be finalized with the implemented auth contract, not prematurely applied to production. Commit identifiers for this audit are supplied in the handoff response.

Required decision: permission to fix pre-existing full-project typecheck issues outside the publish scope, or an explicit adjusted acceptance gate for unchanged baseline errors. Until that decision and subsequent implementation/tests, the only valid status is **PHASE 6 BLOCKED**.
