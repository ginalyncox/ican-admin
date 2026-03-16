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
  form_type TEXT NOT NULL CHECK(form_type IN ('newsletter', 'contact', 'volunteer')),
  data TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'website' CHECK(source IN ('website', 'manual', 'import')),
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
