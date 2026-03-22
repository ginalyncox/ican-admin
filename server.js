const express = require('express');
const session = require('express-session');
const BetterSqliteStore = require('./lib/session-store');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy in production (Render)
if (isProd) app.set('trust proxy', 1);

// Security headers (CSP disabled — inline styles/scripts used throughout)
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiting for login endpoints — 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

// Database setup — persistent disk on Render Starter, local file for dev
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'ican.db');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);
console.log('Database initialized at', dbPath);

// Migrations for upgrading existing databases — new installs get these via schema.sql
try {
  db.exec(`ALTER TABLE board_members ADD COLUMN locked_at DATETIME`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE board_members ADD COLUMN locked_reason TEXT`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE board_members ADD COLUMN must_change_password INTEGER DEFAULT 1`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE board_members ADD COLUMN onboarding_completed INTEGER DEFAULT 0`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE board_members ADD COLUMN onboarding_completed_at DATETIME`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE member_credentials ADD COLUMN must_change_password INTEGER DEFAULT 1`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE member_credentials ADD COLUMN onboarding_completed INTEGER DEFAULT 0`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE member_credentials ADD COLUMN onboarding_completed_at DATETIME`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE board_members ADD COLUMN officer_rank INTEGER DEFAULT 99`);
} catch (e) { /* column already exists */ }

// Migrations — gardener volunteer profile columns
const gardenerCols = [
  ['address', 'TEXT'], ['city', 'TEXT'], ['state', 'TEXT'], ['zip', 'TEXT'],
  ['date_of_birth', 'DATE'], ['emergency_contact_name', 'TEXT'], ['emergency_contact_phone', 'TEXT'],
  ['tshirt_size', 'TEXT'], ['how_heard', 'TEXT'], ['skills', 'TEXT'], ['availability', 'TEXT'],
  ['background_check_consent', 'INTEGER DEFAULT 0'], ['photo_release_consent', 'INTEGER DEFAULT 0'],
  ['liability_waiver_signed', 'INTEGER DEFAULT 0']
];
for (const [col, type] of gardenerCols) {
  try { db.exec(`ALTER TABLE gardeners ADD COLUMN ${col} ${type}`); } catch (e) { /* exists */ }
}

// Migration — add program column to garden_hours for universal hour logging
try {
  db.exec(`ALTER TABLE garden_hours ADD COLUMN program TEXT DEFAULT 'victory_garden'`);
} catch (e) { /* column already exists */ }

// Migration — document acknowledgment tracking
try { db.exec(`ALTER TABLE member_credentials ADD COLUMN documents_acknowledged INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE board_members ADD COLUMN documents_acknowledged INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
db.exec(`CREATE TABLE IF NOT EXISTS document_acknowledgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES board_documents(id),
  user_type TEXT NOT NULL CHECK(user_type IN ('volunteer', 'director')),
  user_id INTEGER NOT NULL,
  acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  UNIQUE(document_id, user_type, user_id)
)`);

// Migration — event RSVP tracking
db.exec(`CREATE TABLE IF NOT EXISTS event_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  gardener_id INTEGER NOT NULL REFERENCES gardeners(id),
  status TEXT NOT NULL DEFAULT 'going' CHECK(status IN ('going', 'interested')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, gardener_id)
)`);

// Migration — performance indexes
const indexSql = fs.readFileSync(path.join(__dirname, 'migrations', '006-indexes.sql'), 'utf8');
db.exec(indexSql);

try { db.exec(`ALTER TABLE board_votes ADD COLUMN resolution_number TEXT`); } catch (e) { /* exists */ }


// ── Migration: Document Library enhancements ──────────────
// Audience tagging: who can see each document
try { db.exec(`ALTER TABLE board_documents ADD COLUMN audience TEXT DEFAULT 'all'`); } catch (e) { /* exists */ }
// 'all' = everyone, 'volunteer' = volunteers only, 'director' = directors only, 'admin' = admin only

// Is this document required (must be acknowledged)?
try { db.exec(`ALTER TABLE board_documents ADD COLUMN is_required INTEGER DEFAULT 0`); } catch (e) { /* exists */ }

// Re-acknowledgment: when set, all previous acks are invalidated
try { db.exec(`ALTER TABLE board_documents ADD COLUMN ack_required_after DATETIME`); } catch (e) { /* exists */ }

// Version tracking
try { db.exec(`ALTER TABLE board_documents ADD COLUMN version INTEGER DEFAULT 1`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE board_documents ADD COLUMN version_notes TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE board_documents ADD COLUMN previous_version_id INTEGER`); } catch (e) { /* exists */ }

