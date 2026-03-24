-- Migration 007: Create contact_interactions table
-- CRM: unified interaction timeline across all contact types

CREATE TABLE IF NOT EXISTS contact_interactions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Who this interaction is about
  contact_type         TEXT NOT NULL CHECK (contact_type IN ('volunteer','director','subscriber')),
  contact_id           INTEGER NOT NULL,

  -- What happened
  interaction_type     TEXT NOT NULL CHECK (
                         interaction_type IN (
                           'email','meeting','phone','note',
                           'sms','form_submit','event_rsvp','system'
                         )
                       ),
  subject              TEXT NOT NULL,
  body                 TEXT,
  channel              TEXT NOT NULL DEFAULT 'manual' CHECK (
                         channel IN (
                           'manual','gmail','website_form',
                           'event_system','sms_gateway','other'
                         )
                       ),
  direction            TEXT NOT NULL DEFAULT 'internal' CHECK (
                         direction IN ('inbound','outbound','internal')
                       ),

  -- Context / linking
  related_program_id   INTEGER,
  related_event_id     INTEGER,
  staff_user_id        INTEGER,

  -- Metadata
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast contact timeline lookups
CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact
  ON contact_interactions (contact_type, contact_id, created_at);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_type_date
  ON contact_interactions (interaction_type, created_at);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_event
  ON contact_interactions (related_event_id)
  WHERE related_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_interactions_program
  ON contact_interactions (related_program_id)
  WHERE related_program_id IS NOT NULL;
