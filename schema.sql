CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('admin', 'editor', 'viewer')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  category TEXT CHECK(category IN ('announcement', 'legislative', 'victory-garden', 'community', 'opinion')),
  featured_image TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
  author_id INTEGER REFERENCES users(id),
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_type TEXT NOT NULL CHECK(form_type IN ('newsletter', 'contact', 'volunteer', 'board_application')),
  data TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'website' CHECK(source IN ('website', 'manual', 'import', 'volunteer')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'unsubscribed')),
  subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id)
);

-- Victory Garden: Contest Seasons
CREATE TABLE IF NOT EXISTS garden_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'active', 'completed')),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Victory Garden: Sites (community gardens, partner locations)
CREATE TABLE IF NOT EXISTS garden_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  partner TEXT,
  total_plots INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Victory Garden: Gardeners (volunteers)
CREATE TABLE IF NOT EXISTS gardeners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  site_id INTEGER REFERENCES garden_sites(id),
  plot_number TEXT,
  season_id INTEGER REFERENCES garden_seasons(id),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'waitlist')),
  joined_date DATE DEFAULT (date('now')),
  notes TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  date_of_birth DATE,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  tshirt_size TEXT,
  how_heard TEXT,
  skills TEXT,
  availability TEXT,
  background_check_consent INTEGER DEFAULT 0,
  photo_release_consent INTEGER DEFAULT 0,
  liability_waiver_signed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Victory Garden: Harvest Logs (with donation verification)
CREATE TABLE IF NOT EXISTS garden_harvests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gardener_id INTEGER REFERENCES gardeners(id) ON DELETE CASCADE,
  season_id INTEGER REFERENCES garden_seasons(id),
  harvest_date DATE NOT NULL,
  crop TEXT NOT NULL,
  pounds REAL NOT NULL DEFAULT 0,
  donated INTEGER DEFAULT 1,
  donated_to TEXT,
  donation_status TEXT DEFAULT 'pending' CHECK(donation_status IN ('pending', 'verified', 'flagged')),
  verified_by INTEGER REFERENCES users(id),
  verified_at DATETIME,
  flag_reason TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Victory Garden: Volunteer Hours
CREATE TABLE IF NOT EXISTS garden_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gardener_id INTEGER REFERENCES gardeners(id) ON DELETE CASCADE,
  season_id INTEGER REFERENCES garden_seasons(id),
  program TEXT DEFAULT 'victory_garden' CHECK(program IN ('victory_garden', 'legislative', 'outreach', 'fundraising', 'communications', 'membership')),
  work_date DATE NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  activity TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Victory Garden: Member Credentials (for gardener self-service portal)
CREATE TABLE IF NOT EXISTS member_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gardener_id INTEGER UNIQUE REFERENCES gardeners(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER DEFAULT 1,
  onboarding_completed INTEGER DEFAULT 0,
  onboarding_completed_at DATETIME,
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Victory Garden: Awards
CREATE TABLE IF NOT EXISTS garden_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER REFERENCES garden_seasons(id),
  gardener_id INTEGER REFERENCES gardeners(id),
  award_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('harvest', 'volunteer', 'community', 'innovation', 'overall')),
  description TEXT,
  presented_at DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Victory Garden: Harvest Photos
