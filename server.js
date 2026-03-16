const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy in production (Render)
if (isProd) app.set('trust proxy', 1);

// Database setup
const dbPath = path.join(__dirname, 'db', 'ican.db');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');

// Ensure DB exists and schema is applied
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Migrations — add columns that may not exist yet
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
  store: new SQLiteStore({
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

// API endpoints at spec-defined paths
const { requireAuth } = require('./middleware/auth');

// Webhook endpoint - receives Web3Forms data (no auth required)
app.post('/admin/api/webhook', (req, res) => {
  const payload = req.body;

  let formType = 'contact';
  const subject = (payload.subject || '').toLowerCase();
  if (subject.includes('newsletter') || subject.includes('subscriber')) {
    formType = 'newsletter';
  } else if (subject.includes('volunteer')) {
    formType = 'volunteer';
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
    ORDER BY is_officer DESC, last_name ASC
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
