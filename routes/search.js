const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { PROGRAM_INFO } = require('../lib/constants');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const q = (req.query.q || '').trim();

  if (!q || q.length < 2) {
    return res.render('search', { title: 'Search', query: q, results: null });
  }

  const like = '%' + q + '%';

  // Search volunteers
  const volunteers = db.prepare(`
    SELECT id, first_name, last_name, email, phone, status
    FROM gardeners
    WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?
    ORDER BY last_name LIMIT 15
  `).all(like, like, like, like);

  // Search subscribers
  const subscribers = db.prepare(`
    SELECT id, email, name, status, source
    FROM subscribers
    WHERE email LIKE ? OR name LIKE ?
    ORDER BY subscribed_at DESC LIMIT 15
  `).all(like, like);

  // Search submissions
  const submissions = db.prepare(`
    SELECT id, form_type, data, read, created_at
    FROM submissions
    WHERE data LIKE ?
    ORDER BY created_at DESC LIMIT 15
  `).all(like);

  // Search board members
  const boardMembers = db.prepare(`
    SELECT id, first_name, last_name, email, title, officer_title, status
    FROM board_members
    WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR officer_title LIKE ?
    ORDER BY last_name LIMIT 15
  `).all(like, like, like, like);

  // Search posts
  const posts = db.prepare(`
    SELECT id, title, status, created_at
    FROM posts
    WHERE title LIKE ? OR content LIKE ?
    ORDER BY created_at DESC LIMIT 10
  `).all(like, like);

  // Search events
  const events = db.prepare(`
    SELECT id, title, event_date, event_type
    FROM events
    WHERE title LIKE ? OR description LIKE ? OR location LIKE ?
    ORDER BY event_date DESC LIMIT 10
  `).all(like, like, like);

  const totalResults = volunteers.length + subscribers.length + submissions.length +
    boardMembers.length + posts.length + events.length;

  res.render('search', {
    title: 'Search — ' + q,
    query: q,
    results: { volunteers, subscribers, submissions, boardMembers, posts, events, totalResults },
    programInfo: PROGRAM_INFO
  });
});

module.exports = router;