CREATE TABLE IF NOT EXISTS harvest_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harvest_id INTEGER REFERENCES garden_harvests(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Newsletter Sends
CREATE TABLE IF NOT EXISTS newsletter_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient_count INTEGER DEFAULT 0,
  sent_by INTEGER REFERENCES users(id),
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Board of Directors ─────────────────────────────────────

-- Board Members (directors with portal access)
CREATE TABLE IF NOT EXISTS board_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  title TEXT DEFAULT 'Director',
  phone TEXT,
  bio TEXT,
  term_start DATE,
  term_end DATE,
  is_officer INTEGER DEFAULT 0,
  officer_title TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'emeritus', 'locked')),
  locked_at DATETIME,
  locked_reason TEXT,
  must_change_password INTEGER DEFAULT 1,
  onboarding_completed INTEGER DEFAULT 0,
  onboarding_completed_at DATETIME,
  officer_rank INTEGER DEFAULT 99,
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Board Meetings
CREATE TABLE IF NOT EXISTS board_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  meeting_time TEXT,
  location TEXT,
  meeting_type TEXT DEFAULT 'regular' CHECK(meeting_type IN ('regular', 'special', 'annual', 'committee', 'emergency')),
  status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  agenda TEXT,
  minutes TEXT,
  minutes_approved INTEGER DEFAULT 0,
  minutes_approved_date DATE,
  quorum_present INTEGER DEFAULT 0,
  attendees TEXT,
  created_by INTEGER REFERENCES board_members(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Board Documents (shared document repository)
CREATE TABLE IF NOT EXISTS board_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general' CHECK(category IN ('general', 'bylaws', 'policy', 'financial', 'legal', 'minutes', 'resolution', 'report', 'compliance')),
  filename TEXT NOT NULL,
  original_name TEXT,
  file_size INTEGER DEFAULT 0,
  uploaded_by INTEGER REFERENCES board_members(id),
  is_confidential INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Board Votes (motions & resolutions)
CREATE TABLE IF NOT EXISTS board_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER REFERENCES board_meetings(id),
  motion_title TEXT NOT NULL,
  motion_text TEXT NOT NULL,
  motion_type TEXT DEFAULT 'resolution' CHECK(motion_type IN ('resolution', 'policy', 'budget', 'appointment', 'amendment', 'other')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'open', 'passed', 'failed', 'tabled', 'withdrawn')),
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  votes_abstain INTEGER DEFAULT 0,
  result_notes TEXT,
  introduced_by INTEGER REFERENCES board_members(id),
  voted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Individual Vote Records
CREATE TABLE IF NOT EXISTS board_vote_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vote_id INTEGER REFERENCES board_votes(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES board_members(id),
  vote TEXT NOT NULL CHECK(vote IN ('for', 'against', 'abstain', 'absent')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vote_id, member_id)
);

-- Conflict of Interest Disclosures
CREATE TABLE IF NOT EXISTS coi_disclosures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER REFERENCES board_members(id),
  disclosure_year INTEGER NOT NULL,
  has_conflict INTEGER DEFAULT 0,
  description TEXT,
  organization TEXT,
  nature_of_interest TEXT,
  mitigation_plan TEXT,
  status TEXT DEFAULT 'submitted' CHECK(status IN ('submitted', 'reviewed', 'acknowledged')),
  reviewed_by INTEGER REFERENCES board_members(id),
  reviewed_at DATETIME,
  signed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Board Meeting Attendance
CREATE TABLE IF NOT EXISTS board_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER REFERENCES board_meetings(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES board_members(id),
  status TEXT DEFAULT 'present' CHECK(status IN ('present', 'absent', 'excused', 'remote')),
  arrived_at TEXT,
  left_at TEXT,
  UNIQUE(meeting_id, member_id)
);

-- Volunteer Program Assignments
CREATE TABLE IF NOT EXISTS volunteer_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volunteer_id INTEGER REFERENCES gardeners(id) ON DELETE CASCADE,
  program TEXT NOT NULL CHECK(program IN ('victory_garden', 'legislative', 'outreach', 'fundraising', 'communications', 'membership')),
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  assigned_by INTEGER REFERENCES users(id),
  UNIQUE(volunteer_id, program)
);

-- Program Applications (volunteer requests to join programs)
CREATE TABLE IF NOT EXISTS program_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volunteer_id INTEGER NOT NULL REFERENCES gardeners(id) ON DELETE CASCADE,
  program TEXT NOT NULL CHECK(program IN ('victory_garden', 'legislative', 'outreach', 'fundraising', 'communications', 'membership')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
  note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(volunteer_id, program, status)
);

-- Internal Member Messages
CREATE TABLE IF NOT EXISTS member_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_type TEXT DEFAULT 'general' CHECK(message_type IN ('general', 'newsletter', 'announcement', 'program_update')),
  target_program TEXT,
  sent_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Member Message Read Receipts
CREATE TABLE IF NOT EXISTS member_message_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES member_messages(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES member_credentials(id) ON DELETE CASCADE,
  read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, member_id)
);

