const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { requireMember } = require('../middleware/member-auth');
const { PROGRAM_INFO, VALID_PROGRAMS } = require('../lib/constants');
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

  const normalizedEmail = email.toLowerCase().trim();
  const cred = db.prepare(`
    SELECT mc.*, g.first_name, g.last_name, g.id as gardener_id, g.status as gardener_status
    FROM member_credentials mc
    JOIN gardeners g ON mc.gardener_id = g.id
    WHERE mc.email = ?
  `).get(normalizedEmail);

  if (!cred) {
    return res.render('member/login', { title: 'Volunteer Login', error: 'Invalid email or password.', layout: false });
  }

  if (cred.gardener_status !== 'active') {
    return res.render('member/login', { title: 'Volunteer Login', error: 'Your account is not active. Please contact the administrator.', layout: false });
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
  req.session.destroy(() => {
    res.redirect('/member/login');
  });
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

  // Determine current step (6 steps: password, personal, preferences, programs, documents, welcome)
  let step = 'password';
  if (!cred.must_change_password) {
    step = 'personal';
    if (gardener.phone && gardener.email && gardener.emergency_contact_name) {
      step = 'preferences';
      if (gardener.availability) {
        step = 'programs';
        const hasApplied = db.prepare('SELECT COUNT(*) as c FROM program_applications WHERE volunteer_id = ?').get(gardener.id).c;
        if (hasApplied > 0) {
          step = 'documents';
          if (cred.documents_acknowledged) {
            step = 'welcome';
          }
        }
      }
    }
  }

  const programInfo = PROGRAM_INFO;

  // Get existing applications for this volunteer
  const existingApps = db.prepare('SELECT program, status FROM program_applications WHERE volunteer_id = ?').all(gardener.id);
  const appliedPrograms = existingApps.map(a => a.program);

  // Get volunteer-facing documents for acknowledgment step
  const volDocs = db.prepare(`
    SELECT d.id, d.title, d.category, d.original_name
    FROM board_documents d
    JOIN board_resources r ON r.document_id = d.id
    WHERE r.category NOT IN ('governance', 'compliance')
    AND d.is_confidential = 0
    ORDER BY d.title
  `).all();

  res.render('member/onboarding', {
    title: 'Welcome — Get Started',
    gardener,
    cred,
    step,
    programInfo,
    appliedPrograms,
    volDocs,
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

// Onboarding Step 4: Program Interests
router.post('/onboarding/programs', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  let programs = req.body.programs || [];
  if (typeof programs === 'string') programs = [programs];

  if (programs.length === 0) {
    req.session.memberFlash = { type: 'error', message: 'Please select at least one program you\'re interested in.' };
    return res.redirect('/member/onboarding');
  }

  const validPrograms = VALID_PROGRAMS;
  const insert = db.prepare('INSERT OR IGNORE INTO program_applications (volunteer_id, program, status) VALUES (?, ?, \'pending\')');
  for (const prog of programs) {
    if (validPrograms.includes(prog)) {
      insert.run(gid, prog);
    }
  }

  req.session.memberFlash = { type: 'success', message: 'Program interests submitted! Your applications are pending review.' };
  res.redirect('/member/onboarding');
});

// Onboarding Step 5: Acknowledge documents
router.post('/onboarding/documents', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const acknowledged = req.body.acknowledged_docs || [];
  const docsToAck = Array.isArray(acknowledged) ? acknowledged : [acknowledged];

  // Get the volunteer-facing documents that require acknowledgment
  const volDocs = db.prepare(`
    SELECT d.id FROM board_documents d
    JOIN board_resources r ON r.document_id = d.id
    WHERE r.category NOT IN ('governance', 'compliance')
    AND d.is_confidential = 0
  `).all();
  const requiredIds = volDocs.map(d => String(d.id));

  // Check all docs are acknowledged
  const allChecked = requiredIds.length === 0 || requiredIds.every(id => docsToAck.includes(id));
  if (!allChecked) {
    req.session.memberFlash = { type: 'error', message: 'Please acknowledge all documents before continuing.' };
    return res.redirect('/member/onboarding');
  }

  // Record each acknowledgment
  const ip = req.ip || req.connection.remoteAddress;
  const insertAck = db.prepare(`INSERT OR IGNORE INTO document_acknowledgments (document_id, user_type, user_id, ip_address) VALUES (?, 'volunteer', ?, ?)`);
  for (const docId of docsToAck) {
    insertAck.run(parseInt(docId), gid, ip);
  }

  db.prepare('UPDATE member_credentials SET documents_acknowledged = 1 WHERE id = ?').run(req.session.memberId);
  req.session.memberFlash = { type: 'success', message: 'Documents acknowledged. Welcome to ICAN!' };
  res.redirect('/member/onboarding');
});

// Onboarding Step 6: Complete onboarding
router.post('/onboarding/complete', requireMember, (req, res) => {
  const db = req.app.locals.db;

  db.prepare("UPDATE member_credentials SET onboarding_completed = 1, onboarding_completed_at = datetime('now') WHERE id = ?").run(req.session.memberId);
  // Auto-subscribe to newsletter
  const cred = db.prepare('SELECT mc.email, g.first_name, g.last_name FROM member_credentials mc JOIN gardeners g ON mc.gardener_id = g.id WHERE mc.id = ?').get(req.session.memberId);
  if (cred && cred.email) {
    try { db.prepare("INSERT OR IGNORE INTO subscribers (email, name, source) VALUES (?, ?, 'volunteer')").run(cred.email, [cred.first_name, cred.last_name].filter(Boolean).join(' ') || null); } catch (e) { /* ignore */ }
  }
  req.session.memberOnboardingCompleted = 1;
  req.session.memberFlash = { type: 'success', message: 'Welcome! Your onboarding is complete.' };
  res.redirect('/member');
});

// ── MY DASHBOARD ────────────────────────────────────────────
router.get('/', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const memberId = req.session.memberId;

  const gardener = db.prepare(`
    SELECT g.*, gs.name as site_name, gsn.name as season_name
    FROM gardeners g
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    LEFT JOIN garden_seasons gsn ON g.season_id = gsn.id
    WHERE g.id = ?
  `).get(gid);

  // Get assigned programs
  const programs = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(gid).map(p => p.program);

  // Get pending applications
  const pendingApplications = db.prepare("SELECT program, created_at FROM program_applications WHERE volunteer_id = ? AND status = 'pending' ORDER BY created_at DESC").all(gid);

  // Compute stats across ALL programs
  let stats = { totalLbs: 0, totalHrs: 0, totalDonatedLbs: 0, awardCount: 0, harvestRank: 0, hoursRank: 0, totalGardeners: 0 };
  let recentHarvests = [];
  let recentHours = [];
  let awards = [];

  // Total hours across ALL programs for this volunteer
  stats.totalHrs = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ?").get(gid).c;

  // Recent hours from ALL programs
  recentHours = db.prepare("SELECT * FROM garden_hours WHERE gardener_id = ? ORDER BY work_date DESC LIMIT 10").all(gid);

  // Hours per program
  const hoursByProgram = {};
  const hbp = db.prepare("SELECT program, COALESCE(SUM(hours), 0) as total FROM garden_hours WHERE gardener_id = ? GROUP BY program").all(gid);
  for (const h of hbp) { hoursByProgram[h.program] = h.total; }

  if (programs.includes('victory_garden')) {
    stats.totalLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ?").get(gid).c;
    stats.totalDonatedLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ? AND donated = 1").get(gid).c;
    stats.awardCount = db.prepare("SELECT COUNT(*) as c FROM garden_awards WHERE gardener_id = ?").get(gid).c;
    recentHarvests = db.prepare("SELECT * FROM garden_harvests WHERE gardener_id = ? ORDER BY harvest_date DESC LIMIT 10").all(gid);
    awards = db.prepare("SELECT a.*, s.name as season_name FROM garden_awards a LEFT JOIN garden_seasons s ON a.season_id = s.id WHERE a.gardener_id = ? ORDER BY a.created_at DESC").all(gid);
  }

  // ── Premium Dashboard Data ──

  // Upcoming events (next 5)
  const upcomingEvents = db.prepare(`
    SELECT * FROM events WHERE event_date >= date('now') AND is_public = 1
    ORDER BY event_date ASC LIMIT 5
  `).all();

  // Unread mailbox count
  const memberProgs = programs;
  const progPlaceholders = memberProgs.length > 0 ? memberProgs.map(() => '?').join(',') : "''";
  const unreadMail = db.prepare(`
    SELECT COUNT(*) as c FROM member_messages m
    WHERE (m.target_program IS NULL OR m.target_program IN (${progPlaceholders}))
    AND m.id NOT IN (SELECT message_id FROM member_message_reads WHERE member_id = ?)
  `).get(...memberProgs, memberId).c;

  // Hours this month
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStr = monthStart.toISOString().split('T')[0];
  const hoursThisMonth = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ? AND work_date >= ?").get(gid, monthStr).c;

  // Log streak (consecutive days with hour entries)
  const recentDays = db.prepare("SELECT DISTINCT work_date FROM garden_hours WHERE gardener_id = ? ORDER BY work_date DESC LIMIT 60").all(gid).map(r => r.work_date);
  let logStreak = 0;
  if (recentDays.length > 0) {
    // Count how many of the last 7-day windows have at least one entry
    const today = new Date();
    for (let w = 0; w < 12; w++) {
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() - w * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);
      const ws = weekStart.toISOString().split('T')[0];
      const we = weekEnd.toISOString().split('T')[0];
      const hasEntry = recentDays.some(d => d >= ws && d <= we);
      if (hasEntry) logStreak++; else break;
    }
  }

  // Volunteer hours rank
  const allVolunteerHours = db.prepare(`
    SELECT gardener_id, COALESCE(SUM(hours), 0) as total
    FROM garden_hours GROUP BY gardener_id ORDER BY total DESC
  `).all();
  const myRank = allVolunteerHours.findIndex(v => v.gardener_id === gid) + 1;
  const totalVolunteers = allVolunteerHours.length;

  // Member since date
  const credInfo = db.prepare('SELECT created_at FROM member_credentials WHERE id = ?').get(memberId);
  const memberSince = credInfo ? credInfo.created_at : gardener.joined_date;

  // Recent announcements (from member_messages of type announcement)
  const recentAnnouncements = db.prepare(`
    SELECT m.*, mr.read_at
    FROM member_messages m
    LEFT JOIN member_message_reads mr ON mr.message_id = m.id AND mr.member_id = ?
    WHERE m.message_type IN ('announcement', 'newsletter')
    AND (m.target_program IS NULL OR m.target_program IN (${progPlaceholders}))
    ORDER BY m.created_at DESC LIMIT 3
  `).all(memberId, ...memberProgs);

  res.render('member/dashboard', {
    title: 'My Dashboard',
    gardener,
    programs,
    pendingApplications,
    programInfo: PROGRAM_INFO,
    stats,
    recentHarvests,
    recentHours,
    awards,
    hoursByProgram,
    upcomingEvents,
    unreadMail,
    hoursThisMonth,
    logStreak,
    myRank,
    totalVolunteers,
    memberSince,
    recentAnnouncements,
    layout: 'member/layout'
  });
});

