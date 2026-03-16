const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// List submissions
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const type = req.query.type || '';

  let query = 'SELECT * FROM submissions';
  const params = [];

  if (type) {
    query += ' WHERE form_type = ?';
    params.push(type);
  }
  query += ' ORDER BY created_at DESC';

  const submissions = db.prepare(query).all(...params);
  res.render('submissions/index', { title: 'Form Submissions', submissions, filter: type });
});

// View single submission
router.get('/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);

  if (!submission) {
    req.session.flash = { type: 'error', message: 'Submission not found.' };
    return res.redirect('/admin/submissions');
  }

  // Mark as read
  if (!submission.read) {
    db.prepare('UPDATE submissions SET read = 1 WHERE id = ?').run(req.params.id);
    submission.read = 1;
  }

  res.json({ success: true, submission: { ...submission, data: JSON.parse(submission.data) } });
});

// Toggle read status
router.post('/:id/toggle-read', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (submission) {
    db.prepare('UPDATE submissions SET read = ? WHERE id = ?').run(submission.read ? 0 : 1, req.params.id);
  }
  res.redirect('/admin/submissions' + (req.query.type ? `?type=${req.query.type}` : ''));
});

// Convert volunteer submission to member portal account
router.post('/:id/create-member', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);

  if (!submission) {
    req.session.flash = { type: 'error', message: 'Submission not found.' };
    return res.redirect('/admin/submissions');
  }

  const data = JSON.parse(submission.data);
  const firstName = data.first_name || data.name?.split(' ')[0] || 'Volunteer';
  const lastName = data.last_name || data.name?.split(' ').slice(1).join(' ') || '';
  const email = data.email;
  const phone = data.phone || null;

  if (!email) {
    req.session.flash = { type: 'error', message: 'No email address found in submission. Cannot create account.' };
    return res.redirect('/admin/submissions');
  }

  // Check if gardener with this email already exists
  const existing = db.prepare('SELECT id FROM gardeners WHERE email = ?').get(email);
  if (existing) {
    req.session.flash = { type: 'error', message: `A gardener with email ${email} already exists.` };
    return res.redirect('/admin/submissions');
  }

  // Check if member credentials already exist
  const existingCred = db.prepare('SELECT id FROM member_credentials WHERE email = ?').get(email);
  if (existingCred) {
    req.session.flash = { type: 'error', message: `A member account with email ${email} already exists.` };
    return res.redirect('/admin/submissions');
  }

  try {
    // Create gardener record
    const tempPassword = 'Welcome' + Math.floor(1000 + Math.random() * 9000);
    const hash = bcrypt.hashSync(tempPassword, 10);

    const result = db.prepare(`
      INSERT INTO gardeners (first_name, last_name, email, phone, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      firstName, lastName, email, phone,
      'Created from volunteer application. Interest: ' + (data.interest_area || 'not specified') + '. Hours: ' + (data.hours_per_week || 'not specified')
    );

    // Create member credentials with must_change_password flag
    db.prepare(`
      INSERT INTO member_credentials (gardener_id, email, password_hash, must_change_password, onboarding_completed)
      VALUES (?, ?, ?, 1, 0)
    `).run(result.lastInsertRowid, email, hash);

    // Mark submission as read
    db.prepare('UPDATE submissions SET read = 1 WHERE id = ?').run(req.params.id);

    req.session.flash = {
      type: 'success',
      message: `Member account created for ${firstName} ${lastName}. Temp password: ${tempPassword} — They will be prompted to change it on first login.`
    };
  } catch (err) {
    console.error('Create member error:', err);
    req.session.flash = { type: 'error', message: 'Failed to create member account: ' + err.message };
  }

  res.redirect('/admin/submissions?type=volunteer');
});

// Convert board application submission to director account
router.post('/:id/create-director', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);

  if (!submission) {
    req.session.flash = { type: 'error', message: 'Submission not found.' };
    return res.redirect('/admin/submissions');
  }

  const data = JSON.parse(submission.data);
  const firstName = data.first_name || data.name?.split(' ')[0] || 'Applicant';
  const lastName = data.last_name || data.name?.split(' ').slice(1).join(' ') || '';
  const email = data.email;
  const phone = data.phone || null;

  if (!email) {
    req.session.flash = { type: 'error', message: 'No email address found in application. Cannot create account.' };
    return res.redirect('/admin/submissions?type=board_application');
  }

  // Check if board member with this email already exists
  const existing = db.prepare('SELECT id FROM board_members WHERE email = ?').get(email);
  if (existing) {
    req.session.flash = { type: 'error', message: `A board member with email ${email} already exists.` };
    return res.redirect('/admin/submissions?type=board_application');
  }

  try {
    const tempPassword = 'Board' + Math.floor(1000 + Math.random() * 9000);
    const hash = bcrypt.hashSync(tempPassword, 10);

    // Build bio from application data
    const bioParts = [];
    if (data.occupation) bioParts.push('Occupation: ' + data.occupation);
    if (data.city_county) bioParts.push('Location: ' + data.city_county);
    if (data.experience) bioParts.push('Experience: ' + data.experience);
    if (data.why_serve) bioParts.push('Motivation: ' + data.why_serve);
    const bio = bioParts.join('. ').substring(0, 500) || null;

    // Create board member with onboarding required
    db.prepare(`
      INSERT INTO board_members (
        first_name, last_name, email, password_hash, title, phone, bio,
        term_start, is_officer, status, must_change_password, onboarding_completed
      ) VALUES (?, ?, ?, ?, 'Director', ?, ?, date('now'), 0, 'active', 1, 0)
    `).run(
      firstName, lastName, email, hash, phone, bio
    );

    // Mark submission as read
    db.prepare('UPDATE submissions SET read = 1 WHERE id = ?').run(req.params.id);

    req.session.flash = {
      type: 'success',
      message: `Director account created for ${firstName} ${lastName}. Temp password: ${tempPassword} — They will complete onboarding (password change, profile, COI) on first login at /director/login.`
    };
  } catch (err) {
    console.error('Create director error:', err);
    if (err.message.includes('UNIQUE')) {
      req.session.flash = { type: 'error', message: `A board member with email ${email} already exists.` };
    } else {
      req.session.flash = { type: 'error', message: 'Failed to create director account: ' + err.message };
    }
  }

  res.redirect('/admin/submissions?type=board_application');
});

module.exports = router;
