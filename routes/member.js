const express = require('express');
const bcrypt = require('bcryptjs');
const { requireMember } = require('../middleware/member-auth');
const router = express.Router();

// ── LOGIN ───────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.memberId) return res.redirect('/member');
  res.render('member/login', { title: 'Volunteer Login', error: null, layout: false });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;

  if (!email || !password) {
    return res.render('member/login', { title: 'Volunteer Login', error: 'Email and password are required.', layout: false });
  }

  const cred = db.prepare(`
    SELECT mc.*, g.first_name, g.last_name, g.id as gardener_id
    FROM member_credentials mc
    JOIN gardeners g ON mc.gardener_id = g.id
    WHERE mc.email = ?
  `).get(email);

  if (!cred) {
    return res.render('member/login', { title: 'Volunteer Login', error: 'Invalid email or password.', layout: false });
  }

  const valid = bcrypt.compareSync(password, cred.password_hash);
  if (!valid) {
    return res.render('member/login', { title: 'Volunteer Login', error: 'Invalid email or password.', layout: false });
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

  // Determine current step (4 steps now)
  let step = 'password';
  if (!cred.must_change_password) {
    step = 'personal';
    // Personal info complete when phone, email, and emergency contact filled
    if (gardener.phone && gardener.email && gardener.emergency_contact_name) {
      step = 'preferences';
      // Preferences complete when availability is set
      if (gardener.availability) {
        step = 'welcome';
      }
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
  req.session.memberFlash = { type: 'success', message: 'Password set. Now let\'s get your personal info.' };
  res.redirect('/member/onboarding');
});

// Onboarding Step 2: Personal information
router.post('/onboarding/personal', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { email: gardenerEmail, phone, address, city, state, zip, date_of_birth, emergency_contact_name, emergency_contact_phone } = req.body;

  if (!phone || !gardenerEmail || !emergency_contact_name || !emergency_contact_phone) {
    req.session.memberFlash = { type: 'error', message: 'Phone, email, and emergency contact are required.' };
    return res.redirect('/member/onboarding');
  }

  db.prepare(`UPDATE gardeners SET email = ?, phone = ?, address = ?, city = ?, state = ?, zip = ?,
    date_of_birth = ?, emergency_contact_name = ?, emergency_contact_phone = ? WHERE id = ?`)
    .run(gardenerEmail, phone, address || null, city || null, state || null, zip || null,
      date_of_birth || null, emergency_contact_name, emergency_contact_phone, gid);
  req.session.memberFlash = { type: 'success', message: 'Personal info saved. One more step!' };
  res.redirect('/member/onboarding');
});

// Onboarding Step 3: Volunteer preferences
router.post('/onboarding/preferences', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { tshirt_size, how_heard, skills, availability,
    background_check_consent, photo_release_consent, liability_waiver_signed } = req.body;

  if (!availability) {
    req.session.memberFlash = { type: 'error', message: 'Please select your availability.' };
    return res.redirect('/member/onboarding');
  }

  db.prepare(`UPDATE gardeners SET tshirt_size = ?, how_heard = ?, skills = ?, availability = ?,
    background_check_consent = ?, photo_release_consent = ?, liability_waiver_signed = ? WHERE id = ?`)
    .run(tshirt_size || null, how_heard || null, skills || null, availability,
      background_check_consent ? 1 : 0, photo_release_consent ? 1 : 0, liability_waiver_signed ? 1 : 0, gid);
  req.session.memberFlash = { type: 'success', message: 'Preferences saved. You\'re all set!' };
  res.redirect('/member/onboarding');
});

