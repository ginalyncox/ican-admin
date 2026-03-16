const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireDirector } = require('../middleware/director-auth');
const router = express.Router();

// File upload for board documents
const boardUploadsDir = path.join(__dirname, '..', 'uploads', 'board');
if (!fs.existsSync(boardUploadsDir)) fs.mkdirSync(boardUploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, boardUploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, 'board-' + Date.now() + '-' + Math.round(Math.random() * 1000) + ext);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|png|jpg|jpeg)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// ── LOGIN ───────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.directorId) return res.redirect('/director');
  res.render('director/login', { title: 'Director Login', error: null, layout: false });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;

  if (!email || !password) {
    return res.render('director/login', { title: 'Director Login', error: 'Email and password are required.', layout: false });
  }

  const member = db.prepare(`
    SELECT * FROM board_members WHERE email = ?
  `).get(email);

  if (!member) {
    return res.render('director/login', { title: 'Director Login', error: 'Invalid email or password.', layout: false });
  }

  if (member.status === 'locked') {
    return res.render('director/login', { title: 'Director Login', error: 'Your account has been locked by an administrator. Please contact the board chair for assistance.', layout: false });
  }

  if (member.status !== 'active') {
    return res.render('director/login', { title: 'Director Login', error: 'Your account is not active. Please contact the administrator.', layout: false });
  }

  const valid = bcrypt.compareSync(password, member.password_hash);
  if (!valid) {
    return res.render('director/login', { title: 'Director Login', error: 'Invalid email or password.', layout: false });
  }

  // Update last login
  db.prepare("UPDATE board_members SET last_login = datetime('now') WHERE id = ?").run(member.id);

  req.session.directorId = member.id;
  req.session.directorBoardMemberId = member.id;
  req.session.directorName = member.first_name + ' ' + member.last_name;
  req.session.directorEmail = member.email;
  req.session.directorTitle = member.title;
  req.session.directorIsOfficer = member.is_officer;
  req.session.directorOfficerTitle = member.officer_title;
  req.session.directorMustChangePassword = member.must_change_password;
  req.session.directorOnboardingCompleted = member.onboarding_completed;

  // Redirect to onboarding if not completed
  if (member.must_change_password || !member.onboarding_completed) {
    return res.redirect('/director/onboarding');
  }

  res.redirect('/director');
});

router.get('/logout', (req, res) => {
  delete req.session.directorId;
  delete req.session.directorBoardMemberId;
  delete req.session.directorName;
  delete req.session.directorEmail;
  delete req.session.directorTitle;
  delete req.session.directorIsOfficer;
  delete req.session.directorOfficerTitle;
  res.redirect('/director/login');
});

// ── ONBOARDING ──────────────────────────────────────────────
router.get('/onboarding', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const member = db.prepare('SELECT * FROM board_members WHERE id = ?').get(mid);
  const currentYear = new Date().getFullYear();

  // Determine current step
  let step = 'password'; // Step 1: change password
  if (!member.must_change_password) {
    step = 'profile'; // Step 2: complete profile
    if (member.phone && member.bio) {
      step = 'coi'; // Step 3: file COI
      const coiFiled = db.prepare('SELECT id FROM coi_disclosures WHERE member_id = ? AND disclosure_year = ?').get(mid, currentYear);
      if (coiFiled) {
        step = 'documents'; // Step 4: review key documents
      }
    }
  }

  // If already completed, go to dashboard
  if (member.onboarding_completed) {
    return res.redirect('/director');
  }

  // Get key documents for step 4
  const keyDocs = db.prepare(`
    SELECT id, title, category, original_name FROM board_documents
    WHERE category IN ('bylaws', 'policy', 'compliance')
    ORDER BY category, title
  `).all();

  res.render('director/onboarding', {
    title: 'Welcome — Get Started',
    member,
    step,
    currentYear,
    keyDocs,
    layout: 'director/layout'
  });
});

