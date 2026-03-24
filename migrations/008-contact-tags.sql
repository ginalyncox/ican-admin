-- Migration 008: Create contact_tags and contact_tag_assignments tables
-- CRM: flexible tagging system for all contact types
-- Column names match routes/crm.js exactly

-- ── contact_tags ─────────────────────────────────────────────
-- Defines available tags (label + display color)
CREATE TABLE IF NOT EXISTS contact_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_name   TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#5E6B52',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── contact_tag_assignments ───────────────────────────────────
-- Maps tags to contacts (polymorphic via contact_type + contact_id)
CREATE TABLE IF NOT EXISTS contact_tag_assignments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('volunteer','director','subscriber')),
  contact_id   INTEGER NOT NULL,
  tag_id       INTEGER NOT NULL REFERENCES contact_tags(id) ON DELETE CASCADE,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (contact_type, contact_id, tag_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tag_assignments_contact
  ON contact_tag_assignments (contact_type, contact_id);

CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag
  ON contact_tag_assignments (tag_id);

-- ── Starter tags ─────────────────────────────────────────────
INSERT OR IGNORE INTO contact_tags (tag_name, color) VALUES
  ('Active',       '#4CAF50'),
  ('At-Risk',      '#F44336'),
  ('New',          '#2196F3'),
  ('Leadership',   '#9C27B0'),
  ('Newsletter',   '#FF9800'),
  ('Seed Library', '#795548'),
  ('Volunteer',    '#009688'),
  ('Board',        '#3F51B5');
