const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// List subscribers
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const subscribers = db.prepare('SELECT * FROM subscribers ORDER BY subscribed_at DESC').all();
  const activeCount = db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'active'").get().count;

  res.render('subscribers/index', { title: 'Subscribers', subscribers, activeCount });
});

// Add subscriber
router.post('/', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { email, name } = req.body;

  if (!email) {
    req.session.flash = { type: 'error', message: 'Email is required.' };
    return res.redirect('/admin/subscribers');
  }

  try {
    db.prepare('INSERT INTO subscribers (email, name, source) VALUES (?, ?, ?)').run(email, name || null, 'manual');
    req.session.flash = { type: 'success', message: 'Subscriber added.' };
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      req.session.flash = { type: 'error', message: 'That email is already subscribed.' };
    } else {
      req.session.flash = { type: 'error', message: 'Failed to add subscriber.' };
    }
  }

  res.redirect('/admin/subscribers');
});

// Toggle subscriber status
router.post('/:id/toggle', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const subscriber = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(req.params.id);
  if (subscriber) {
    const newStatus = subscriber.status === 'active' ? 'unsubscribed' : 'active';
    db.prepare('UPDATE subscribers SET status = ? WHERE id = ?').run(newStatus, req.params.id);
  }
  res.redirect('/admin/subscribers');
});

module.exports = router;