-- Admin Activity Log
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  entity_label TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Volunteer Notes (staff notes on individual volunteers)
CREATE TABLE IF NOT EXISTS volunteer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  volunteer_id INTEGER NOT NULL REFERENCES gardeners(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id),
  author_name TEXT,
  note TEXT NOT NULL,
  note_type TEXT DEFAULT 'general' CHECK(note_type IN ('general', 'phone_call', 'email', 'meeting', 'issue', 'follow_up')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Meeting RSVP (director responses to upcoming meetings)
CREATE TABLE IF NOT EXISTS meeting_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES board_meetings(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES board_members(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK(response IN ('attending', 'remote', 'declined', 'tentative')),
  note TEXT,
  responded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(meeting_id, member_id)
);

-- Events
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  event_date DATE NOT NULL,
  event_time TEXT,
  end_time TEXT,
  event_type TEXT DEFAULT 'general' CHECK(event_type IN ('general', 'meeting', 'garden', 'legislative', 'fundraiser', 'social')),
  is_public INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Board Announcements / Discussion
CREATE TABLE IF NOT EXISTS board_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK(priority IN ('normal', 'important', 'urgent')),
  pinned INTEGER DEFAULT 0,
  author_id INTEGER REFERENCES board_members(id),
  author_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Board Announcement Read Receipts
CREATE TABLE IF NOT EXISTS board_announcement_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER REFERENCES board_announcements(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES board_members(id) ON DELETE CASCADE,
  read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(announcement_id, member_id)
);

-- Action Items (tasks assigned to board members)
CREATE TABLE IF NOT EXISTS board_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to INTEGER REFERENCES board_members(id),
  assigned_to_name TEXT,
  meeting_id INTEGER REFERENCES board_meetings(id),
  due_date DATE,
  priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'completed', 'cancelled')),
  completed_at DATETIME,
  created_by INTEGER REFERENCES board_members(id),
  created_by_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Meeting Agenda Items (structured agendas)
CREATE TABLE IF NOT EXISTS board_agenda_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES board_meetings(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  presenter TEXT,
  duration_minutes INTEGER,
  item_type TEXT DEFAULT 'discussion' CHECK(item_type IN ('call_to_order', 'roll_call', 'approval', 'report', 'discussion', 'action', 'vote', 'executive_session', 'adjournment', 'other')),
  attachment_id INTEGER REFERENCES board_documents(id),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Polls / Surveys (informal feedback)
CREATE TABLE IF NOT EXISTS board_polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  description TEXT,
  poll_type TEXT DEFAULT 'single' CHECK(poll_type IN ('single', 'multiple', 'yes_no')),
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  anonymous INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES board_members(id),
  created_by_name TEXT,
  closes_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Poll Options
CREATE TABLE IF NOT EXISTS board_poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES board_polls(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Poll Responses
CREATE TABLE IF NOT EXISTS board_poll_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES board_polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES board_poll_options(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES board_members(id),
  responded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(poll_id, option_id, member_id)
);

-- Resource Center Items
CREATE TABLE IF NOT EXISTS board_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general' CHECK(category IN ('governance', 'training', 'legal', 'financial', 'compliance', 'reference', 'template', 'general')),
  resource_type TEXT DEFAULT 'link' CHECK(resource_type IN ('link', 'document', 'video', 'guide')),
  url TEXT,
  document_id INTEGER REFERENCES board_documents(id),
  pinned INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES board_members(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Committee Assignments
CREATE TABLE IF NOT EXISTS board_committees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  chair_id INTEGER REFERENCES board_members(id),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS board_committee_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id INTEGER NOT NULL REFERENCES board_committees(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES board_members(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK(role IN ('chair', 'vice_chair', 'member')),
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(committee_id, member_id)
);

-- Document Acknowledgment Tracking
CREATE TABLE IF NOT EXISTS document_acknowledgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES board_documents(id),
  user_type TEXT NOT NULL CHECK(user_type IN ('volunteer', 'director')),
  user_id INTEGER NOT NULL,
  acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  UNIQUE(document_id, user_type, user_id)
);