// ── MY PROGRAMS ─────────────────────────────────────────────
router.get('/programs', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;

  const activePrograms = db.prepare('SELECT program, assigned_at FROM volunteer_programs WHERE volunteer_id = ? ORDER BY assigned_at').all(gid);
  const pendingApps = db.prepare("SELECT program, created_at FROM program_applications WHERE volunteer_id = ? AND status = 'pending'").all(gid);
  const deniedApps = db.prepare("SELECT program, created_at, note FROM program_applications WHERE volunteer_id = ? AND status = 'denied'").all(gid);

  // Determine which programs are available to apply for
  const activeKeys = activePrograms.map(p => p.program);
  const pendingKeys = pendingApps.map(p => p.program);
  const allKeys = Object.keys(PROGRAM_INFO);
  const availablePrograms = allKeys.filter(k => !activeKeys.includes(k) && !pendingKeys.includes(k));

  // Program-specific stats — hours for ALL programs, plus garden-specific stats
  const programStats = {};
  const hoursByProg = db.prepare("SELECT program, COALESCE(SUM(hours), 0) as total, COUNT(*) as entries FROM garden_hours WHERE gardener_id = ? GROUP BY program").all(gid);
  for (const h of hoursByProg) {
    programStats[h.program] = programStats[h.program] || {};
    programStats[h.program].totalHrs = h.total;
    programStats[h.program].hourEntries = h.entries;
  }
  // Ensure all active programs have a stats object
  for (const k of activeKeys) {
    if (!programStats[k]) programStats[k] = { totalHrs: 0, hourEntries: 0 };
  }
  if (activeKeys.includes('victory_garden')) {
    programStats.victory_garden.totalLbs = db.prepare('SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ?').get(gid).c;
    programStats.victory_garden.awardCount = db.prepare('SELECT COUNT(*) as c FROM garden_awards WHERE gardener_id = ?').get(gid).c;
    programStats.victory_garden.harvestCount = db.prepare('SELECT COUNT(*) as c FROM garden_harvests WHERE gardener_id = ?').get(gid).c;
  }

  res.render('member/programs', {
    title: 'My Programs',
    activePrograms,
    pendingApps,
    deniedApps,
    availablePrograms,
    programInfo: PROGRAM_INFO,
    programStats,
    layout: 'member/layout'
  });
});