// Document type: document vs form
try { db.exec(`ALTER TABLE board_documents ADD COLUMN doc_type TEXT DEFAULT 'document'`); } catch (e) { /* exists */ }
// 'document' = informational, 'form' = fillable form, 'template' = template, 'policy' = policy/procedure

// Sort order for library display
try { db.exec(`ALTER TABLE board_documents ADD COLUMN sort_order INTEGER DEFAULT 99`); } catch (e) { /* exists */ }

// Document version history table
db.exec(`CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES board_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  file_size INTEGER DEFAULT 0,
  version_notes TEXT,
  uploaded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Expand document_acknowledgments to include version info
try { db.exec(`ALTER TABLE document_acknowledgments ADD COLUMN document_version INTEGER DEFAULT 1`); } catch (e) { /* exists */ }

// Create index for faster ack lookups
db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_ack_lookup ON document_acknowledgments(document_id, user_type, user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_audience ON board_documents(audience)`);


// ── Migration: Signed Agreements tracking ─────────────────
db.exec(`CREATE TABLE IF NOT EXISTS signed_agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_type TEXT NOT NULL CHECK(agreement_type IN ('volunteer_service', 'board_commitment', 'media_release', 'liability_waiver')),
  user_type TEXT NOT NULL CHECK(user_type IN ('volunteer', 'director')),
  user_id INTEGER NOT NULL,
  user_name TEXT,
  user_email TEXT,
  signed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  agreement_version INTEGER DEFAULT 1,
  agreement_text TEXT,
  UNIQUE(agreement_type, user_type, user_id)
)`);
try { db.exec(`ALTER TABLE member_credentials ADD COLUMN agreement_signed INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE board_members ADD COLUMN agreement_signed INTEGER DEFAULT 0`); } catch (e) { /* exists */ }

// ── Migration: CRM tables ───────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS contact_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_type TEXT NOT NULL CHECK(contact_type IN ('volunteer', 'director', 'subscriber', 'lead')),
  contact_id INTEGER NOT NULL,
  interaction_type TEXT NOT NULL CHECK(interaction_type IN ('note', 'email', 'call', 'meeting', 'event', 'application', 'system')),
  title TEXT,
  body TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS contact_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#5E6B52'
)`);
db.exec(`CREATE TABLE IF NOT EXISTS contact_tag_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_type TEXT NOT NULL,
  contact_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES contact_tags(id) ON DELETE CASCADE,
  UNIQUE(contact_type, contact_id, tag_id)
)`);

// Seed default CRM tags
const defaultTags = [
  ['Active Volunteer', '#2D6A3F'], ['Board Member', '#6366f1'], ['Major Donor', '#B8862B'],
  ['Newsletter Subscriber', '#10b981'], ['Lapsed', '#ef4444'], ['VIP', '#8b5cf6'],
  ['Prospect', '#f59e0b'], ['Legislative Contact', '#3b82f6']
];
const insertTag = db.prepare("INSERT OR IGNORE INTO contact_tags (tag_name, color) VALUES (?, ?)");
for (const [name, color] of defaultTags) insertTag.run(name, color);

// ── Migration: Retention & Renewal tracking ─────────────────
db.exec(`CREATE TABLE IF NOT EXISTS renewal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK(item_type IN ('agreement', 'coi', 'background_check', 'policy_review', 'certification')),
  related_type TEXT NOT NULL CHECK(related_type IN ('volunteer', 'director', 'organization')),
  related_id INTEGER,
  title TEXT NOT NULL,
  last_completed DATETIME,
  expires_at DATETIME,
  renewal_interval_days INTEGER DEFAULT 365,
  status TEXT DEFAULT 'current' CHECK(status IN ('current', 'due_soon', 'overdue', 'expired')),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec(`ALTER TABLE signed_agreements ADD COLUMN expires_at DATETIME`); } catch(e) {}

