const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// ── SETTINGS PAGE ───────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const users = req.session.userRole === 'admin'
    ? db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY name').all()
    : [];
  res.render('settings/index', { title: 'Settings', currentUser, users });
});

// Change own password
router.post('/password', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    req.session.flash = { type: 'error', message: 'All password fields are required.' };
    return res.redirect('/admin/settings');
  }
  if (new_password !== confirm_password) {
    req.session.flash = { type: 'error', message: 'New passwords do not match.' };
    return res.redirect('/admin/settings');
  }
  if (new_password.length < 8) {
    req.session.flash = { type: 'error', message: 'Password must be at least 8 characters.' };
    return res.redirect('/admin/settings');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    req.session.flash = { type: 'error', message: 'Current password is incorrect.' };
    return res.redirect('/admin/settings');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  req.session.flash = { type: 'success', message: 'Password updated successfully.' };
  res.redirect('/admin/settings');
});

// Update own name
router.post('/profile', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.session.flash = { type: 'error', message: 'Name is required.' };
    return res.redirect('/admin/settings');
  }
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.session.userId);
  req.session.userName = name.trim();
  req.session.flash = { type: 'success', message: 'Profile updated.' };
  res.redirect('/admin/settings');
});

// ── USER MANAGEMENT (admin only) ────────────────────────────
router.post('/users', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    req.session.flash = { type: 'error', message: 'Name, email, and password are required.' };
    return res.redirect('/admin/settings');
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name.trim(), email.trim().toLowerCase(), hash, role || 'editor');
    req.session.flash = { type: 'success', message: `Staff member ${name} added.` };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message.includes('UNIQUE') ? 'That email already exists.' : 'Failed to add user.' };
  }
  res.redirect('/admin/settings');
});

router.post('/users/:id/role', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { role } = req.body;
  if (parseInt(req.params.id) === req.session.userId) {
    req.session.flash = { type: 'error', message: 'You cannot change your own role.' };
    return res.redirect('/admin/settings');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  req.session.flash = { type: 'success', message: 'Role updated.' };
  res.redirect('/admin/settings');
});

router.post('/users/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  if (parseInt(req.params.id) === req.session.userId) {
    req.session.flash = { type: 'error', message: 'You cannot delete yourself.' };
    return res.redirect('/admin/settings');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'User removed.' };
  res.redirect('/admin/settings');
});

module.exports = router;