// ── APPLY FOR PROGRAM (post-onboarding) ─────────────────────
router.post('/apply-program', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const program = req.body.program;

  const validPrograms = VALID_PROGRAMS;
  if (!program || !validPrograms.includes(program)) {
    req.session.memberFlash = { type: 'error', message: 'Invalid program.' };
    return res.redirect('/member/programs');
  }

  // Check if already assigned
  const existing = db.prepare('SELECT id FROM volunteer_programs WHERE volunteer_id = ? AND program = ?').get(gid, program);
  if (existing) {
    req.session.memberFlash = { type: 'error', message: 'You are already assigned to this program.' };
    return res.redirect('/member/programs');
  }

  // Check if already has a pending application
  const pendingApp = db.prepare("SELECT id FROM program_applications WHERE volunteer_id = ? AND program = ? AND status = 'pending'").get(gid, program);
  if (pendingApp) {
    req.session.memberFlash = { type: 'error', message: 'You already have a pending application for this program.' };
    return res.redirect('/member/programs');
  }

  db.prepare("INSERT INTO program_applications (volunteer_id, program, status) VALUES (?, ?, 'pending')").run(gid, program);
  req.session.memberFlash = { type: 'success', message: 'Application submitted! A coordinator will review it soon.' };
  res.redirect('/member/programs');
});