// Onboarding Step 1: Change password
router.post('/onboarding/password', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { new_password, confirm_password } = req.body;

  if (!new_password || !confirm_password) {
    req.session.directorFlash = { type: 'error', message: 'Both password fields are required.' };
    return res.redirect('/director/onboarding');
  }
  if (new_password !== confirm_password) {
    req.session.directorFlash = { type: 'error', message: 'Passwords do not match.' };
    return res.redirect('/director/onboarding');
  }
  if (new_password.length < 8) {
    req.session.directorFlash = { type: 'error', message: 'Password must be at least 8 characters.' };
    return res.redirect('/director/onboarding');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE board_members SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, mid);
  req.session.directorMustChangePassword = 0;
  req.session.directorFlash = { type: 'success', message: 'Password updated. Now let\'s complete your profile.' };
  res.redirect('/director/onboarding');
});

// Onboarding Step 2: Complete profile
router.post('/onboarding/profile', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { phone, bio } = req.body;

  if (!phone || !bio) {
    req.session.directorFlash = { type: 'error', message: 'Phone number and bio are required to continue.' };
    return res.redirect('/director/onboarding');
  }

  db.prepare('UPDATE board_members SET phone = ?, bio = ? WHERE id = ?').run(phone, bio, mid);
  req.session.directorFlash = { type: 'success', message: 'Profile saved. Next, please file your Conflict of Interest disclosure.' };
  res.redirect('/director/onboarding');
});

// Onboarding Step 3: COI disclosure
router.post('/onboarding/coi', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { has_conflict, description, organization, nature_of_interest, mitigation_plan } = req.body;
  const currentYear = new Date().getFullYear();

  try {
    db.prepare(`
      INSERT INTO coi_disclosures (member_id, disclosure_year, has_conflict, description, organization, nature_of_interest, mitigation_plan)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mid, currentYear, has_conflict ? 1 : 0, description || null, organization || null, nature_of_interest || null, mitigation_plan || null);

    req.session.directorFlash = { type: 'success', message: 'COI disclosure filed. Last step — review key board documents.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to submit disclosure. Please try again.' };
  }
  res.redirect('/director/onboarding');
});

// Onboarding Step 4: Complete onboarding
router.post('/onboarding/complete', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;

  db.prepare("UPDATE board_members SET onboarding_completed = 1, onboarding_completed_at = datetime('now') WHERE id = ?").run(mid);
  req.session.directorOnboardingCompleted = 1;
  req.session.directorFlash = { type: 'success', message: 'Welcome aboard! Your onboarding is complete. You now have full access to the Board Portal.' };
  res.redirect('/director');
});

// ── DASHBOARD ───────────────────────────────────────────────
router.get('/', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;

  // Next upcoming meeting
  const nextMeeting = db.prepare(`
    SELECT * FROM board_meetings
    WHERE meeting_date >= date('now') AND status IN ('scheduled', 'in_progress')
    ORDER BY meeting_date ASC LIMIT 1
  `).get();

  // Recent meetings (last 5)
  const recentMeetings = db.prepare(`
    SELECT * FROM board_meetings
    ORDER BY meeting_date DESC LIMIT 5
  `).all();

  // Open votes
  const openVotes = db.prepare(`
    SELECT v.*, m.title as meeting_title
    FROM board_votes v
    LEFT JOIN board_meetings m ON v.meeting_id = m.id
    WHERE v.status IN ('pending', 'open')
    ORDER BY v.created_at DESC
  `).all();

  // My attendance rate
  const totalMeetings = db.prepare(`SELECT COUNT(*) as c FROM board_meetings WHERE status = 'completed'`).get().c;
  const myAttendance = db.prepare(`
    SELECT COUNT(*) as c FROM board_attendance
    WHERE member_id = ? AND status IN ('present', 'remote')
  `).get(mid).c;
  const attendanceRate = totalMeetings > 0 ? Math.round((myAttendance / totalMeetings) * 100) : 100;

  // My COI status (current year)
  const currentYear = new Date().getFullYear();
  const myCoi = db.prepare(`
    SELECT * FROM coi_disclosures WHERE member_id = ? AND disclosure_year = ?
  `).get(mid, currentYear);

  // Recent documents
  const recentDocs = db.prepare(`
    SELECT d.*, b.first_name || ' ' || b.last_name as uploaded_by_name
    FROM board_documents d
    LEFT JOIN board_members b ON d.uploaded_by = b.id
    ORDER BY d.created_at DESC LIMIT 5
  `).all();

  // Board member count
  const boardCount = db.prepare(`SELECT COUNT(*) as c FROM board_members WHERE status = 'active'`).get().c;

  res.render('director/dashboard', {
    title: 'Board Dashboard',
    nextMeeting,
    recentMeetings,
    openVotes,
    attendanceRate,
    totalMeetings,
    myAttendance,
    myCoi,
    currentYear,
    recentDocs,
    boardCount,
    layout: 'director/layout'
  });
});

// ── MEETINGS ────────────────────────────────────────────────
router.get('/meetings', requireDirector, (req, res) => {
  const db = req.app.locals.db;

  const upcoming = db.prepare(`
    SELECT * FROM board_meetings
    WHERE meeting_date >= date('now') AND status != 'cancelled'
    ORDER BY meeting_date ASC
  `).all();

  const past = db.prepare(`
    SELECT * FROM board_meetings
    WHERE meeting_date < date('now') OR status = 'completed'
    ORDER BY meeting_date DESC LIMIT 20
  `).all();

  res.render('director/meetings', {
    title: 'Board Meetings',
    upcoming,
    past,
    layout: 'director/layout'
  });
});

router.get('/meetings/:id', requireDirector, (req, res) => {
  const db = req.app.locals.db;

  const meeting = db.prepare(`SELECT * FROM board_meetings WHERE id = ?`).get(req.params.id);
  if (!meeting) return res.redirect('/director/meetings');

  const attendance = db.prepare(`
    SELECT a.*, b.first_name, b.last_name, b.title
    FROM board_attendance a
    JOIN board_members b ON a.member_id = b.id
    WHERE a.meeting_id = ?
    ORDER BY b.last_name
  `).all(req.params.id);

  const votes = db.prepare(`
    SELECT * FROM board_votes WHERE meeting_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id);

  // All active members for attendance
  const allMembers = db.prepare(`SELECT * FROM board_members WHERE status = 'active' ORDER BY last_name`).all();

  res.render('director/meeting-detail', {
    title: meeting.title,
    meeting,
    attendance,
    votes,
    allMembers,
    layout: 'director/layout'
  });
});

