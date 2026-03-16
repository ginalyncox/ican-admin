const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// List board members
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const members = db.prepare(`
    SELECT * FROM board_members ORDER BY is_officer DESC, status ASC, last_name ASC
  `).all();

  res.render('board-admin', {
    title: 'Board Members',
    members
  });
});

// Add board member
router.post('/add', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { first_name, last_name, email, password, title, phone, term_start, term_end, is_officer, officer_title } = req.body;

  if (!first_name || !last_name || !email || !password) {
    req.session.flash = { type: 'error', message: 'Name, email, and password are required.' };
    return res.redirect('/admin/board');
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      INSERT INTO board_members (first_name, last_name, email, password_hash, title, phone, term_start, term_end, is_officer, officer_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      first_name, last_name, email, hash,
      title || 'Director', phone || null,
      term_start || null, term_end || null,
      is_officer ? 1 : 0, officer_title || null
    );
    req.session.flash = { type: 'success', message: `Board member ${first_name} ${last_name} added. They can log in at /director/login.` };
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      req.session.flash = { type: 'error', message: 'A board member with that email already exists.' };
    } else {
      req.session.flash = { type: 'error', message: 'Failed to add board member.' };
    }
  }
  res.redirect('/admin/board');
});

// Update board member status
router.post('/:id/status', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { status } = req.body;
  db.prepare('UPDATE board_members SET status = ? WHERE id = ?').run(status, req.params.id);
  req.session.flash = { type: 'success', message: 'Board member status updated.' };
  res.redirect('/admin/board');
});

// Lock board member (blocks login, shows seat as vacant on public site)
router.post('/:id/lock', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { reason } = req.body;
  const member = db.prepare('SELECT first_name, last_name FROM board_members WHERE id = ?').get(req.params.id);
  db.prepare(`UPDATE board_members SET status = 'locked', locked_at = datetime('now'), locked_reason = ? WHERE id = ?`).run(reason || null, req.params.id);
  req.session.flash = { type: 'success', message: `${member ? member.first_name + ' ' + member.last_name : 'Board member'} has been locked. Their portal access is blocked and their seat shows as vacant on the public website.` };
  res.redirect('/admin/board');
});

// Unlock board member (restores to active)
router.post('/:id/unlock', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const member = db.prepare('SELECT first_name, last_name FROM board_members WHERE id = ?').get(req.params.id);
  db.prepare(`UPDATE board_members SET status = 'active', locked_at = NULL, locked_reason = NULL WHERE id = ?`).run(req.params.id);
  req.session.flash = { type: 'success', message: `${member ? member.first_name + ' ' + member.last_name : 'Board member'} has been unlocked. Portal access restored and seat is visible on the public website.` };
  res.redirect('/admin/board');
});

// Reset board member password
router.post('/:id/reset-password', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { new_password } = req.body;

  if (!new_password || new_password.length < 8) {
    req.session.flash = { type: 'error', message: 'Password must be at least 8 characters.' };
    return res.redirect('/admin/board');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE board_members SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  req.session.flash = { type: 'success', message: 'Password reset successfully.' };
  res.redirect('/admin/board');
});

// Delete board member
router.post('/:id/delete', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM board_members WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Board member removed.' };
  res.redirect('/admin/board');
});

module.exports = router;
