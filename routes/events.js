const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// ── EVENTS LIST ─────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const filter = req.query.filter || 'upcoming';

  let query = 'SELECT e.*, u.name as creator_name FROM events e LEFT JOIN users u ON e.created_by = u.id';
  if (filter === 'upcoming') {
    query += " WHERE e.event_date >= date('now') ORDER BY e.event_date ASC";
  } else if (filter === 'past') {
    query += " WHERE e.event_date < date('now') ORDER BY e.event_date DESC";
  } else {
    query += ' ORDER BY e.event_date DESC';
  }

  const events = db.prepare(query).all();
  res.render('events/index', { title: 'Events', events, filter });
});

router.get('/new', requireRole('admin', 'editor'), (req, res) => {
  res.render('events/form', {
    title: 'New Event',
    event: { id: null, title: '', description: '', location: '', event_date: '', event_time: '', end_time: '', event_type: 'general', is_public: 1 },
    isNew: true
  });
});

router.post('/', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { title, description, location, event_date, event_time, end_time, event_type, is_public } = req.body;
  try {
    db.prepare(`INSERT INTO events (title, description, location, event_date, event_time, end_time, event_type, is_public, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      title, description || null, location || null, event_date,
      event_time || null, end_time || null, event_type || 'general',
      is_public ? 1 : 0, req.session.userId
    );
    req.session.flash = { type: 'success', message: 'Event created.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to create event.' };
  }
  res.redirect('/admin/events');
});

router.get('/:id/edit', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) { req.session.flash = { type: 'error', message: 'Event not found.' }; return res.redirect('/admin/events'); }
  res.render('events/form', { title: 'Edit Event', event, isNew: false });
});

router.post('/:id', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { title, description, location, event_date, event_time, end_time, event_type, is_public } = req.body;
  try {
    db.prepare(`UPDATE events SET title = ?, description = ?, location = ?, event_date = ?, event_time = ?, end_time = ?, event_type = ?, is_public = ? WHERE id = ?`).run(
      title, description || null, location || null, event_date,
      event_time || null, end_time || null, event_type || 'general',
      is_public ? 1 : 0, req.params.id
    );
    req.session.flash = { type: 'success', message: 'Event updated.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to update event.' };
  }
  res.redirect('/admin/events');
});

router.post('/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Event deleted.' };
  res.redirect('/admin/events');
});

module.exports = router;
