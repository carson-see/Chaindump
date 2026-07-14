-- 0008_desk_proposals.sql — the research desk's durable, human-gated review queue.
-- The Phase G agent-desk writes proposals here (status='pending') via the Worker's
-- authenticated /api/desk/propose. A human reviews and promotes; nothing the desk
-- produces reaches the live tables without review (CLAUDE.md §1.5). Anything that
-- names an individual or asserts fraud is force-flagged needs_human_review=1.
CREATE TABLE IF NOT EXISTS desk_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset TEXT NOT NULL,              -- scam_intel | dead_chains | mid_chains | risk_signals | policy | desk_log
  slug TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  payload TEXT,                       -- JSON: proposed row fields
  sources TEXT,                       -- JSON: [{title,url}], each verified to resolve
  names_individuals INTEGER DEFAULT 0,
  confidence REAL,
  needs_human_review INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',      -- pending | approved | rejected | promoted
  reviewer_note TEXT,
  queued_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_desk_proposals_status ON desk_proposals(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_desk_proposals_dataset_slug ON desk_proposals(dataset, slug);