// ── LEADERBOARD ─────────────────────────────────────────────
router.get('/leaderboard', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const programFilter = req.query.program || '';

  const harvestLeaders = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, gs.name as site_name,
           COALESCE(SUM(h.pounds), 0) as total_lbs
    FROM gardeners g
    INNER JOIN garden_harvests h ON g.id = h.gardener_id
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    WHERE g.status = 'active'
    GROUP BY g.id HAVING total_lbs > 0 ORDER BY total_lbs DESC
  `).all();

  let hoursWhere = "WHERE g.status = 'active'";
  const hoursParams = [];
  if (programFilter && VALID_PROGRAMS.includes(programFilter)) {
    hoursWhere += ' AND vh.program = ?';
    hoursParams.push(programFilter);
  }

  const hoursLeaders = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, gs.name as site_name,
           COALESCE(SUM(vh.hours), 0) as total_hrs
    FROM gardeners g
    INNER JOIN garden_hours vh ON g.id = vh.gardener_id
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    ${hoursWhere}
    GROUP BY g.id HAVING total_hrs > 0 ORDER BY total_hrs DESC
  `).all(...hoursParams);

  res.render('member/leaderboard', {
    title: 'Leaderboard',
    harvestLeaders,
    hoursLeaders,
    myId: gid,
    programFilter,
    programInfo: PROGRAM_INFO,
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

// ── MY HARVESTS (full history + pagination) ─────────────────
router.get('/my-harvests', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { season, page: pageStr } = req.query;
  const page = Math.max(1, parseInt(pageStr) || 1);
  const perPage = 20;

  let where = 'WHERE gardener_id = ?';
  const params = [gid];
  if (season) { where += ' AND season_id = ?'; params.push(season); }

  const totalCount = db.prepare(`SELECT COUNT(*) as c FROM garden_harvests ${where}`).get(...params).c;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const offset = (page - 1) * perPage;

  const harvests = db.prepare(`SELECT gh.*, gs.name as season_name FROM garden_harvests gh LEFT JOIN garden_seasons gs ON gh.season_id = gs.id ${where} ORDER BY gh.harvest_date DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset);

  const totalLbs = db.prepare(`SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests ${where}`).get(...params).c;
  const totalDonatedLbs = db.prepare(`SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests ${where} AND donated = 1`).get(...params).c;

  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();

  // Monthly breakdown
  const monthlyData = db.prepare(`
    SELECT strftime('%Y-%m', harvest_date) as month, COALESCE(SUM(pounds), 0) as total, COUNT(*) as entries
    FROM garden_harvests ${where} GROUP BY month ORDER BY month DESC
  `).all(...params);

  res.render('member/my-harvests', {
    title: 'My Harvests',
    harvests,
    totalLbs,
    totalDonatedLbs,
    totalCount,
    seasons,
    monthlyData,
    filters: { season: season || '' },
    page,
    totalPages,
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

  // Validation
  const lbs = parseFloat(pounds);
  if (!lbs || lbs <= 0) {
    req.session.memberFlash = { type: 'error', message: 'Pounds must be greater than zero.' };
    return res.redirect('/member/log-harvest');
  }
  if (lbs > 500) {
    req.session.memberFlash = { type: 'error', message: 'Pounds cannot exceed 500. Please double-check your entry.' };
    return res.redirect('/member/log-harvest');
  }
  if (!harvest_date) {
    req.session.memberFlash = { type: 'error', message: 'Harvest date is required.' };
    return res.redirect('/member/log-harvest');
  }
  const today = new Date().toISOString().split('T')[0];
  if (harvest_date > today) {
    req.session.memberFlash = { type: 'error', message: 'Harvest date cannot be in the future.' };
    return res.redirect('/member/log-harvest');
  }
  if (!crop || !crop.trim()) {
    req.session.memberFlash = { type: 'error', message: 'Crop name is required.' };
    return res.redirect('/member/log-harvest');
  }

  try {
    db.prepare("INSERT INTO garden_harvests (gardener_id, season_id, harvest_date, crop, pounds, donated, donated_to, donation_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(gid, season_id || null, harvest_date, crop.trim(), lbs, donated ? 1 : 0, donated_to || null, notes || null);
    req.session.memberFlash = { type: 'success', message: 'Harvest logged successfully.' };
  } catch (err) {
    req.session.memberFlash = { type: 'error', message: 'Failed to log harvest.' };
  }
  res.redirect('/member');
});

// ── SELF-REPORTING: LOG VOLUNTEER HOURS (ALL PROGRAMS) ──────
router.get('/log-hours', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const seasons = db.prepare("SELECT * FROM garden_seasons WHERE status = 'active' ORDER BY year DESC").all();
  const memberPrograms = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(gid).map(p => p.program);
  const selectedProgram = req.query.program || '';
  res.render('member/log-hours', {
    title: 'Log Hours',
    seasons,
    memberPrograms,
    selectedProgram,
    programInfo: PROGRAM_INFO,
    layout: 'member/layout'
  });
});

router.post('/log-hours', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { program, season_id, work_date, hours, activity, notes } = req.body;
  // Validate the volunteer belongs to this program
  const memberPrograms = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(gid).map(p => p.program);
  if (!program || !memberPrograms.includes(program)) {
    req.session.memberFlash = { type: 'error', message: 'Please select a valid program.' };
    return res.redirect('/member/log-hours');
  }

  // Validation
  const hrs = parseFloat(hours);
  if (!hrs || hrs <= 0) {
    req.session.memberFlash = { type: 'error', message: 'Hours must be greater than zero.' };
    return res.redirect('/member/log-hours');
  }
  if (hrs > 24) {
    req.session.memberFlash = { type: 'error', message: 'Hours cannot exceed 24 in a single entry.' };
    return res.redirect('/member/log-hours');
  }
  if (!work_date) {
    req.session.memberFlash = { type: 'error', message: 'Work date is required.' };
    return res.redirect('/member/log-hours');
  }
  const today = new Date().toISOString().split('T')[0];
  if (work_date > today) {
    req.session.memberFlash = { type: 'error', message: 'Work date cannot be in the future.' };
    return res.redirect('/member/log-hours');
  }

  try {
    db.prepare("INSERT INTO garden_hours (gardener_id, program, season_id, work_date, hours, activity, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(gid, program, (program === 'victory_garden' && season_id) ? season_id : null, work_date, hrs, activity || null, notes || null);
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
  const memberId = req.session.memberId;
  const gardener = db.prepare('SELECT * FROM gardeners WHERE id = ?').get(gid);
  const cred = db.prepare('SELECT email, created_at FROM member_credentials WHERE gardener_id = ?').get(gid);
  const programs = db.prepare('SELECT program, assigned_at FROM volunteer_programs WHERE volunteer_id = ? ORDER BY assigned_at').all(gid);

  const programLabels = {
    victory_garden: 'Victory Garden',
    legislative: 'Legislative Action',
    outreach: 'Community Outreach',
    fundraising: 'Fundraising',
    communications: 'Communications',
    membership: 'Membership'
  };

  // Stats for milestones
  const totalHrs = db.prepare('SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ?').get(gid).c;
  const totalEntries = db.prepare('SELECT COUNT(*) as c FROM garden_hours WHERE gardener_id = ?').get(gid).c;
  const memberSince = cred ? cred.created_at : gardener.joined_date;

  res.render('member/profile', {
    title: 'My Profile',
    gardener,
    memberEmail: cred ? cred.email : '',
    programs,
    programLabels,
    profileStats: { totalHrs, totalEntries },
    memberSince,
    layout: 'member/layout'
  });
});

router.post('/profile', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { email: gardenerEmail, phone, address, city, state, zip, date_of_birth,
    emergency_contact_name, emergency_contact_phone, tshirt_size, skills, availability } = req.body;

  // Required field validation
  if (!phone || !phone.trim()) {
    req.session.memberFlash = { type: 'error', message: 'Phone number is required.' };
    return res.redirect('/member/profile');
  }
  if (!gardenerEmail || !gardenerEmail.trim()) {
    req.session.memberFlash = { type: 'error', message: 'Email address is required.' };
    return res.redirect('/member/profile');
  }
  if (!emergency_contact_name || !emergency_contact_name.trim()) {
    req.session.memberFlash = { type: 'error', message: 'Emergency contact name is required.' };
    return res.redirect('/member/profile');
  }
  if (!emergency_contact_phone || !emergency_contact_phone.trim()) {
    req.session.memberFlash = { type: 'error', message: 'Emergency contact phone is required.' };
    return res.redirect('/member/profile');
  }

  db.prepare(`UPDATE gardeners SET email = ?, phone = ?, address = ?, city = ?, state = ?, zip = ?,
    date_of_birth = ?, emergency_contact_name = ?, emergency_contact_phone = ?,
    tshirt_size = ?, skills = ?, availability = ? WHERE id = ?`)
    .run(gardenerEmail.trim(), phone.trim(), address || null, city || null, state || null, zip || null,
      date_of_birth || null, emergency_contact_name.trim(), emergency_contact_phone.trim(),
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

// ── MAILBOX ─────────────────────────────────────────────────
router.get('/mailbox', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const memberId = req.session.memberId;
  const gid = req.session.memberGardenerId;
  const memberProgs = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(gid).map(r => r.program);
  const { search, type, from, to } = req.query;

  let messages = db.prepare(`
    SELECT m.*, mr.read_at
    FROM member_messages m
    LEFT JOIN member_message_reads mr ON mr.message_id = m.id AND mr.member_id = ?
    WHERE m.target_program IS NULL OR m.target_program IN (${memberProgs.map(() => '?').join(',') || "''"})
    ORDER BY m.created_at DESC
  `).all(memberId, ...memberProgs);

  // Apply client-side filters
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    messages = messages.filter(m => (m.subject || '').toLowerCase().includes(q) || (m.body || '').toLowerCase().includes(q));
  }
  if (type) {
    messages = messages.filter(m => m.message_type === type);
  }
  if (from) {
    messages = messages.filter(m => m.created_at >= from);
  }
  if (to) {
    messages = messages.filter(m => m.created_at.split('T')[0] <= to || m.created_at.split(' ')[0] <= to);
  }

  res.render('member/mailbox', {
    title: 'Mailbox',
    messages,
    filters: { search: search || '', type: type || '', from: from || '', to: to || '' },
    layout: 'member/layout'
  });
});

router.get('/mailbox/:id', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const memberId = req.session.memberId;
  const message = db.prepare('SELECT * FROM member_messages WHERE id = ?').get(req.params.id);
  if (!message) {
    req.session.memberFlash = { type: 'error', message: 'Message not found.' };
    return res.redirect('/member/mailbox');
  }
  // Mark as read
  try {
    db.prepare('INSERT OR IGNORE INTO member_message_reads (message_id, member_id) VALUES (?, ?)').run(message.id, memberId);
  } catch (e) { /* already read */ }

  const readRecord = db.prepare('SELECT read_at FROM member_message_reads WHERE message_id = ? AND member_id = ?').get(message.id, memberId);
  message.read_at = readRecord ? readRecord.read_at : null;

  res.render('member/mailbox-detail', { title: message.subject, message, layout: 'member/layout' });
});

router.post('/mailbox/:id/read', requireMember, (req, res) => {
  const db = req.app.locals.db;
  try {
    db.prepare('INSERT OR IGNORE INTO member_message_reads (message_id, member_id) VALUES (?, ?)').run(req.params.id, req.session.memberId);
  } catch (e) { /* already read */ }
  res.json({ success: true });
});

router.post('/mailbox/:id/unread', requireMember, (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM member_message_reads WHERE message_id = ? AND member_id = ?').run(req.params.id, req.session.memberId);
  req.session.memberFlash = { type: 'success', message: 'Message marked as unread.' };
  res.redirect('/member/mailbox');
});

// ── MY HOURS (full history + export) ──────────────────────
router.get('/my-hours', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { program, from, to } = req.query;

  let where = 'WHERE gardener_id = ?';
  const params = [gid];
  if (program) { where += ' AND program = ?'; params.push(program); }
  if (from) { where += ' AND work_date >= ?'; params.push(from); }
  if (to) { where += ' AND work_date <= ?'; params.push(to); }

  const hours = db.prepare(`SELECT * FROM garden_hours ${where} ORDER BY work_date DESC`).all(...params);
  const totalHrs = hours.reduce((s, h) => s + (h.hours || 0), 0);

  // Monthly breakdown
  const monthlyData = db.prepare(`
    SELECT strftime('%Y-%m', work_date) as month, COALESCE(SUM(hours), 0) as total, COUNT(*) as entries
    FROM garden_hours ${where} GROUP BY month ORDER BY month DESC
  `).all(...params);

  const memberPrograms = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(gid).map(p => p.program);

  // Year-to-date
  const ytdStart = new Date().getFullYear() + '-01-01';
  const ytdHrs = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ? AND work_date >= ?").get(gid, ytdStart).c;

  res.render('member/my-hours', {
    title: 'My Hours',
    hours,
    totalHrs,
    monthlyData,
    memberPrograms,
    programInfo: PROGRAM_INFO,
    ytdHrs,
    filters: { program: program || '', from: from || '', to: to || '' },
    layout: 'member/layout'
  });
});

// ── EXPORT CERTIFIED HOURS REPORT ─────────────────────
router.get('/my-hours/export', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const { program, from, to, format } = req.query;

  let where = 'WHERE gardener_id = ?';
  const params = [gid];
  if (program) { where += ' AND program = ?'; params.push(program); }
  if (from) { where += ' AND work_date >= ?'; params.push(from); }
  if (to) { where += ' AND work_date <= ?'; params.push(to); }

  const hours = db.prepare(`SELECT * FROM garden_hours ${where} ORDER BY work_date ASC`).all(...params);
  const gardener = db.prepare('SELECT first_name, last_name, email FROM gardeners WHERE id = ?').get(gid);
  const totalHrs = hours.reduce((s, h) => s + (h.hours || 0), 0);
  const totalEntries = hours.length;

  const certDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const volName = `${gardener.first_name} ${gardener.last_name}`;

  if (format === 'csv') {
    let csv = 'Date,Program,Hours,Activity,Notes\n';
    hours.forEach(h => {
      const progLabel = (PROGRAM_INFO[h.program] || {}).label || h.program;
      csv += `"${h.work_date}","${progLabel}",${h.hours},"${(h.activity || '').replace(/"/g, '""')}","${(h.notes || '').replace(/"/g, '""')}"\n`;
    });
    csv += `\n"TOTAL","",${totalHrs},,\n`;
    csv += `\n"Certified by: Iowa Cannabis Action Network",,,,\n`;
    csv += `"Volunteer: ${volName}",,,,\n`;
    csv += `"Report Date: ${certDate}",,,,\n`;
    csv += `"Total Hours: ${totalHrs.toFixed(1)}",,,,\n`;
    csv += `"Total Entries: ${totalEntries}",,,,\n`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ICAN_Hours_${volName.replace(/ /g, '_')}_${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csv);
  }

  // Default: render printable HTML report
  res.render('member/hours-report', {
    title: 'Certified Hours Report',
    hours,
    gardener,
    totalHrs,
    totalEntries,
    certDate,
    volName,
    programInfo: PROGRAM_INFO,
    filters: { program: program || '', from: from || '', to: to || '' },
    layout: false
  });
});

// ── EVENTS CALENDAR ───────────────────────────────────
router.get('/events', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const filter = req.query.filter || 'upcoming';

  let events;
  if (filter === 'past') {
    events = db.prepare(`SELECT * FROM events WHERE event_date < date('now') AND is_public = 1 ORDER BY event_date DESC LIMIT 20`).all();
  } else {
    events = db.prepare(`SELECT * FROM events WHERE event_date >= date('now') AND is_public = 1 ORDER BY event_date ASC`).all();
  }

  // Attach RSVP info
  const rsvps = db.prepare('SELECT event_id, status FROM event_rsvps WHERE gardener_id = ?').all(gid);
  const rsvpMap = {};
  for (const r of rsvps) { rsvpMap[r.event_id] = r.status; }

  // Attach RSVP counts per event
  const rsvpCounts = db.prepare("SELECT event_id, COUNT(*) as cnt FROM event_rsvps WHERE status = 'going' GROUP BY event_id").all();
  const countMap = {};
  for (const r of rsvpCounts) { countMap[r.event_id] = r.cnt; }

  events = events.map(e => ({ ...e, myRsvp: rsvpMap[e.id] || null, goingCount: countMap[e.id] || 0 }));

  res.render('member/events', {
    title: 'Events',
    events,
    filter,
    layout: 'member/layout'
  });
});

router.post('/events/:id/rsvp', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const eventId = req.params.id;
  const status = req.body.status;

  const event = db.prepare('SELECT id FROM events WHERE id = ? AND is_public = 1').get(eventId);
  if (!event) {
    req.session.memberFlash = { type: 'error', message: 'Event not found.' };
    return res.redirect('/member/events');
  }

  if (status === 'cancel') {
    db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND gardener_id = ?').run(eventId, gid);
    req.session.memberFlash = { type: 'success', message: 'RSVP cancelled.' };
  } else if (status === 'going' || status === 'interested') {
    db.prepare('INSERT INTO event_rsvps (event_id, gardener_id, status) VALUES (?, ?, ?) ON CONFLICT(event_id, gardener_id) DO UPDATE SET status = ?')
      .run(eventId, gid, status, status);
    req.session.memberFlash = { type: 'success', message: status === 'going' ? "You're going!" : 'Marked as interested.' };
  }

  res.redirect('/member/events' + (req.query.filter ? '?filter=' + req.query.filter : ''));
});

// ── RESOURCE CENTER ───────────────────────────────────
router.get('/resources', requireMember, (req, res) => {
  const db = req.app.locals.db;
  // Reuse board_resources that are not confidential / or create volunteer-specific resources
  // For now, show all non-confidential board resources + any volunteer-focused docs
  const resources = db.prepare(`
    SELECT * FROM board_resources WHERE category NOT IN ('governance', 'compliance')
    ORDER BY pinned DESC, created_at DESC
  `).all();

  // Also provide program-specific instructions from constants
  res.render('member/resources', {
    title: 'Resources',
    resources,
    programInfo: PROGRAM_INFO,
    layout: 'member/layout'
  });
});

// ── DOCUMENT DOWNLOADS (for volunteer resources) ─────
router.get('/resources/:id/download', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const doc = db.prepare('SELECT * FROM board_documents WHERE id = ? AND is_confidential = 0').get(req.params.id);
  if (!doc) {
    req.session.memberFlash = { type: 'error', message: 'Document not found.' };
    return res.redirect('/member/resources');
  }
  const filePath = path.join(__dirname, '..', 'uploads', 'board', doc.filename);
  if (!fs.existsSync(filePath)) {
    req.session.memberFlash = { type: 'error', message: 'File not found on server.' };
    return res.redirect('/member/resources');
  }
  res.download(filePath, doc.original_name || doc.filename);
});


// ── EDIT HOUR ENTRY (within 7 days) ──────────────────────
router.get('/hours/:id/edit', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const entry = db.prepare('SELECT * FROM garden_hours WHERE id = ? AND gardener_id = ?').get(req.params.id, gid);
  if (!entry) {
    req.session.memberFlash = { type: 'error', message: 'Hour entry not found.' };
    return res.redirect('/member/my-hours');
  }
  // Check if within 7 days
  const created = new Date(entry.log_date || entry.work_date);
  const now = new Date();
  const daysDiff = (now - created) / (1000 * 60 * 60 * 24);
  if (daysDiff > 7) {
    req.session.memberFlash = { type: 'error', message: 'Hour entries can only be edited within 7 days of creation.' };
    return res.redirect('/member/my-hours');
  }
  const memberPrograms = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(gid).map(p => p.program);
  const seasons = db.prepare("SELECT * FROM garden_seasons WHERE status = 'active' ORDER BY year DESC").all();
  res.render('member/edit-hours', {
    title: 'Edit Hours',
    entry,
    seasons,
    memberPrograms,
    programInfo: PROGRAM_INFO,
    layout: 'member/layout'
  });
});

router.post('/hours/:id/edit', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const entry = db.prepare('SELECT * FROM garden_hours WHERE id = ? AND gardener_id = ?').get(req.params.id, gid);
  if (!entry) {
    req.session.memberFlash = { type: 'error', message: 'Hour entry not found.' };
    return res.redirect('/member/my-hours');
  }
  const created = new Date(entry.log_date || entry.work_date);
  const daysDiff = (new Date() - created) / (1000 * 60 * 60 * 24);
  if (daysDiff > 7) {
    req.session.memberFlash = { type: 'error', message: 'Hour entries can only be edited within 7 days.' };
    return res.redirect('/member/my-hours');
  }
  const { work_date, hours, activity, notes } = req.body;
  const hrs = parseFloat(hours);
  if (!hrs || hrs <= 0 || hrs > 24) {
    req.session.memberFlash = { type: 'error', message: 'Hours must be between 0 and 24.' };
    return res.redirect('/member/hours/' + req.params.id + '/edit');
  }
  db.prepare('UPDATE garden_hours SET work_date = ?, hours = ?, activity = ?, notes = ? WHERE id = ? AND gardener_id = ?')
    .run(work_date || entry.work_date, hrs, activity || null, notes || null, req.params.id, gid);
  req.session.memberFlash = { type: 'success', message: 'Hour entry updated.' };
  res.redirect('/member/my-hours');
});

router.post('/hours/:id/delete', requireMember, (req, res) => {
  const db = req.app.locals.db;
  const gid = req.session.memberGardenerId;
  const entry = db.prepare('SELECT * FROM garden_hours WHERE id = ? AND gardener_id = ?').get(req.params.id, gid);
  if (!entry) {
    req.session.memberFlash = { type: 'error', message: 'Hour entry not found.' };
    return res.redirect('/member/my-hours');
  }
  const created = new Date(entry.log_date || entry.work_date);
  const daysDiff = (new Date() - created) / (1000 * 60 * 60 * 24);
  if (daysDiff > 7) {
    req.session.memberFlash = { type: 'error', message: 'Hour entries can only be deleted within 7 days.' };
    return res.redirect('/member/my-hours');
  }
  db.prepare('DELETE FROM garden_hours WHERE id = ? AND gardener_id = ?').run(req.params.id, gid);
  req.session.memberFlash = { type: 'success', message: 'Hour entry deleted.' };
  res.redirect('/member/my-hours');
});

module.exports = router;
