const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const search = (req.query.q || '').trim();
  const filter = req.query.filter || 'all';

  // Build unified people list from accounts table
  const like = search ? `%${search}%` : null;

  let query = `
    SELECT 
      a.id as account_id,
      a.email,
      a.name,
      a.roles,
      a.status,
      a.last_login,
      a.gardener_id,
      a.board_member_id,
      a.admin_user_id,
      g.first_name,
      g.last_name,
      g.phone,
      g.leadership_role,
      g.leadership_program,
      bm.title as board_title,
      bm.officer_title,
      bm.is_officer
    FROM accounts a
    LEFT JOIN gardeners g ON a.gardener_id = g.id
    LEFT JOIN board_members bm ON a.board_member_id = bm.id
    WHERE a.status = 'active'
  `;
  const params = [];

  if (search) {
    query += ` AND (a.name LIKE ? OR a.email LIKE ? OR g.first_name LIKE ? OR g.last_name LIKE ? OR g.phone LIKE ?)`;
    params.push(like, like, like, like, like);
  }

  if (filter === 'admin') {
    query += ` AND a.roles LIKE '%admin%'`;
  } else if (filter === 'volunteers') {
    query += ` AND a.roles LIKE '%volunteer%'`;
  } else if (filter === 'directors') {
    query += ` AND a.roles LIKE '%director%'`;
  }

  query += ` ORDER BY COALESCE(g.last_name, a.name) ASC`;

  const people = db.prepare(query).all(...params);

  // Also get subscribers who don't have accounts
  let subscribers = [];
  if (filter === 'all' || filter === 'subscribers') {
    let subQuery = `
      SELECT s.id, s.email, s.name, s.source, s.status, s.subscribed_at
      FROM subscribers s
      WHERE s.status = 'active'
      AND s.email NOT IN (SELECT email FROM accounts WHERE status = 'active')
    `;
    const subParams = [];
    if (search) {
      subQuery += ` AND (s.name LIKE ? OR s.email LIKE ?)`;
      subParams.push(like, like);
    }
    subQuery += ` ORDER BY s.name ASC`;
    subscribers = db.prepare(subQuery).all(...subParams);
  }

  // Counts
  const accountCount = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE status = 'active'").get().c;
  const adminCount = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE status = 'active' AND roles LIKE '%admin%'").get().c;
  const volunteerCount = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE status = 'active' AND roles LIKE '%volunteer%'").get().c;
  const directorCount = db.prepare("SELECT COUNT(*) as c FROM accounts WHERE status = 'active' AND roles LIKE '%director%'").get().c;
  const subscriberOnlyCount = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active' AND email NOT IN (SELECT email FROM accounts WHERE status = 'active')").get().c;

  res.render('directory', {
    title: 'Directory',
    people,
    subscribers,
    search,
    filter,
    counts: {
      all: accountCount + subscriberOnlyCount,
      admin: adminCount,
      volunteers: volunteerCount,
      directors: directorCount,
      subscribers: subscriberOnlyCount
    }
  });
});

module.exports = router;
