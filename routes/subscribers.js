const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

const PER_PAGE = 25;

// List subscribers with search, filter, pagination
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const search = (req.query.search || '').trim();
  const status = req.query.status || '';
  const source = req.query.source || '';
  const page = Math.max(1, parseInt(req.query.page) || 1);

  let where = [];
  let params = [];

  if (search) {
    where.push("(email LIKE ? OR name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (source) {
    where.push("source = ?");
    params.push(source);
  }

  const whereClause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : '';

  const totalCount = db.prepare('SELECT COUNT(*) as count FROM subscribers' + whereClause).get(...params).count;
  const activeCount = db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'active'").get().count;
  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
  const offset = (page - 1) * PER_PAGE;

  const subscribers = db.prepare(
    'SELECT * FROM subscribers' + whereClause + ' ORDER BY subscribed_at DESC LIMIT ? OFFSET ?'
  ).all(...params, PER_PAGE, offset);

  // Get unique sources for filter dropdown
  const sources = db.prepare('SELECT DISTINCT source FROM subscribers WHERE source IS NOT NULL ORDER BY source').all().map(r => r.source);

  res.render('subscribers/index', {
    title: 'Subscribers',
    subscribers,
    activeCount,
    totalCount,
    page,
    totalPages,
    search,
    status,
    source,
    sources
  });
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
    db.prepare('INSERT INTO subscribers (email, name, source) VALUES (?, ?, ?)').run(email.toLowerCase().trim(), name || null, 'manual');
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

// Edit subscriber
router.post('/:id/edit', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { email, name } = req.body;

  if (!email) {
    req.session.flash = { type: 'error', message: 'Email is required.' };
    return res.redirect('/admin/subscribers');
  }

  try {
    db.prepare('UPDATE subscribers SET email = ?, name = ? WHERE id = ?').run(email.toLowerCase().trim(), name || null, req.params.id);
    req.session.flash = { type: 'success', message: 'Subscriber updated.' };
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      req.session.flash = { type: 'error', message: 'That email is already in use.' };
    } else {
      req.session.flash = { type: 'error', message: 'Failed to update subscriber.' };
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

// Delete subscriber
router.post('/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Subscriber deleted.' };
  res.redirect('/admin/subscribers');
});

// Bulk toggle status
router.post('/bulk-toggle', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  let ids = req.body.ids;
  const action = req.body.action; // 'activate' or 'deactivate'

  if (!ids || !action) {
    req.session.flash = { type: 'error', message: 'No subscribers selected.' };
    return res.redirect('/admin/subscribers');
  }

  if (!Array.isArray(ids)) ids = [ids];
  const newStatus = action === 'activate' ? 'active' : 'unsubscribed';
  const placeholders = ids.map(() => '?').join(',');

  db.prepare(`UPDATE subscribers SET status = ? WHERE id IN (${placeholders})`).run(newStatus, ...ids);
  req.session.flash = { type: 'success', message: `${ids.length} subscriber(s) ${action === 'activate' ? 'activated' : 'deactivated'}.` };
  res.redirect('/admin/subscribers');
});

module.exports = router;