// Create new meeting (officers only)
router.post('/meetings', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { title, meeting_date, meeting_time, location, meeting_type, agenda } = req.body;

  try {
    db.prepare(`
      INSERT INTO board_meetings (title, meeting_date, meeting_time, location, meeting_type, agenda, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, meeting_date, meeting_time || null, location || null, meeting_type || 'regular', agenda || null, req.session.directorBoardMemberId);

    req.session.directorFlash = { type: 'success', message: 'Meeting scheduled.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to create meeting.' };
  }
  res.redirect('/director/meetings');
});

// Update meeting (add minutes, change status)
router.post('/meetings/:id/update', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { minutes, status, agenda } = req.body;

  try {
    if (minutes !== undefined) {
      db.prepare('UPDATE board_meetings SET minutes = ? WHERE id = ?').run(minutes, req.params.id);
    }
    if (status) {
      db.prepare('UPDATE board_meetings SET status = ? WHERE id = ?').run(status, req.params.id);
    }
    if (agenda !== undefined) {
      db.prepare('UPDATE board_meetings SET agenda = ? WHERE id = ?').run(agenda, req.params.id);
    }
    req.session.directorFlash = { type: 'success', message: 'Meeting updated.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to update meeting.' };
  }
  res.redirect('/director/meetings/' + req.params.id);
});

// Record attendance
router.post('/meetings/:id/attendance', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const meetingId = req.params.id;
  const members = db.prepare(`SELECT id FROM board_members WHERE status = 'active'`).all();

  const upsert = db.prepare(`
    INSERT INTO board_attendance (meeting_id, member_id, status)
    VALUES (?, ?, ?)
    ON CONFLICT(meeting_id, member_id) DO UPDATE SET status = excluded.status
  `);

  const tx = db.transaction(() => {
    for (const m of members) {
      const status = req.body['attendance_' + m.id] || 'absent';
      upsert.run(meetingId, m.id, status);
    }
    // Count quorum
    const present = db.prepare(`
      SELECT COUNT(*) as c FROM board_attendance
      WHERE meeting_id = ? AND status IN ('present', 'remote')
    `).get(meetingId).c;
    db.prepare('UPDATE board_meetings SET quorum_present = ? WHERE id = ?').run(present, meetingId);
  });

  try {
    tx();
    req.session.directorFlash = { type: 'success', message: 'Attendance recorded.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to record attendance.' };
  }
  res.redirect('/director/meetings/' + meetingId);
});

// Approve minutes
router.post('/meetings/:id/approve-minutes', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  db.prepare("UPDATE board_meetings SET minutes_approved = 1, minutes_approved_date = date('now') WHERE id = ?").run(req.params.id);
  req.session.directorFlash = { type: 'success', message: 'Minutes approved.' };
  res.redirect('/director/meetings/' + req.params.id);
});

// ── DOCUMENTS ───────────────────────────────────────────────
router.get('/documents', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const category = req.query.category || '';

  let docs;
  if (category) {
    docs = db.prepare(`
      SELECT d.*, b.first_name || ' ' || b.last_name as uploaded_by_name
      FROM board_documents d
      LEFT JOIN board_members b ON d.uploaded_by = b.id
      WHERE d.category = ?
      ORDER BY d.created_at DESC
    `).all(category);
  } else {
    docs = db.prepare(`
      SELECT d.*, b.first_name || ' ' || b.last_name as uploaded_by_name
      FROM board_documents d
      LEFT JOIN board_members b ON d.uploaded_by = b.id
      ORDER BY d.created_at DESC
    `).all();
  }

  const categories = db.prepare(`
    SELECT category, COUNT(*) as count FROM board_documents GROUP BY category ORDER BY category
  `).all();

  res.render('director/documents', {
    title: 'Board Documents',
    docs,
    categories,
    currentCategory: category,
    layout: 'director/layout'
  });
});

// Upload document
router.post('/documents', requireDirector, upload.single('file'), (req, res) => {
  const db = req.app.locals.db;
  const { title, description, category, is_confidential } = req.body;

  if (!req.file) {
    req.session.directorFlash = { type: 'error', message: 'Please select a file to upload.' };
    return res.redirect('/director/documents');
  }

  try {
    db.prepare(`
      INSERT INTO board_documents (title, description, category, filename, original_name, file_size, uploaded_by, is_confidential)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title || req.file.originalname,
      description || null,
      category || 'general',
      req.file.filename,
      req.file.originalname,
      req.file.size,
      req.session.directorBoardMemberId,
      is_confidential ? 1 : 0
    );
    req.session.directorFlash = { type: 'success', message: 'Document uploaded.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to upload document.' };
  }
  res.redirect('/director/documents');
});