// Onboarding Step 4: Complete onboarding
router.post('/onboarding/complete', requireMember, (req, res) => {
  const db = req.app.locals.db;

  db.prepare("UPDATE member_credentials SET onboarding_completed = 1, onboarding_completed_at = datetime('now') WHERE id = ?").run(req.session.memberId);
  req.session.memberOnboardingCompleted = 1;
  req.session.memberFlash = { type: 'success', message: 'Welcome! Your onboarding is complete.' };
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

  // Get assigned programs
  const programs = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(gid).map(p => p.program);

  // Only compute garden stats if in victory_garden program
  let stats = { totalLbs: 0, totalHrs: 0, totalDonatedLbs: 0, awardCount: 0, harvestRank: 0, hoursRank: 0, totalGardeners: 0 };
  let recentHarvests = [];
  let recentHours = [];
  let awards = [];

  if (programs.includes('victory_garden')) {
    stats.totalLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ?").get(gid).c;
    stats.totalHrs = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ?").get(gid).c;
    stats.totalDonatedLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ? AND donated = 1").get(gid).c;
    stats.awardCount = db.prepare("SELECT COUNT(*) as c FROM garden_awards WHERE gardener_id = ?").get(gid).c;

    recentHarvests = db.prepare("SELECT * FROM garden_harvests WHERE gardener_id = ? ORDER BY harvest_date DESC LIMIT 10").all(gid);
    recentHours = db.prepare("SELECT * FROM garden_hours WHERE gardener_id = ? ORDER BY work_date DESC LIMIT 10").all(gid);
    awards = db.prepare("SELECT a.*, s.name as season_name FROM garden_awards a LEFT JOIN garden_seasons s ON a.season_id = s.id WHERE a.gardener_id = ? ORDER BY a.created_at DESC").all(gid);
  }

  res.render('member/dashboard', {
    title: 'My Dashboard',
    gardener,
    programs,
    stats,
    recentHarvests,
    recentHours,
    awards,
    layout: 'member/layout'
  });
});

// ── MY PROGRAMS ─────────────────────────────────────────────
router.get('/programs', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const programs = db.prepare('SELECT program, assigned_at FROM volunteer_programs WHERE volunteer_id = ? ORDER BY assigned_at').all(gid);

  const programInfo = {
    victory_garden: { label: 'Victory Garden', color: 'var(--primary)', description: 'Grow food, log harvests, track volunteer hours, and compete on the leaderboard.' },
    legislative: { label: 'Legislative Action', color: '#6366f1', description: 'Help advance cannabis policy in Iowa through grassroots advocacy.' },
    outreach: { label: 'Community Outreach', color: '#f59e0b', description: 'Engage neighbors, attend events, and spread the word about ICAN\'s mission.' },
    fundraising: { label: 'Fundraising', color: '#10b981', description: 'Help raise funds through events, campaigns, and donor outreach.' },
    communications: { label: 'Communications', color: '#8b5cf6', description: 'Support newsletters, social media, and public messaging for ICAN.' },
    membership: { label: 'Membership', color: '#ec4899', description: 'Help grow ICAN\'s member base through recruitment and retention.' }
  };

  res.render('member/programs', {
    title: 'My Programs',
    programs,
    programInfo,
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
  const programs = db.prepare('SELECT program, assigned_at FROM volunteer_programs WHERE volunteer_id = ? ORDER BY assigned_at').all(gid);

  const programLabels = {
    victory_garden: 'Victory Garden',
    legislative: 'Legislative Action',
    outreach: 'Community Outreach',
    fundraising: 'Fundraising',
    communications: 'Communications',
    membership: 'Membership'
  };

  res.render('member/profile', {
    title: 'My Profile',
    gardener,
    memberEmail: cred ? cred.email : '',
    programs,
    programLabels,
    layout: 'member/layout'
  });
});

router.post('/profile', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { email: gardenerEmail, phone, address, city, state, zip, date_of_birth,
    emergency_contact_name, emergency_contact_phone, tshirt_size, skills, availability } = req.body;

  db.prepare(`UPDATE gardeners SET email = ?, phone = ?, address = ?, city = ?, state = ?, zip = ?,
    date_of_birth = ?, emergency_contact_name = ?, emergency_contact_phone = ?,
    tshirt_size = ?, skills = ?, availability = ? WHERE id = ?`)
    .run(gardenerEmail || null, phone || null, address || null, city || null, state || null, zip || null,
      date_of_birth || null, emergency_contact_name || null, emergency_contact_phone || null,
      tshirt_size || null, skills || null, availability || null, gid);

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
