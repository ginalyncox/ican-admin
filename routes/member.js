const express = require('express');
const bcrypt = require('bcryptjs');
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
  req.session.memberMustChangePassword = cred.must_change_password;
  req.session.memberOnboardingCompleted = cred.onboarding_completed;

  // Redirect to onboarding if not completed
  if (cred.must_change_password || !cred.onboarding_completed) {
    return res.redirect('/member/onboarding');
  }

  res.redirect('/member');
});

router.get('/logout', (req, res) => {
  delete req.session.memberId;
  delete req.session.memberGardenerId;
  delete req.session.memberName;
  delete req.session.memberEmail;
  res.redirect('/member/login');
});

// ── ONBOARDING ──────────────────────────────────────────────
router.get('/onboarding', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const cred = db.prepare('SELECT * FROM member_credentials WHERE id = ?').get(req.session.memberId);
  const gardener = db.prepare('SELECT * FROM gardeners WHERE id = ?').get(req.session.memberGardenerId);

  // If already completed, go to dashboard
  if (cred.onboarding_completed) {
    return res.redirect('/member');
  }

  // Determine current step
  let step = 'password';
  if (!cred.must_change_password) {
    step = 'profile';
    if (gardener.phone && gardener.email) {
      step = 'welcome';
    }
  }

  res.render('member/onboarding', {
    title: 'Welcome — Get Started',
    gardener,
    cred,
    step,
    layout: 'member/layout'
  });
});

// Onboarding Step 1: Change password
router.post('/onboarding/password', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const { new_password, confirm_password } = req.body;

  if (!new_password || !confirm_password) {
    req.session.memberFlash = { type: 'error', message: 'Both password fields are required.' };
    return res.redirect('/member/onboarding');
  }
  if (new_password !== confirm_password) {
    req.session.memberFlash = { type: 'error', message: 'Passwords do not match.' };
    return res.redirect('/member/onboarding');
  }
  if (new_password.length < 8) {
    req.session.memberFlash = { type: 'error', message: 'Password must be at least 8 characters.' };
    return res.redirect('/member/onboarding');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE member_credentials SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.session.memberId);
  req.session.memberMustChangePassword = 0;
  req.session.memberFlash = { type: 'success', message: 'Password set. Let\'s complete your profile.' };
  res.redirect('/member/onboarding');
});

// Onboarding Step 2: Complete profile
router.post('/onboarding/profile', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { email: gardenerEmail, phone } = req.body;

  if (!phone || !gardenerEmail) {
    req.session.memberFlash = { type: 'error', message: 'Phone and email are required.' };
    return res.redirect('/member/onboarding');
  }

  db.prepare('UPDATE gardeners SET email = ?, phone = ? WHERE id = ?').run(gardenerEmail, phone, gid);
  req.session.memberFlash = { type: 'success', message: 'Profile saved. Almost done!' };
  res.redirect('/member/onboarding');
});

// Onboarding Step 3: Complete onboarding
router.post('/onboarding/complete', requireMember, (req, res) => {
  const db = req.app.locals.db;

  db.prepare("UPDATE member_credentials SET onboarding_completed = 1, onboarding_completed_at = datetime('now') WHERE id = ?").run(req.session.memberId);
  req.session.memberOnboardingCompleted = 1;
  req.session.memberFlash = { type: 'success', message: 'Welcome! Your onboarding is complete. Start logging your garden activity!' };
  res.redirect('/member');
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

// ── SELF-REPORTING: LOG HARVEST ─────────────────────────────
router.get('/log-harvest', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const gardener = db.prepare('SELECT * FROM gardeners WHERE id = ?').get(gid);
  const seasons = db.prepare("SELECT * FROM garden_seasons WHERE status = 'active' ORDER BY year DESC").all();
  res.render('member/log-harvest', {
    title: 'Log Harvest',
    gardener,
    seasons,
    layout: 'member/layout'
  });
});

router.post('/log-harvest', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { season_id, harvest_date, crop, pounds, donated, donated_to, notes } = req.body;
  try {
    db.prepare("INSERT INTO garden_harvests (gardener_id, season_id, harvest_date, crop, pounds, donated, donated_to, donation_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(gid, season_id || null, harvest_date, crop, parseFloat(pounds) || 0, donated ? 1 : 0, donated_to || null, notes || null);
    req.session.memberFlash = { type: 'success', message: 'Harvest logged. It will appear after admin verification.' };
  } catch (err) {
    req.session.memberFlash = { type: 'error', message: 'Failed to log harvest.' };
  }
  res.redirect('/member');
});

// ── SELF-REPORTING: LOG VOLUNTEER HOURS ──────────────────────
router.get('/log-hours', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const seasons = db.prepare("SELECT * FROM garden_seasons WHERE status = 'active' ORDER BY year DESC").all();
  res.render('member/log-hours', {
    title: 'Log Hours',
    seasons,
    layout: 'member/layout'
  });
});

router.post('/log-hours', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { season_id, work_date, hours, activity, notes } = req.body;
  try {
    db.prepare("INSERT INTO garden_hours (gardener_id, season_id, work_date, hours, activity, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(gid, season_id || null, work_date, parseFloat(hours) || 0, activity || null, notes || null);
    req.session.memberFlash = { type: 'success', message: 'Volunteer hours logged.' };
  } catch (err) {
    req.session.memberFlash = { type: 'error', message: 'Failed to log hours.' };
  }
  res.redirect('/member');
});

// ── PROFILE EDITING ─────────────────────────────────────────
router.get('/profile', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const gardener = db.prepare('SELECT * FROM gardeners WHERE id = ?').get(gid);
  const cred = db.prepare('SELECT email FROM member_credentials WHERE gardener_id = ?').get(gid);
  res.render('member/profile', {
    title: 'My Profile',
    gardener,
    memberEmail: cred ? cred.email : '',
    layout: 'member/layout'
  });
});

router.post('/profile', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { email: gardenerEmail, phone } = req.body;
  db.prepare('UPDATE gardeners SET email = ?, phone = ? WHERE id = ?').run(gardenerEmail || null, phone || null, gid);
  req.session.memberFlash = { type: 'success', message: 'Profile updated.' };
  res.redirect('/member/profile');
});

// ── PASSWORD CHANGE ─────────────────────────────────────────
router.post('/change-password', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    req.session.memberFlash = { type: 'error', message: 'All password fields are required.' };
    return res.redirect('/member/profile');
  }
  if (new_password !== confirm_password) {
    req.session.memberFlash = { type: 'error', message: 'New passwords do not match.' };
    return res.redirect('/member/profile');
  }
  if (new_password.length < 8) {
    req.session.memberFlash = { type: 'error', message: 'Password must be at least 8 characters.' };
    return res.redirect('/member/profile');
  }

  const cred = db.prepare('SELECT * FROM member_credentials WHERE id = ?').get(req.session.memberId);
  if (!bcrypt.compareSync(current_password, cred.password_hash)) {
    req.session.memberFlash = { type: 'error', message: 'Current password is incorrect.' };
    return res.redirect('/member/profile');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE member_credentials SET password_hash = ? WHERE id = ?').run(hash, req.session.memberId);
  req.session.memberFlash = { type: 'success', message: 'Password updated.' };
  res.redirect('/member/profile');
});

module.exports = router;