// Download document
router.get('/documents/:id/download', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const doc = db.prepare('SELECT * FROM board_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.redirect('/director/documents');

  const filePath = path.join(boardUploadsDir, doc.filename);
  if (!fs.existsSync(filePath)) {
    req.session.directorFlash = { type: 'error', message: 'File not found.' };
    return res.redirect('/director/documents');
  }
  res.download(filePath, doc.original_name || doc.filename);
});

// Delete document
router.post('/documents/:id/delete', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const doc = db.prepare('SELECT * FROM board_documents WHERE id = ?').get(req.params.id);
  if (doc) {
    const filePath = path.join(boardUploadsDir, doc.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM board_documents WHERE id = ?').run(req.params.id);
  }
  req.session.directorFlash = { type: 'success', message: 'Document deleted.' };
  res.redirect('/director/documents');
});

// ── VOTES & RESOLUTIONS ─────────────────────────────────────
router.get('/votes', requireDirector, (req, res) => {
  const db = req.app.locals.db;

  const openVotes = db.prepare(`
    SELECT v.*, m.title as meeting_title,
           b.first_name || ' ' || b.last_name as introduced_by_name
    FROM board_votes v
    LEFT JOIN board_meetings m ON v.meeting_id = m.id
    LEFT JOIN board_members b ON v.introduced_by = b.id
    WHERE v.status IN ('pending', 'open')
    ORDER BY v.created_at DESC
  `).all();

  const closedVotes = db.prepare(`
    SELECT v.*, m.title as meeting_title,
           b.first_name || ' ' || b.last_name as introduced_by_name
    FROM board_votes v
    LEFT JOIN board_meetings m ON v.meeting_id = m.id
    LEFT JOIN board_members b ON v.introduced_by = b.id
    WHERE v.status IN ('passed', 'failed', 'tabled', 'withdrawn')
    ORDER BY v.voted_at DESC LIMIT 20
  `).all();

  // Check my votes for open items
  const mid = req.session.directorBoardMemberId;
  const myVotes = {};
  for (const v of openVotes) {
    const record = db.prepare('SELECT vote FROM board_vote_records WHERE vote_id = ? AND member_id = ?').get(v.id, mid);
    myVotes[v.id] = record ? record.vote : null;
  }

  res.render('director/votes', {
    title: 'Votes & Resolutions',
    openVotes,
    closedVotes,
    myVotes,
    layout: 'director/layout'
  });
});