// Seed default renewal items (Gina's agreements + org-wide)
{
  const existing = db.prepare("SELECT COUNT(*) as c FROM renewal_items").get().c;
  if (existing === 0) {
    const gina = db.prepare("SELECT id FROM board_members WHERE email = 'hello@iowacannabisaction.org'").get();
    const ginaId = gina ? gina.id : null;
    const seedItems = [
      ['agreement', 'director', ginaId, "Gina's Volunteer Agreement", '2027-03-21', 365],
      ['agreement', 'director', ginaId, "Gina's Board Commitment", '2027-03-21', 365],
      ['coi', 'organization', null, 'Annual COI Disclosure Reminder', '2027-01-01', 365],
      ['policy_review', 'organization', null, 'Bylaws Review', '2028-03-21', 730]
    ];
    const ins = db.prepare("INSERT INTO renewal_items (item_type, related_type, related_id, title, last_completed, expires_at, renewal_interval_days, status) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'current')");
    for (const [type, rType, rId, title, exp, interval] of seedItems) {
      ins.run(type, rType, rId, title, exp, interval);
    }
  }
}

// ── Migration: Site Settings ────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Seed default site settings
{
  const defaultSettings = [
    ['org_name', 'Iowa Cannabis Action Network'],
    ['org_legal_name', 'Iowa Cannabis Action Network, Inc.'],
    ['org_email', 'hello@iowacannabisaction.org'],
    ['org_phone', ''],
    ['org_address', ''],
    ['org_ein', '41-2746368'],
    ['org_website', 'https://iowacannabisaction.org'],
    ['org_facebook', 'https://facebook.com/61584583045381'],
    ['org_mission', 'Advancing cannabis policy reform, education, and community programs in Iowa.'],
    ['org_tagline', 'Cultivating Change Across Iowa'],
    ['web3forms_key', '5e7d5fb9-ab04-4c26-ac16-c3afea67cdf6'],
  ];
  const upsert = db.prepare("INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)");
  for (const [key, value] of defaultSettings) upsert.run(key, value);
}

// Seed default admin user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('changeme123', 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    'Gina Cox', 'hello@iowacannabisaction.org', hash, 'admin'
  );
  console.log('Default admin user created: hello@iowacannabisaction.org / changeme123');
}

// Make db available to routes
app.locals.db = db;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');
// app.set('layout extractScripts', true);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/admin/static', express.static(path.join(__dirname, 'public')));

// Uploads directory for photos
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Sessions
app.use(session({
  store: new BetterSqliteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'db')
  }),
  secret: process.env.SESSION_SECRET || 'ican-admin-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd
  }
}));

// Middleware
const { setLocals } = require('./middleware/auth');
app.use(setLocals);

// Flash messages via session
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// Apply rate limiting to all login POST routes
app.post('/admin/login', loginLimiter);
app.post('/member/login', loginLimiter);
app.post('/director/login', loginLimiter);

