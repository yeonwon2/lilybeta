-- Additive: manual books need no mapping and no backfill.
CREATE TABLE editor_book_links (
  id TEXT PRIMARY KEY,
  editor_source TEXT NOT NULL,
  editor_book_id TEXT NOT NULL,
  beta_book_id TEXT NOT NULL UNIQUE REFERENCES beta_books(id) ON DELETE CASCADE,
  source_total_chapters INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'PARTIAL' CHECK(sync_state IN ('PARTIAL', 'SYNCED', 'CONFLICT')),
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(editor_source, editor_book_id)
);
CREATE TABLE editor_chapter_links (
  id TEXT PRIMARY KEY,
  book_link_id TEXT NOT NULL REFERENCES editor_book_links(id) ON DELETE CASCADE,
  editor_source TEXT NOT NULL,
  editor_chapter_id TEXT NOT NULL,
  beta_chapter_id TEXT NOT NULL UNIQUE REFERENCES beta_chapters(id) ON DELETE CASCADE,
  source_chapter_index INTEGER NOT NULL CHECK(source_chapter_index > 0),
  last_editor_version TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'SYNCED' CHECK(last_sync_status IN ('SYNCED', 'SOURCE_CONFLICT', 'SOURCE_VERSION_CONFLICT')),
  last_editor_hash TEXT NOT NULL,
  last_editor_updated_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  UNIQUE(editor_source, editor_chapter_id)
);
CREATE INDEX idx_editor_chapters_book ON editor_chapter_links(book_link_id);
