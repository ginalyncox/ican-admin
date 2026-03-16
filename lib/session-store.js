/**
 * Simple session store using better-sqlite3
 * Replaces connect-sqlite3 to avoid the extra sqlite3 native dependency
 */
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');

class BetterSqliteStore extends session.Store {
  constructor(options = {}) {
    super();
    const dbPath = path.join(options.dir || '.', options.db || 'sessions.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)`);

    // Clean up expired sessions every 15 minutes
    this._cleanup = setInterval(() => {
      try { this.db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now()); } catch (e) {}
    }, 15 * 60 * 1000);
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
      if (row) {
        cb(null, JSON.parse(row.sess));
      } else {
        cb(null, null);
      }
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
      const expired = Date.now() + maxAge;
      this.db.prepare(
        'INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)'
      ).run(sid, JSON.stringify(sess), expired);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  clear(cb) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  length(cb) {
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expired > ?').get(Date.now());
      cb(null, row.count);
    } catch (e) { cb(e); }
  }
}

module.exports = BetterSqliteStore;