// Create a new motion
router.post('/votes', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { motion_title, motion_text, motion_type, meeting_id } = req.body;

  try {
    db.prepare(`
      INSERT INTO board_votes (meeting_id, motion_title, motion_text, motion_type, status, introduced_by)
      VALUES (?, ?, ?, ?, 'open', ?)
    `).run(meeting_id || null, motion_title, motion_text, motion_type || 'resolution', req.session.directorBoardMemberId);

    req.session.directorFlash = { type: 'success', message: 'Motion introduced.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to create motion.' };
  }
  res.redirect('/director/votes');
});

// Cast a vote
router.post('/votes/:id/cast', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { vote } = req.body;

  try {
    db.prepare(`
      INSERT INTO board_vote_records (vote_id, member_id, vote)
      VALUES (?, ?, ?)
      ON CONFLICT(vote_id, member_id) DO UPDATE SET vote = excluded.vote
    `).run(req.params.id, mid, vote);

    // Recount
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN vote = 'for' THEN 1 ELSE 0 END) as votes_for,
        SUM(CASE WHEN vote = 'against' THEN 1 ELSE 0 END) as votes_against,
        SUM(CASE WHEN vote = 'abstain' THEN 1 ELSE 0 END) as votes_abstain
      FROM board_vote_records WHERE vote_id = ?
    `).get(req.params.id);

    db.prepare(`
      UPDATE board_votes SET votes_for = ?, votes_against = ?, votes_abstain = ?
      WHERE id = ?
    `).run(counts.votes_for || 0, counts.votes_against || 0, counts.votes_abstain || 0, req.params.id);

    req.session.directorFlash = { type: 'success', message: 'Vote recorded.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to cast vote.' };
  }
  res.redirect('/director/votes');
});

// Close a vote
router.post('/votes/:id/close', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const vote = db.prepare('SELECT * FROM board_votes WHERE id = ?').get(req.params.id);
  if (!vote) return res.redirect('/director/votes');

  const result = vote.votes_for > vote.votes_against ? 'passed' : 'failed';
  db.prepare("UPDATE board_votes SET status = ?, voted_at = datetime('now') WHERE id = ?").run(result, req.params.id);
  req.session.directorFlash = { type: 'success', message: `Motion ${result}.` };
  res.redirect('/director/votes');
});

// ── CONFLICT OF INTEREST ────────────────────────────────────
router.get('/coi', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const currentYear = new Date().getFullYear();

  const myDisclosures = db.prepare(`
    SELECT c.*, r.first_name || ' ' || r.last_name as reviewed_by_name
    FROM coi_disclosures c
    LEFT JOIN board_members r ON c.reviewed_by = r.id
    WHERE c.member_id = ?
    ORDER BY c.disclosure_year DESC
  `).all(mid);

  const currentYearFiled = myDisclosures.some(d => d.disclosure_year === currentYear);

  // All disclosures (visible to all board members for transparency)
  const allDisclosures = db.prepare(`
    SELECT c.*, b.first_name || ' ' || b.last_name as member_name
    FROM coi_disclosures c
    JOIN board_members b ON c.member_id = b.id
    WHERE c.disclosure_year = ?
    ORDER BY b.last_name
  `).all(currentYear);

  res.render('director/coi', {
    title: 'Conflict of Interest',
    myDisclosures,
    allDisclosures,
    currentYear,
    currentYearFiled,
    layout: 'director/layout'
  });
});

// Submit a COI disclosure
router.post('/coi', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { disclosure_year, has_conflict, description, organization, nature_of_interest, mitigation_plan } = req.body;

  try {
    db.prepare(`
      INSERT INTO coi_disclosures (member_id, disclosure_year, has_conflict, description, organization, nature_of_interest, mitigation_plan)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mid, disclosure_year || new Date().getFullYear(), has_conflict ? 1 : 0, description || null, organization || null, nature_of_interest || null, mitigation_plan || null);

    req.session.directorFlash = { type: 'success', message: 'COI disclosure submitted.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to submit disclosure.' };
  }
  res.redirect('/director/coi');
});

