-- Document acknowledgment tracking for both volunteers and board members
-- Records when a user downloads/reviews and checks "I acknowledge receipt"

CREATE TABLE IF NOT EXISTS document_acknowledgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES board_documents(id),
  user_type TEXT NOT NULL CHECK(user_type IN ('volunteer', 'director')),
  user_id INTEGER NOT NULL,  -- gardener_id for volunteers, board_member_id for directors
  acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  UNIQUE(document_id, user_type, user_id)
);

-- Add documents_acknowledged flag to member_credentials for volunteer onboarding
ALTER TABLE member_credentials ADD COLUMN documents_acknowledged INTEGER DEFAULT 0;

-- Add documents_acknowledged flag to board_members for director onboarding
ALTER TABLE board_members ADD COLUMN documents_acknowledged INTEGER DEFAULT 0;
