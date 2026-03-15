const express = require('express');
const bcrypt = require('bcrypt');
const { requireMember } = require('../middleware/member-auth');
const router = express.Router();

// ── LOGIN ───────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.memberId) return res.redirect('/member');
  res.render('member/login', { title: 'Member Login', error: null, layout: false });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;

  if (!email || !password) {
    return res.render('member/login', { title: 'Member Login', error: 'Email and password are required.', layout: false });
  }

  const cred = db.prepare(`
    SELECT mc.*, g.first_name, g.last_name, g.id as gardener_id
    FROM member_credentials mc
    JOIN gardeners g ON mc.gardener_id = g.id
    WHERE mc.email = ?
  `).get(email);

  if (!cred) {
    return res.render('member/login', { title: 'Member Login', error: 'Invalid email or password.', layout: false });
  }

  const valid = bcrypt.compareSync(password, cred.password_hash);
  if (!valid) {
    return res.render('member/login', { title: 'Member Login', error: 'Invalid email or password.', layout: false });
  }

  // Update last login
  db.prepare("UPDATE member_credentials SET last_login = datetime('now') WHERE id = ?").run(cred.id);

  req.session.memberId = cred.id;
  req.session.memberGardenerId = cred.gardener_id;
  req.session.memberName = cred.first_name + ' ' + cred.last_name;
  req.session.memberEmail = cred.email;

  res.redirect('/member');
});

router.get('/logout', (req, res) => {
  delete req.session.memberId;
  delete req.session.memberGardenerId;
  delete req.session.memberName;
  delete req.session.memberEmail;
  res.redirect('/member/login');
});

// ── MY DASHBOARD ────────────────────────────────────────────
router.get('/', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;

  const gardener = db.prepare(`
    SELECT g.*, gs.name as site_name, gsn.name as season_name
    FROM gardeners g
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    LEFT JOIN garden_seasons gsn ON g.season_id = gsn.id
    WHERE g.id = ?
  `).get(gid);

  const totalLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ?").get(gid).c;
  const totalHrs = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ?").get(gid).c;
  const totalDonatedLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ? AND donated = 1").get(gid).c;
  const awardCount = db.prepare("SELECT COUNT(*) as c FROM garden_awards WHERE gardener_id = ?").get(gid).c;

  const recentHarvests = db.prepare("SELECT * FROM garden_harvests WHERE gardener_id = ? ORDER BY harvest_date DESC LIMIT 10").all(gid);
  const recentHours = db.prepare("SELECT * FROM garden_hours WHERE gardener_id = ? ORDER BY work_date DESC LIMIT 10").all(gid);
  const awards = db.prepare("SELECT a.*, s.name as season_name FROM garden_awards a LEFT JOIN garden_seasons s ON a.season_id = s.id WHERE a.gardener_id = ? ORDER BY a.created_at DESC").all(gid);

  // Rank among all active gardeners (harvest lbs)
  const allByLbs = db.prepare(`
    SELECT g.id, COALESCE(SUM(h.pounds), 0) as total
    FROM gardeners g LEFT JOIN garden_harvests h ON g.id = h.gardener_id
    WHERE g.status = 'active' GROUP BY g.id ORDER BY total DESC
  `).all();
  const harvestRank = allByLbs.findIndex(r => r.id === gid) + 1;

  // Rank by hours
  const allByHrs = db.prepare(`
    SELECT g.id, COALESCE(SUM(vh.hours), 0) as total
    FROM gardeners g LEFT JOIN garden_hours vh ON g.id = vh.gardener_id
    WHERE g.status = 'active' GROUP BY g.id ORDER BY total DESC
  `).all();
  const hoursRank = allByHrs.findIndex(r => r.id === gid) + 1;

  res.render('member/dashboard', {
    title: 'My Garden',
    gardener,
    stats: { totalLbs, totalHrs, totalDonatedLbs, awardCount, harvestRank, hoursRank, totalGardeners: allByLbs.length },
    recentHarvests,
    recentHours,
    awards,
    layout: 'member/layout'
  });
});

// ── LEADERBOARD ─────────────────────────────────────────────
router.get('/leaderboard', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;

  const harvestLeaders = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, gs.name as site_name,
           COALESCE(SUM(h.pounds), 0) as total_lbs
    FROM gardeners g
    LEFT JOIN garden_harvests h ON g.id = h.gardener_id
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    WHERE g.status = 'active'
    GROUP BY g.id ORDER BY total_lbs DESC
  `).all();

  const hoursLeaders = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, gs.name as site_name,
           COALESCE(SUM(vh.hours), 0) as total_hrs
    FROM gardeners g
    LEFT JOIN garden_hours vh ON g.id = vh.gardener_id
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    WHERE g.status = 'active'
    GROUP BY g.id ORDER BY total_hrs DESC
  `).all();

  res.render('member/leaderboard', {
    title: 'Leaderboard',
    harvestLeaders,
    hoursLeaders,
    myId: gid,
    layout: 'member/layout'
  });
});

// ── MY AWARDS ───────────────────────────────────────────────
router.get('/awards', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;

  const awards = db.prepare(`
    SELECT a.*, s.name as season_name
    FROM garden_awards a
    LEFT JOIN garden_seasons s ON a.season_id = s.id
    WHERE a.gardener_id = ?
    ORDER BY a.created_at DESC
  `).all(gid);

  res.render('member/awards', {
    title: 'My Awards',
    awards,
    layout: 'member/layout'
  });
});

module.exports = router;