// Routes
app.use('/admin', require('./routes/auth'));
app.use('/admin', require('./routes/dashboard'));
app.use('/admin/posts', require('./routes/posts'));
app.use('/admin/submissions', require('./routes/submissions'));
app.use('/admin/subscribers', require('./routes/subscribers'));
app.use('/admin/pages', require('./routes/pages'));
app.use('/admin/garden', require('./routes/garden'));
app.use('/admin/settings', require('./routes/settings'));
app.use('/admin/newsletter', require('./routes/newsletter'));
app.use('/admin/events', require('./routes/events'));
app.use('/admin/board', require('./routes/board-admin'));
app.use('/admin/directory', require('./routes/directory'));
app.use('/admin/messages', require('./routes/messages'));
app.use('/admin/reports', require('./routes/reports'));
app.use('/admin/search', require('./routes/search'));
app.use('/admin/documents', require('./routes/doc-library'));
app.use('/admin/crm', require('./routes/crm'));
app.use('/admin/retention', require('./routes/retention'));
app.use('/admin/site', require('./routes/site-manager'));

// API endpoints at spec-defined paths
const { requireAuth } = require('./middleware/auth');

// Webhook endpoint - receives Web3Forms data (no auth required)
app.post('/admin/api/webhook', (req, res) => {
  const payload = req.body;

  let formType = payload.form_type || 'contact';
  if (formType === 'contact') {
    const subject = (payload.subject || '').toLowerCase();
    if (subject.includes('newsletter') || subject.includes('subscriber')) {
      formType = 'newsletter';
    } else if (subject.includes('volunteer')) {
      formType = 'volunteer';
    } else if (subject.includes('board') && subject.includes('application')) {
      formType = 'board_application';
    }
  }

  db.prepare('INSERT INTO submissions (form_type, data) VALUES (?, ?)').run(formType, JSON.stringify(payload));

  if (formType === 'newsletter' && payload.email) {
    try {
      db.prepare('INSERT OR IGNORE INTO subscribers (email, name, source) VALUES (?, ?, ?)').run(
        payload.email, payload.name || null, 'website'
      );
    } catch (e) { /* ignore duplicate */ }
  }

  res.json({ success: true });
});

// Public API: upcoming events (no auth — used by public website)
app.get('/api/events', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const events = db.prepare(`
    SELECT title, description, location, event_date, event_time, end_time, event_type
    FROM events WHERE is_public = 1 AND event_date >= date('now')
    ORDER BY event_date ASC LIMIT 20
  `).all();
  res.json(events);
});

// Public API: active board members (no auth — used by public website)
// Locked members are returned with is_locked=1 so the website shows their seat as vacant
app.get('/api/board', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const members = db.prepare(`
    SELECT first_name, last_name, title, officer_title, is_officer, bio, term_start, term_end,
      CASE WHEN status = 'locked' THEN 1 ELSE 0 END as is_locked
    FROM board_members
    WHERE status IN ('active', 'locked')
    ORDER BY officer_rank ASC, is_officer DESC, last_name ASC
  `).all();
  res.json(members);
});

// Subscriber CSV export
app.get('/admin/api/subscribers/export', requireAuth, (req, res) => {
  const subscribers = db.prepare('SELECT email, name, source, status, subscribed_at FROM subscribers ORDER BY subscribed_at DESC').all();

  let csv = 'Email,Name,Source,Status,Subscribed At\n';
  for (const s of subscribers) {
    const name = (s.name || '').replace(/"/g, '""');
    csv += `"${s.email}","${name}","${s.source}","${s.status}","${s.subscribed_at}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=ican-subscribers.csv');
  res.send(csv);
});

// Member portal
const { setMemberLocals } = require('./middleware/member-auth');
app.use('/member', setMemberLocals, require('./routes/member'));

// Director portal (Board of Directors)
const { setDirectorLocals } = require('./middleware/director-auth');
app.use('/director', setDirectorLocals, require('./routes/director'));

// Redirect root to admin
app.get('/', (req, res) => res.redirect('/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 Not Found',
    message: 'The page you are looking for does not exist.',
    user: res.locals.user,
    layout: false
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Server Error',
    message: 'Something went wrong. Please try again.',
    user: res.locals.user,
    layout: false
  });
});

app.listen(PORT, () => {
  console.log(`ICAN Admin running at http://localhost:${PORT}/admin`);
});