// ── BOARD ROSTER ────────────────────────────────────────────
router.get('/roster', requireDirector, (req, res) => {
  const db = req.app.locals.db;

  const members = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM board_attendance WHERE member_id = b.id AND status IN ('present', 'remote')) as meetings_attended,
      (SELECT COUNT(*) FROM board_meetings WHERE status = 'completed') as total_meetings
    FROM board_members b
    WHERE b.status IN ('active', 'emeritus')
    ORDER BY b.is_officer DESC, b.last_name ASC
  `).all();

  res.render('director/roster', {
    title: 'Board Roster',
    members,
    layout: 'director/layout'
  });
});

// ── MY PROFILE ──────────────────────────────────────────────
router.get('/profile', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const member = db.prepare('SELECT * FROM board_members WHERE id = ?').get(req.session.directorBoardMemberId);

  res.render('director/profile', {
    title: 'My Profile',
    member,
    layout: 'director/layout'
  });
});

router.post('/profile', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { phone, bio } = req.body;

  db.prepare('UPDATE board_members SET phone = ?, bio = ? WHERE id = ?').run(phone || null, bio || null, mid);
  req.session.directorFlash = { type: 'success', message: 'Profile updated.' };
  res.redirect('/director/profile');
});

router.post('/change-password', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    req.session.directorFlash = { type: 'error', message: 'All password fields are required.' };
    return res.redirect('/director/profile');
  }
  if (new_password !== confirm_password) {
    req.session.directorFlash = { type: 'error', message: 'New passwords do not match.' };
    return res.redirect('/director/profile');
  }
  if (new_password.length < 8) {
    req.session.directorFlash = { type: 'error', message: 'Password must be at least 8 characters.' };
    return res.redirect('/director/profile');
  }

  const member = db.prepare('SELECT * FROM board_members WHERE id = ?').get(req.session.directorBoardMemberId);
  if (!bcrypt.compareSync(current_password, member.password_hash)) {
    req.session.directorFlash = { type: 'error', message: 'Current password is incorrect.' };
    return res.redirect('/director/profile');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE board_members SET password_hash = ? WHERE id = ?').run(hash, req.session.directorBoardMemberId);
  req.session.directorFlash = { type: 'success', message: 'Password updated.' };
  res.redirect('/director/profile');
});

// ── FINANCIALS (read-only view of org financials) ───────────
router.get('/financials', requireDirector, (req, res) => {
  const db = req.app.locals.db;

  // Pull aggregate data from garden/donations/events for a financial overview
  const totalDonatedLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE donated = 1 AND donation_status = 'verified'").get().c;
  const totalGardeners = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE status = 'active'").get().c;
  const totalSubscribers = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  const totalSubmissions = db.prepare("SELECT COUNT(*) as c FROM submissions").get().c;
  const totalVolunteerHours = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours").get().c;
  const totalEvents = db.prepare("SELECT COUNT(*) as c FROM events WHERE event_date >= date('now', '-1 year')").get().c;

  // Monthly harvest trends (last 6 months)
  const harvestTrends = db.prepare(`
    SELECT strftime('%Y-%m', harvest_date) as month,
           SUM(pounds) as total_lbs,
           COUNT(*) as harvests
    FROM garden_harvests
    WHERE harvest_date >= date('now', '-6 months')
    GROUP BY month ORDER BY month
  `).all();

  res.render('director/financials', {
    title: 'Financial Overview',
    stats: { totalDonatedLbs, totalGardeners, totalSubscribers, totalSubmissions, totalVolunteerHours, totalEvents },
    harvestTrends,
    layout: 'director/layout'
  });
});

module.exports = router;
