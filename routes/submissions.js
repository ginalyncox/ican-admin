const express = require('express');
const { requireAuth } = require('../middleware/auth');
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

module.exports = router;
