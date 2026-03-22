const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ── RETENTION DASHBOARD ─────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { type } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];

  // Auto-update statuses
  db.prepare(`UPDATE renewal_items SET status = 'overdue' WHERE expires_at < ? AND status IN ('current', 'due_soon')`).run(today);
  db.prepare(`UPDATE renewal_items SET status = 'due_soon' WHERE expires_at >= ? AND expires_at <= ? AND status = 'current'`).run(today, in30);

  let where = '1=1';
  const params = [];
  if (type) { where += ' AND ri.item_type = ?'; params.push(type); }

  const currentCount = db.prepare(`SELECT COUNT(*) as c FROM renewal_items ri WHERE ${where} AND ri.status = 'current'`).get(...params).c;
  const dueSoonCount = db.prepare(`SELECT COUNT(*) as c FROM renewal_items ri WHERE ${where} AND ri.status = 'due_soon'`).get(...params).c;
  const overdueCount = db.prepare(`SELECT COUNT(*) as c FROM renewal_items ri WHERE ${where} AND ri.status = 'overdue'`).get(...params).c;

  // Upcoming renewals (next 90 days)
  const upcoming = db.prepare(`
    SELECT ri.*,
      CASE ri.related_type
        WHEN 'volunteer' THEN (SELECT first_name || ' ' || last_name FROM gardeners WHERE id = ri.related_id)
        WHEN 'director' THEN (SELECT first_name || ' ' || last_name FROM board_members WHERE id = ri.related_id)
        ELSE 'Organization'
      END as related_name
    FROM renewal_items ri
    WHERE ${where} AND ri.expires_at <= ? AND ri.status IN ('current', 'due_soon')
    ORDER BY ri.expires_at ASC
  `).all(...params, in90);

  // Overdue items
  const overdue = db.prepare(`
    SELECT ri.*,
      CASE ri.related_type
        WHEN 'volunteer' THEN (SELECT first_name || ' ' || last_name FROM gardeners WHERE id = ri.related_id)
        WHEN 'director' THEN (SELECT first_name || ' ' || last_name FROM board_members WHERE id = ri.related_id)
        ELSE 'Organization'
      END as related_name,
      CAST(julianday('now') - julianday(ri.expires_at) AS INTEGER) as days_overdue
    FROM renewal_items ri
    WHERE ${where} AND ri.status = 'overdue'
    ORDER BY ri.expires_at ASC
  `).all(...params);

  const itemTypes = [
    { value: 'agreement', label: 'Agreement' },
    { value: 'coi', label: 'COI Disclosure' },
    { value: 'background_check', label: 'Background Check' },
    { value: 'policy_review', label: 'Policy Review' },
    { value: 'certification', label: 'Certification' }
  ];

  // Volunteers and directors for the "create" form
  const volunteers = db.prepare("SELECT id, first_name || ' ' || last_name as name FROM gardeners WHERE status = 'active' ORDER BY last_name").all();
  const directors = db.prepare("SELECT id, first_name || ' ' || last_name as name FROM board_members WHERE status = 'active' ORDER BY last_name").all();

  res.render('retention/dashboard', {
    title: 'Renewals & Retention',
    currentCount,
    dueSoonCount,
    overdueCount,
    upcoming,
    overdue,
    itemTypes,
    volunteers,
    directors,
    filters: { type: type || '' }
  });
});

// ── CALENDAR VIEW ───────────────────────────────────────────
router.get('/calendar', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

  // Get all renewal items with expiry dates for this year
  const items = db.prepare(`
    SELECT ri.*,
      CASE ri.related_type
        WHEN 'volunteer' THEN (SELECT first_name || ' ' || last_name FROM gardeners WHERE id = ri.related_id)
        WHEN 'director' THEN (SELECT first_name || ' ' || last_name FROM board_members WHERE id = ri.related_id)
        ELSE 'Organization'
      END as related_name
    FROM renewal_items ri
    WHERE strftime('%Y', ri.expires_at) = ? OR strftime('%Y', ri.expires_at) = ?
    ORDER BY ri.expires_at ASC
  `).all(String(year), String(year + 1));

  // Group by month
  const byMonth = {};
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    byMonth[key] = [];
  }
  for (const item of items) {
    if (!item.expires_at) continue;
    const key = item.expires_at.substring(0, 7);
    if (byMonth[key]) byMonth[key].push(item);
  }

  res.render('retention/calendar', {
    title: 'Renewal Calendar',
    year,
    month,
    byMonth
  });
});

// ── CREATE RENEWAL ITEM ─────────────────────────────────────
router.post('/items', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { item_type, related_type, related_id, title, expires_at, renewal_interval_days, notes } = req.body;

  if (!item_type || !title || !title.trim()) {
    req.session.flash = { type: 'error', message: 'Type and title are required.' };
    return res.redirect('/admin/retention');
  }

  const today = new Date().toISOString().split('T')[0];
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  let status = 'current';
  if (expires_at && expires_at < today) status = 'overdue';
  else if (expires_at && expires_at <= in30) status = 'due_soon';

  db.prepare(`INSERT INTO renewal_items (item_type, related_type, related_id, title, last_completed, expires_at, renewal_interval_days, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(item_type, related_type || 'organization', related_id || null, title.trim(), today, expires_at || null, parseInt(renewal_interval_days) || 365, status, notes || null);

  req.session.flash = { type: 'success', message: 'Renewal item created.' };
  res.redirect('/admin/retention');
});

// ── MARK AS RENEWED ─────────────────────────────────────────
router.post('/:id/renew', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const item = db.prepare("SELECT * FROM renewal_items WHERE id = ?").get(req.params.id);
  if (!item) {
    req.session.flash = { type: 'error', message: 'Item not found.' };
    return res.redirect('/admin/retention');
  }

  const today = new Date().toISOString().split('T')[0];
  const intervalDays = item.renewal_interval_days || 365;
  const newExpiry = new Date(Date.now() + intervalDays * 86400000).toISOString().split('T')[0];

  db.prepare("UPDATE renewal_items SET last_completed = ?, expires_at = ?, status = 'current' WHERE id = ?")
    .run(today, newExpiry, req.params.id);

  req.session.flash = { type: 'success', message: `Renewed. New expiry: ${newExpiry}` };
  res.redirect('/admin/retention');
});

module.exports = router;
