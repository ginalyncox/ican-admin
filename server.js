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
