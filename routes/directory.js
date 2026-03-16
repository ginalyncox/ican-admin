const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const search = (req.query.q || '').trim();
  const filter = req.query.filter || 'all';

  // Counts for filter tabs
  const volunteerCount = db.prepare(`SELECT COUNT(*) as c FROM gardeners g JOIN member_credentials mc ON mc.gardener_id = g.id`).get().c;
  const directorCount = db.prepare(`SELECT COUNT(*) as c FROM board_members WHERE status IN ('active','locked')`).get().c;
  const subscriberCount = db.prepare(`SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'`).get().c;
  const totalCount = volunteerCount + directorCount + subscriberCount;

  let rows = [];
  const like = search ? `%${search}%` : null;

  if (filter === 'all' || filter === 'volunteers') {
    const volSQL = `
      SELECT g.id, g.first_name, g.last_name, mc.email, g.phone, 'volunteer' as role, mc.last_login
      FROM gardeners g JOIN member_credentials mc ON mc.gardener_id = g.id
      ${like ? "WHERE (g.first_name||' '||g.last_name LIKE ? OR mc.email LIKE ?)" : ''}
      ORDER BY g.last_name ASC`;
    const volRows = like ? db.prepare(volSQL).all(like, like) : db.prepare(volSQL).all();
    rows = rows.concat(volRows);
  }
  if (filter === 'all' || filter === 'directors') {
    const dirSQL = `
      SELECT id, first_name, last_name, email, phone, 'director' as role, last_login
      FROM board_members WHERE status IN ('active','locked')
      ${like ? "AND (first_name||' '||last_name LIKE ? OR email LIKE ?)" : ''}
      ORDER BY last_name ASC`;
    const dirRows = like ? db.prepare(dirSQL).all(like, like) : db.prepare(dirSQL).all();
    rows = rows.concat(dirRows);
  }
  if (filter === 'all' || filter === 'subscribers') {
    const subSQL = `
      SELECT id, name as first_name, '' as last_name, email, '' as phone, 'subscriber' as role, NULL as last_login
      FROM subscribers WHERE status = 'active'
      ${like ? "AND (name LIKE ? OR email LIKE ?)" : ''}
      ORDER BY name ASC`;
    const subRows = like ? db.prepare(subSQL).all(like, like) : db.prepare(subSQL).all();
    rows = rows.concat(subRows);
  }

  res.render('directory', {
    title: 'Directory',
    rows,
    search,
    filter,
    counts: { all: totalCount, volunteers: volunteerCount, directors: directorCount, subscribers: subscriberCount }
  });
});

module.exports = router;
