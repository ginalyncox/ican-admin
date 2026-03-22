const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireDirector } = require('../middleware/director-auth');
const { logActivity, getRecentActivity } = require('../lib/activity-log');
const router = express.Router();

// Helper: check if current director is an officer
function requireOfficer(req, res) {
  if (!req.session.directorIsOfficer) {
    req.session.directorFlash = { type: 'error', message: 'This action is restricted to officers.' };
    return false;
  }
  return true;
}

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

  const normalizedEmail = email.toLowerCase().trim();
  const member = db.prepare(`
    SELECT * FROM board_members WHERE email = ?
  `).get(normalizedEmail);

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
  req.session.directorBoardMemberId = member.id; // same as directorId — kept for legacy template compatibility
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
  req.session.destroy(() => {
    res.redirect('/director/login');
  });
});

// ── ONBOARDING ──────────────────────────────────────────────
router.get('/onboarding', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const member = db.prepare('SELECT * FROM board_members WHERE id = ?').get(mid);
  const currentYear = new Date().getFullYear();

  // Determine current step (5 steps: password, profile, coi, documents, agreement)
  let step = 'password';
  if (!member.must_change_password) {
    step = 'profile';
    if (member.phone && member.bio) {
      step = 'coi';
      const coiFiled = db.prepare('SELECT id FROM coi_disclosures WHERE member_id = ? AND disclosure_year = ?').get(mid, currentYear);
      if (coiFiled) {
        step = 'documents';
        if (member.documents_acknowledged) {
          step = 'agreement';
          if (member.agreement_signed) {
            // All done — mark complete
          }
        }
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
// Onboarding Step 4: Acknowledge documents
router.post('/onboarding/documents', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const acknowledged = req.body.acknowledged_docs || [];
  const docsToAck = Array.isArray(acknowledged) ? acknowledged : [acknowledged];

  // Get required docs
  const keyDocs = db.prepare(`SELECT id FROM board_documents WHERE category IN ('bylaws', 'policy', 'compliance')`).all();
  const requiredIds = keyDocs.map(d => String(d.id));

  // Check all required docs are acknowledged
  const allChecked = requiredIds.every(id => docsToAck.includes(id));
  if (!allChecked) {
    req.session.directorFlash = { type: 'error', message: 'Please acknowledge all required documents before continuing.' };
    return res.redirect('/director/onboarding');
  }

  // Record each acknowledgment
  const ip = req.ip || req.connection.remoteAddress;
  const insertAck = db.prepare(`INSERT OR IGNORE INTO document_acknowledgments (document_id, user_type, user_id, ip_address) VALUES (?, 'director', ?, ?)`);
  for (const docId of docsToAck) {
    insertAck.run(parseInt(docId), mid, ip);
  }

  db.prepare('UPDATE board_members SET documents_acknowledged = 1 WHERE id = ?').run(mid);
  db.prepare("UPDATE board_members SET onboarding_completed = 1, onboarding_completed_at = datetime('now') WHERE id = ?").run(mid);
  req.session.directorOnboardingCompleted = 1;
  req.session.directorFlash = { type: 'success', message: 'Welcome aboard! Your onboarding is complete. You now have full access to the Board Portal.' };
  res.redirect('/director');
});


// Onboarding: Sign Board Commitment Agreement
router.post('/onboarding/agreement', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const member = db.prepare('SELECT * FROM board_members WHERE id = ?').get(mid);
  const { agree_terms, printed_name } = req.body;

  if (!agree_terms || !printed_name || !printed_name.trim()) {
    req.session.directorFlash = { type: 'error', message: 'You must check the agreement box and print your name.' };
    return res.redirect('/director/onboarding');
  }

  const ip = req.ip || req.connection.remoteAddress;
  const fullName = member.first_name + ' ' + member.last_name;

  const agreementText = `BOARD OF DIRECTORS COMMITMENT AGREEMENT — Iowa Cannabis Action Network, Inc.

I, ${printed_name.trim()}, accept appointment to the Board of Directors of the Iowa Cannabis Action Network, Inc. (ICAN) and commit to the following:

1. I will attend monthly board meetings (in person or remotely) and notify the Chair in advance of any absence.
2. I will serve on at least one board committee.
3. I will participate in the annual strategic planning process.
4. I will actively support ICAN's fundraising and development efforts.
5. I will file an annual Conflict of Interest disclosure.
6. I will act in the best interests of ICAN and fulfill my fiduciary duties of care, loyalty, and obedience.
7. I will maintain confidentiality of board deliberations and sensitive organizational information.
8. I will review meeting materials in advance and come prepared to participate.
9. I understand that failure to attend three consecutive meetings without notice may result in removal from the board.

Signed electronically by: ${printed_name.trim()}
Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
IP Address: ${ip}`;

  try {
    db.prepare(`
      INSERT OR REPLACE INTO signed_agreements (agreement_type, user_type, user_id, user_name, user_email, ip_address, agreement_version, agreement_text)
      VALUES ('board_commitment', 'director', ?, ?, ?, ?, 1, ?)
    `).run(mid, fullName, member.email, ip, agreementText);

    db.prepare("UPDATE board_members SET agreement_signed = 1, onboarding_completed = 1, onboarding_completed_at = datetime('now') WHERE id = ?").run(mid);
    req.session.directorOnboardingCompleted = 1;
    req.session.directorFlash = { type: 'success', message: 'Board Commitment Agreement signed. Welcome to the Board Portal!' };
  } catch (err) {
    console.error('Agreement error:', err);
    req.session.directorFlash = { type: 'error', message: 'Failed to record agreement.' };
  }
  res.redirect('/director');
});

// Legacy complete route (redirect)
router.post('/onboarding/complete', requireDirector, (req, res) => {
  res.redirect('/director/onboarding');
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

  // ── Premium dashboard data ──
  // Unread announcements
  const unreadAnnouncements = db.prepare(`
    SELECT a.id, a.title, a.priority, a.created_at, a.author_name
    FROM board_announcements a
    WHERE a.id NOT IN (SELECT announcement_id FROM board_announcement_reads WHERE member_id = ?)
    ORDER BY a.pinned DESC, a.created_at DESC LIMIT 5
  `).all(mid);

  // My action items (open + in_progress)
  const myTasks = db.prepare(`
    SELECT a.id, a.title, a.due_date, a.priority, a.status
    FROM board_action_items a
    WHERE a.assigned_to = ? AND a.status IN ('open', 'in_progress')
    ORDER BY a.due_date ASC NULLS LAST, a.priority DESC LIMIT 5
  `).all(mid);

  // Overdue tasks count
  const overdueCount = db.prepare(`
    SELECT COUNT(*) as c FROM board_action_items
    WHERE assigned_to = ? AND status IN ('open','in_progress') AND due_date < date('now')
  `).get(mid).c;

  // Open polls I haven't voted on
  const openPolls = db.prepare(`
    SELECT p.id, p.question, p.created_by_name,
      (SELECT COUNT(DISTINCT member_id) FROM board_poll_responses WHERE poll_id = p.id) as response_count
    FROM board_polls p
    WHERE p.status = 'open'
    AND p.id NOT IN (SELECT DISTINCT poll_id FROM board_poll_responses WHERE member_id = ?)
    ORDER BY p.created_at DESC LIMIT 3
  `).all(mid);

  // Recent activity
  const recentActivity = getRecentActivity(db, 10);

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
    unreadAnnouncements,
    myTasks,
    overdueCount,
    openPolls,
    recentActivity,
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

  // Get RSVP data for upcoming meetings
  const myId = req.session.directorBoardMemberId;
  const rsvpMap = {};
  try {
    const rsvps = db.prepare('SELECT meeting_id, response FROM meeting_rsvps WHERE member_id = ?').all(myId);
    for (const r of rsvps) rsvpMap[r.meeting_id] = r.response;
  } catch (e) { /* table may not exist yet */ }

  // RSVP summary per meeting
  const rsvpSummary = {};
  try {
    for (const m of upcoming) {
      rsvpSummary[m.id] = db.prepare('SELECT response, COUNT(*) as count FROM meeting_rsvps WHERE meeting_id = ? GROUP BY response').all(m.id);
    }
  } catch (e) { /* ignore */ }

  res.render('director/meetings', {
    title: 'Board Meetings',
    upcoming,
    past,
    rsvpMap,
    rsvpSummary,
    layout: 'director/layout'
  });
});

// RSVP to a meeting
router.post('/meetings/:id/rsvp', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { response, note } = req.body;
  const myId = req.session.directorBoardMemberId;
  const validResponses = ['attending', 'remote', 'declined', 'tentative'];
  if (!validResponses.includes(response)) {
    req.session.directorFlash = { type: 'error', message: 'Invalid RSVP response.' };
    return res.redirect('/director/meetings');
  }
  try {
    db.prepare(`
      INSERT INTO meeting_rsvps (meeting_id, member_id, response, note)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(meeting_id, member_id) DO UPDATE SET response = excluded.response, note = excluded.note, responded_at = datetime('now')
    `).run(req.params.id, myId, response, note || null);
    req.session.directorFlash = { type: 'success', message: 'RSVP updated.' };
  } catch (e) {
    req.session.directorFlash = { type: 'error', message: 'Failed to save RSVP.' };
  }
  const referer = req.get('Referer') || '/director/meetings';
  res.redirect(referer);
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

  // RSVP data
  let rsvps = [];
  let myRsvp = null;
  try {
    rsvps = db.prepare(`
      SELECT r.*, b.first_name, b.last_name
      FROM meeting_rsvps r JOIN board_members b ON r.member_id = b.id
      WHERE r.meeting_id = ? ORDER BY b.last_name
    `).all(req.params.id);
    myRsvp = db.prepare('SELECT response, note FROM meeting_rsvps WHERE meeting_id = ? AND member_id = ?').get(req.params.id, req.session.directorBoardMemberId);
  } catch (e) { /* table may not exist */ }

  res.render('director/meeting-detail', {
    title: meeting.title,
    meeting,
    attendance,
    votes,
    allMembers,
    rsvps,
    myRsvp,
    layout: 'director/layout'
  });
});

// Create new meeting (officers only)
router.post('/meetings', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/meetings');
  const db = req.app.locals.db;
  const { title, meeting_date, meeting_time, location, meeting_type, agenda } = req.body;

  try {
    db.prepare(`
      INSERT INTO board_meetings (title, meeting_date, meeting_time, location, meeting_type, agenda, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, meeting_date, meeting_time || null, location || null, meeting_type || 'regular', agenda || null, req.session.directorBoardMemberId);

    logActivity(db, { userId: req.session.directorBoardMemberId, userName: req.session.directorName, action: 'created', entityType: 'meeting', entityLabel: title });
    req.session.directorFlash = { type: 'success', message: 'Meeting scheduled.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to create meeting.' };
  }
  res.redirect('/director/meetings');
});

// Edit meeting (officers only)
router.get('/meetings/:id/edit', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/meetings');
  const db = req.app.locals.db;
  const meeting = db.prepare('SELECT * FROM board_meetings WHERE id = ?').get(req.params.id);
  if (!meeting) return res.redirect('/director/meetings');

  res.render('director/meeting-edit', {
    title: 'Edit Meeting — ' + meeting.title,
    meeting,
    layout: 'director/layout'
  });
});

router.post('/meetings/:id/edit', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/meetings');
  const db = req.app.locals.db;
  const { title, meeting_date, meeting_time, location, meeting_type, agenda } = req.body;

  try {
    db.prepare(`
      UPDATE board_meetings SET title = ?, meeting_date = ?, meeting_time = ?, location = ?, meeting_type = ?, agenda = ?
      WHERE id = ?
    `).run(title, meeting_date, meeting_time || null, location || null, meeting_type || 'regular', agenda || null, req.params.id);

    logActivity(db, { userId: req.session.directorBoardMemberId, userName: req.session.directorName, action: 'updated', entityType: 'meeting', entityId: parseInt(req.params.id), entityLabel: title });
    req.session.directorFlash = { type: 'success', message: 'Meeting updated.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to update meeting.' };
  }
  res.redirect('/director/meetings/' + req.params.id);
});

// Delete meeting (officers only) — cascades to agenda items, attendance, RSVPs
router.post('/meetings/:id/delete', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/meetings');
  const db = req.app.locals.db;
  const meeting = db.prepare('SELECT title FROM board_meetings WHERE id = ?').get(req.params.id);

  try {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM board_agenda_items WHERE meeting_id = ?').run(req.params.id);
      db.prepare('DELETE FROM board_attendance WHERE meeting_id = ?').run(req.params.id);
      db.prepare('DELETE FROM meeting_rsvps WHERE meeting_id = ?').run(req.params.id);
      db.prepare('DELETE FROM board_meetings WHERE id = ?').run(req.params.id);
    });
    tx();
    logActivity(db, { userId: req.session.directorBoardMemberId, userName: req.session.directorName, action: 'deleted', entityType: 'meeting', entityLabel: meeting ? meeting.title : 'Unknown' });
    req.session.directorFlash = { type: 'success', message: 'Meeting deleted.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to delete meeting.' };
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

// Approve minutes (officers only)
router.post('/meetings/:id/approve-minutes', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/meetings/' + req.params.id);
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

// Upload document (officers only)
router.post('/documents', requireDirector, upload.single('file'), (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/documents');
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
    logActivity(db, { userId: req.session.directorBoardMemberId, userName: req.session.directorName, action: 'uploaded', entityType: 'document', entityLabel: title || req.file.originalname });
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

// Delete document (officers only)
router.post('/documents/:id/delete', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/documents');
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

  // Recent meetings for the new motion form
  const recentMeetings = db.prepare(`SELECT id, title, meeting_date FROM board_meetings ORDER BY meeting_date DESC LIMIT 10`).all();

  res.render('director/votes', {
    title: 'Votes & Resolutions',
    openVotes,
    closedVotes,
    myVotes,
    recentMeetings,
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

    logActivity(db, { userId: mid, userName: req.session.directorName, action: 'voted', entityType: 'vote', entityId: parseInt(req.params.id), entityLabel: vote, details: vote });
    req.session.directorFlash = { type: 'success', message: 'Vote recorded.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to cast vote.' };
  }
  res.redirect('/director/votes');
});

// Close a vote (officers only)
router.post('/votes/:id/close', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/votes');
  const db = req.app.locals.db;
  const vote = db.prepare('SELECT * FROM board_votes WHERE id = ?').get(req.params.id);
  if (!vote) return res.redirect('/director/votes');

  const result = vote.votes_for > vote.votes_against ? 'passed' : 'failed';
  let resNum = null;
  if (result === 'passed') {
    const year = new Date().getFullYear();
    const count = db.prepare("SELECT COUNT(*) as c FROM board_votes WHERE resolution_number LIKE ?").get('ICAN-' + year + '-%').c;
    resNum = 'ICAN-' + year + '-' + String(count + 1).padStart(3, '0');
  }
  db.prepare("UPDATE board_votes SET status = ?, voted_at = datetime('now'), resolution_number = ? WHERE id = ?").run(result, resNum, req.params.id);
  req.session.directorFlash = { type: 'success', message: `Motion ${result}.` };
  res.redirect('/director/votes');
});

// Table a motion (officers only)
router.post('/votes/:id/table', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/votes');
  const db = req.app.locals.db;
  db.prepare("UPDATE board_votes SET status = 'tabled', voted_at = datetime('now') WHERE id = ?").run(req.params.id);
  req.session.directorFlash = { type: 'success', message: 'Motion tabled.' };
  res.redirect('/director/votes');
});

// Withdraw a motion (officers only)
router.post('/votes/:id/withdraw', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/votes');
  const db = req.app.locals.db;
  db.prepare("UPDATE board_votes SET status = 'withdrawn', voted_at = datetime('now') WHERE id = ?").run(req.params.id);
  req.session.directorFlash = { type: 'success', message: 'Motion withdrawn.' };
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

  // Volunteer hours by program
  let hoursByProgram = [];
  try {
    hoursByProgram = db.prepare(`
      SELECT program, COALESCE(SUM(hours), 0) as total_hours, COUNT(DISTINCT gardener_id) as volunteers
      FROM garden_hours
      WHERE log_date >= date('now', '-1 year')
      GROUP BY program ORDER BY total_hours DESC
    `).all();
  } catch (e) { /* program column may not exist */ }

  // Active board members count
  const boardMemberCount = db.prepare("SELECT COUNT(*) as c FROM board_members WHERE status = 'active'").get().c;

  res.render('director/financials', {
    title: 'Financial Overview',
    stats: { totalDonatedLbs, totalGardeners, totalSubscribers, totalSubmissions, totalVolunteerHours, totalEvents },
    harvestTrends,
    hoursByProgram,
    boardMemberCount,
    layout: 'director/layout'
  });
});

// ── BOARD CALENDAR ──────────────────────────────────────────
router.get('/calendar', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const now = new Date();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);
  const year = parseInt(req.query.year) || now.getFullYear();

  // Get meetings for the month
  const monthStr = String(month).padStart(2, '0');
  const meetings = db.prepare(`
    SELECT id, title, meeting_date, meeting_time, meeting_type, status
    FROM board_meetings
    WHERE strftime('%Y-%m', meeting_date) = ?
    ORDER BY meeting_date
  `).all(`${year}-${monthStr}`);

  // Get votes with deadlines in this month (use created_at as proxy)
  const votes = db.prepare(`
    SELECT id, motion_title, status, created_at
    FROM board_votes
    WHERE status IN ('pending', 'open')
    AND strftime('%Y-%m', created_at) = ?
  `).all(`${year}-${monthStr}`);

  // Action items with due dates this month
  const mid = req.session.directorBoardMemberId;
  let actionItems = [];
  try {
    actionItems = db.prepare(`
      SELECT id, title, due_date, priority, status, assigned_to
      FROM board_action_items
      WHERE strftime('%Y-%m', due_date) = ? AND status IN ('open', 'in_progress')
      ORDER BY due_date
    `).all(`${year}-${monthStr}`);
  } catch (e) { /* ignore */ }

  // Open polls
  let polls = [];
  try {
    polls = db.prepare(`
      SELECT id, question, created_at, status
      FROM board_polls
      WHERE status = 'open' AND strftime('%Y-%m', created_at) = ?
    `).all(`${year}-${monthStr}`);
  } catch (e) { /* ignore */ }

  // Events this month
  let events = [];
  try {
    events = db.prepare(`
      SELECT id, title, event_date, event_time
      FROM events
      WHERE strftime('%Y-%m', event_date) = ?
      ORDER BY event_date
    `).all(`${year}-${monthStr}`);
  } catch (e) { /* ignore */ }

  // COI filing deadlines (if it's January, remind about annual filing)
  const coiReminder = month === 1;

  res.render('director/calendar', {
    title: 'Board Calendar',
    month, year,
    meetings, votes,
    actionItems, polls, events,
    coiReminder,
    layout: 'director/layout'
  });
});

// ── ANNOUNCEMENTS ──────────────────────────────────────────
router.get('/announcements', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;

  const announcements = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM board_announcement_reads WHERE announcement_id = a.id) as read_count,
      (SELECT COUNT(*) FROM board_members WHERE status = 'active') as total_members,
      (SELECT 1 FROM board_announcement_reads WHERE announcement_id = a.id AND member_id = ?) as i_read
    FROM board_announcements a
    ORDER BY a.pinned DESC, a.created_at DESC
  `).all(mid);

  const unreadCount = announcements.filter(a => !a.i_read).length;

  res.render('director/announcements', {
    title: 'Announcements',
    announcements,
    unreadCount,
    layout: 'director/layout'
  });
});

// Mark announcement as read
router.post('/announcements/:id/read', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  try {
    db.prepare(`
      INSERT OR IGNORE INTO board_announcement_reads (announcement_id, member_id)
      VALUES (?, ?)
    `).run(req.params.id, mid);
  } catch (e) { /* already read */ }
  res.redirect('/director/announcements');
});

// Create announcement
router.post('/announcements', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { title, body, priority, pinned } = req.body;

  if (!title || !body) {
    req.session.directorFlash = { type: 'error', message: 'Title and body are required.' };
    return res.redirect('/director/announcements');
  }

  try {
    db.prepare(`
      INSERT INTO board_announcements (title, body, priority, pinned, author_id, author_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, body, priority || 'normal', pinned ? 1 : 0, mid, req.session.directorName);

    // Auto-mark as read by the author
    const ann = db.prepare('SELECT last_insert_rowid() as id').get();
    db.prepare('INSERT OR IGNORE INTO board_announcement_reads (announcement_id, member_id) VALUES (?, ?)').run(ann.id, mid);

    logActivity(db, { userId: mid, userName: req.session.directorName, action: 'posted', entityType: 'announcement', entityLabel: title });
    req.session.directorFlash = { type: 'success', message: 'Announcement posted.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to create announcement.' };
  }
  res.redirect('/director/announcements');
});

// Edit announcement (author or officer)
router.get('/announcements/:id/edit', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const ann = db.prepare('SELECT * FROM board_announcements WHERE id = ?').get(req.params.id);
  if (!ann || (ann.author_id !== mid && !req.session.directorIsOfficer)) {
    req.session.directorFlash = { type: 'error', message: 'You cannot edit this announcement.' };
    return res.redirect('/director/announcements');
  }
  res.render('director/announcement-edit', {
    title: 'Edit Announcement',
    announcement: ann,
    layout: 'director/layout'
  });
});

router.post('/announcements/:id/edit', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const ann = db.prepare('SELECT * FROM board_announcements WHERE id = ?').get(req.params.id);
  if (!ann || (ann.author_id !== mid && !req.session.directorIsOfficer)) {
    req.session.directorFlash = { type: 'error', message: 'You cannot edit this announcement.' };
    return res.redirect('/director/announcements');
  }
  const { title, body, priority, pinned } = req.body;
  try {
    db.prepare('UPDATE board_announcements SET title = ?, body = ?, priority = ?, pinned = ? WHERE id = ?')
      .run(title, body, priority || 'normal', pinned ? 1 : 0, req.params.id);
    req.session.directorFlash = { type: 'success', message: 'Announcement updated.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to update announcement.' };
  }
  res.redirect('/director/announcements');
});

// Delete announcement (author or officer)
router.post('/announcements/:id/delete', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const ann = db.prepare('SELECT * FROM board_announcements WHERE id = ?').get(req.params.id);
  if (ann && (ann.author_id === mid || req.session.directorIsOfficer)) {
    db.prepare('DELETE FROM board_announcements WHERE id = ?').run(req.params.id);
    req.session.directorFlash = { type: 'success', message: 'Announcement deleted.' };
  }
  res.redirect('/director/announcements');
});

// Toggle pin
router.post('/announcements/:id/pin', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const ann = db.prepare('SELECT pinned FROM board_announcements WHERE id = ?').get(req.params.id);
  if (ann) {
    db.prepare('UPDATE board_announcements SET pinned = ? WHERE id = ?').run(ann.pinned ? 0 : 1, req.params.id);
  }
  res.redirect('/director/announcements');
});

// ── ACTION ITEMS ───────────────────────────────────────────
router.get('/tasks', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const filter = req.query.filter || 'mine'; // mine, all, overdue

  let items;
  if (filter === 'all') {
    items = db.prepare(`
      SELECT a.*, m.title as meeting_title
      FROM board_action_items a
      LEFT JOIN board_meetings m ON a.meeting_id = m.id
      WHERE a.status != 'cancelled'
      ORDER BY
        CASE a.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        a.due_date ASC NULLS LAST, a.created_at DESC
    `).all();
  } else if (filter === 'overdue') {
    items = db.prepare(`
      SELECT a.*, m.title as meeting_title
      FROM board_action_items a
      LEFT JOIN board_meetings m ON a.meeting_id = m.id
      WHERE a.status IN ('open', 'in_progress') AND a.due_date < date('now')
      ORDER BY a.due_date ASC
    `).all();
  } else {
    items = db.prepare(`
      SELECT a.*, m.title as meeting_title
      FROM board_action_items a
      LEFT JOIN board_meetings m ON a.meeting_id = m.id
      WHERE a.assigned_to = ? AND a.status != 'cancelled'
      ORDER BY
        CASE a.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        a.due_date ASC NULLS LAST, a.created_at DESC
    `).all(mid);
  }

  const members = db.prepare(`SELECT id, first_name, last_name FROM board_members WHERE status = 'active' ORDER BY last_name`).all();
  const meetings = db.prepare(`SELECT id, title, meeting_date FROM board_meetings ORDER BY meeting_date DESC LIMIT 10`).all();

  // Stats
  const myOpen = db.prepare(`SELECT COUNT(*) as c FROM board_action_items WHERE assigned_to = ? AND status IN ('open','in_progress')`).get(mid).c;
  const myOverdue = db.prepare(`SELECT COUNT(*) as c FROM board_action_items WHERE assigned_to = ? AND status IN ('open','in_progress') AND due_date < date('now')`).get(mid).c;
  const totalOpen = db.prepare(`SELECT COUNT(*) as c FROM board_action_items WHERE status IN ('open','in_progress')`).get().c;

  res.render('director/tasks', {
    title: 'Action Items',
    items,
    members,
    meetings,
    filter,
    stats: { myOpen, myOverdue, totalOpen },
    layout: 'director/layout'
  });
});

// Create action item
router.post('/tasks', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { title, description, assigned_to, meeting_id, due_date, priority } = req.body;

  if (!title) {
    req.session.directorFlash = { type: 'error', message: 'Task title is required.' };
    return res.redirect('/director/tasks');
  }

  const assignee = assigned_to ? db.prepare('SELECT first_name, last_name FROM board_members WHERE id = ?').get(assigned_to) : null;
  const assigneeName = assignee ? assignee.first_name + ' ' + assignee.last_name : null;

  try {
    db.prepare(`
      INSERT INTO board_action_items (title, description, assigned_to, assigned_to_name, meeting_id, due_date, priority, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description || null, assigned_to || null, assigneeName, meeting_id || null, due_date || null, priority || 'normal', mid, req.session.directorName);
    req.session.directorFlash = { type: 'success', message: 'Action item created.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to create action item.' };
  }
  res.redirect('/director/tasks');
});

// Update action item status
router.post('/tasks/:id/status', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { status } = req.body;
  const validStatuses = ['open', 'in_progress', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    req.session.directorFlash = { type: 'error', message: 'Invalid status.' };
    return res.redirect('/director/tasks');
  }

  try {
    const task = db.prepare('SELECT title FROM board_action_items WHERE id = ?').get(req.params.id);
    if (status === 'completed') {
      db.prepare("UPDATE board_action_items SET status = ?, completed_at = datetime('now') WHERE id = ?").run(status, req.params.id);
    } else {
      db.prepare('UPDATE board_action_items SET status = ?, completed_at = NULL WHERE id = ?').run(status, req.params.id);
    }
    if (status === 'completed' && task) {
      logActivity(db, { userId: req.session.directorBoardMemberId, userName: req.session.directorName, action: 'completed', entityType: 'action_item', entityId: req.params.id, entityLabel: task.title });
    }
    req.session.directorFlash = { type: 'success', message: 'Task status updated.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to update status.' };
  }
  const referer = req.get('Referer') || '/director/tasks';
  res.redirect(referer);
});

// Delete action item
router.post('/tasks/:id/delete', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM board_action_items WHERE id = ?').run(req.params.id);
  req.session.directorFlash = { type: 'success', message: 'Action item deleted.' };
  res.redirect('/director/tasks');
});

// ── AGENDA BUILDER (within meetings) ───────────────────────
router.get('/meetings/:id/agenda', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const meeting = db.prepare('SELECT * FROM board_meetings WHERE id = ?').get(req.params.id);
  if (!meeting) return res.redirect('/director/meetings');

  const agendaItems = db.prepare(`
    SELECT a.*, d.title as attachment_title, d.original_name as attachment_name
    FROM board_agenda_items a
    LEFT JOIN board_documents d ON a.attachment_id = d.id
    WHERE a.meeting_id = ?
    ORDER BY a.sort_order ASC
  `).all(req.params.id);

  const documents = db.prepare('SELECT id, title, original_name FROM board_documents ORDER BY title').all();
  const totalMinutes = agendaItems.reduce((sum, i) => sum + (i.duration_minutes || 0), 0);

  res.render('director/agenda', {
    title: 'Agenda — ' + meeting.title,
    meeting,
    agendaItems,
    documents,
    totalMinutes,
    layout: 'director/layout'
  });
});

// Add agenda item
router.post('/meetings/:id/agenda', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { title, description, presenter, duration_minutes, item_type, attachment_id } = req.body;

  // Get next sort order
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM board_agenda_items WHERE meeting_id = ?').get(req.params.id).m;

  try {
    db.prepare(`
      INSERT INTO board_agenda_items (meeting_id, sort_order, title, description, presenter, duration_minutes, item_type, attachment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, maxOrder + 1, title, description || null, presenter || null, duration_minutes ? parseInt(duration_minutes) : null, item_type || 'discussion', attachment_id || null);
    req.session.directorFlash = { type: 'success', message: 'Agenda item added.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to add agenda item.' };
  }
  res.redirect('/director/meetings/' + req.params.id + '/agenda');
});

// Reorder agenda item
router.post('/meetings/:mid/agenda/:aid/move', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { direction } = req.body;
  const items = db.prepare('SELECT id, sort_order FROM board_agenda_items WHERE meeting_id = ? ORDER BY sort_order').all(req.params.mid);
  const idx = items.findIndex(i => i.id === parseInt(req.params.aid));

  if (idx >= 0) {
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx >= 0 && swapIdx < items.length) {
      const tx = db.transaction(() => {
        db.prepare('UPDATE board_agenda_items SET sort_order = ? WHERE id = ?').run(items[swapIdx].sort_order, items[idx].id);
        db.prepare('UPDATE board_agenda_items SET sort_order = ? WHERE id = ?').run(items[idx].sort_order, items[swapIdx].id);
      });
      tx();
    }
  }
  res.redirect('/director/meetings/' + req.params.mid + '/agenda');
});

// Delete agenda item
router.post('/meetings/:mid/agenda/:aid/delete', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM board_agenda_items WHERE id = ? AND meeting_id = ?').run(req.params.aid, req.params.mid);
  req.session.directorFlash = { type: 'success', message: 'Agenda item removed.' };
  res.redirect('/director/meetings/' + req.params.mid + '/agenda');
});

// ── POLLS ──────────────────────────────────────────────────
router.get('/polls', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;

  const openPolls = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(DISTINCT member_id) FROM board_poll_responses WHERE poll_id = p.id) as response_count,
      (SELECT COUNT(*) FROM board_members WHERE status = 'active') as total_members
    FROM board_polls p
    WHERE p.status = 'open'
    ORDER BY p.created_at DESC
  `).all();

  const closedPolls = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(DISTINCT member_id) FROM board_poll_responses WHERE poll_id = p.id) as response_count
    FROM board_polls p
    WHERE p.status = 'closed'
    ORDER BY p.created_at DESC LIMIT 20
  `).all();

  // Get options + my responses for each open poll
  for (const poll of openPolls) {
    poll.options = db.prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM board_poll_responses WHERE option_id = o.id) as vote_count
      FROM board_poll_options o WHERE o.poll_id = ? ORDER BY o.sort_order
    `).all(poll.id);
    poll.myResponse = db.prepare('SELECT option_id FROM board_poll_responses WHERE poll_id = ? AND member_id = ?').all(poll.id, mid);
  }

  // Get options + results for closed polls
  for (const poll of closedPolls) {
    poll.options = db.prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM board_poll_responses WHERE option_id = o.id) as vote_count
      FROM board_poll_options o WHERE o.poll_id = ? ORDER BY o.sort_order
    `).all(poll.id);
  }

  res.render('director/polls', {
    title: 'Polls & Surveys',
    openPolls,
    closedPolls,
    layout: 'director/layout'
  });
});

// Create poll
router.post('/polls', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { question, description, poll_type, anonymous, closes_at } = req.body;
  // Options come as option_1, option_2, etc.
  const options = [];
  for (let i = 1; i <= 10; i++) {
    if (req.body['option_' + i]) options.push(req.body['option_' + i]);
  }

  if (!question || options.length < 2) {
    req.session.directorFlash = { type: 'error', message: 'Question and at least 2 options are required.' };
    return res.redirect('/director/polls');
  }

  try {
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO board_polls (question, description, poll_type, anonymous, created_by, created_by_name, closes_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(question, description || null, poll_type || 'single', anonymous ? 1 : 0, mid, req.session.directorName, closes_at || null);

      const pollId = result.lastInsertRowid;
      for (let i = 0; i < options.length; i++) {
        db.prepare('INSERT INTO board_poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)').run(pollId, options[i], i);
      }
    });
    tx();
    req.session.directorFlash = { type: 'success', message: 'Poll created.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to create poll.' };
  }
  res.redirect('/director/polls');
});

// Vote on poll
router.post('/polls/:id/vote', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const poll = db.prepare('SELECT * FROM board_polls WHERE id = ?').get(req.params.id);
  if (!poll || poll.status !== 'open') {
    req.session.directorFlash = { type: 'error', message: 'This poll is not open for voting.' };
    return res.redirect('/director/polls');
  }

  const selectedOptions = Array.isArray(req.body.option_id) ? req.body.option_id : (req.body.option_id ? [req.body.option_id] : []);

  if (selectedOptions.length === 0) {
    req.session.directorFlash = { type: 'error', message: 'Please select an option.' };
    return res.redirect('/director/polls');
  }

  try {
    const tx = db.transaction(() => {
      // Clear previous responses
      db.prepare('DELETE FROM board_poll_responses WHERE poll_id = ? AND member_id = ?').run(req.params.id, mid);
      // Insert new responses
      for (const optId of selectedOptions) {
        db.prepare('INSERT INTO board_poll_responses (poll_id, option_id, member_id) VALUES (?, ?, ?)').run(req.params.id, parseInt(optId), mid);
      }
    });
    tx();
    req.session.directorFlash = { type: 'success', message: 'Vote recorded.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to record vote.' };
  }
  res.redirect('/director/polls');
});

// Close poll
router.post('/polls/:id/close', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  db.prepare("UPDATE board_polls SET status = 'closed' WHERE id = ?").run(req.params.id);
  req.session.directorFlash = { type: 'success', message: 'Poll closed.' };
  res.redirect('/director/polls');
});

// ── RESOURCE CENTER ────────────────────────────────────────
router.get('/resources', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const category = req.query.category || '';

  let resources;
  if (category) {
    resources = db.prepare(`
      SELECT r.*, b.first_name || ' ' || b.last_name as created_by_name,
        d.title as doc_title, d.original_name as doc_filename
      FROM board_resources r
      LEFT JOIN board_members b ON r.created_by = b.id
      LEFT JOIN board_documents d ON r.document_id = d.id
      WHERE r.category = ?
      ORDER BY r.pinned DESC, r.created_at DESC
    `).all(category);
  } else {
    resources = db.prepare(`
      SELECT r.*, b.first_name || ' ' || b.last_name as created_by_name,
        d.title as doc_title, d.original_name as doc_filename
      FROM board_resources r
      LEFT JOIN board_members b ON r.created_by = b.id
      LEFT JOIN board_documents d ON r.document_id = d.id
      ORDER BY r.pinned DESC, r.created_at DESC
    `).all();
  }

  const categories = db.prepare('SELECT category, COUNT(*) as count FROM board_resources GROUP BY category ORDER BY category').all();
  const documents = db.prepare('SELECT id, title, original_name FROM board_documents ORDER BY title').all();

  res.render('director/resources', {
    title: 'Resource Center',
    resources,
    categories,
    currentCategory: category,
    documents,
    layout: 'director/layout'
  });
});

// Create resource
router.post('/resources', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const { title, description, category, resource_type, url, document_id, pinned } = req.body;

  if (!title) {
    req.session.directorFlash = { type: 'error', message: 'Title is required.' };
    return res.redirect('/director/resources');
  }

  try {
    db.prepare(`
      INSERT INTO board_resources (title, description, category, resource_type, url, document_id, pinned, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description || null, category || 'general', resource_type || 'link', url || null, document_id || null, pinned ? 1 : 0, mid);
    req.session.directorFlash = { type: 'success', message: 'Resource added.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to add resource.' };
  }
  res.redirect('/director/resources');
});

// Delete resource
router.post('/resources/:id/delete', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM board_resources WHERE id = ?').run(req.params.id);
  req.session.directorFlash = { type: 'success', message: 'Resource removed.' };
  res.redirect('/director/resources');
});

// ── COMMITTEES ─────────────────────────────────────────────
router.get('/committees', requireDirector, (req, res) => {
  const db = req.app.locals.db;

  const committees = db.prepare(`
    SELECT c.*,
      ch.first_name || ' ' || ch.last_name as chair_name,
      (SELECT COUNT(*) FROM board_committee_members WHERE committee_id = c.id) as member_count
    FROM board_committees c
    LEFT JOIN board_members ch ON c.chair_id = ch.id
    WHERE c.status = 'active'
    ORDER BY c.name
  `).all();

  // Get members for each committee
  for (const c of committees) {
    c.members = db.prepare(`
      SELECT cm.role, b.id as member_id, b.first_name, b.last_name, b.title, b.officer_title
      FROM board_committee_members cm
      JOIN board_members b ON cm.member_id = b.id
      WHERE cm.committee_id = ?
      ORDER BY cm.role DESC, b.last_name
    `).all(c.id);
  }

  const allMembers = db.prepare(`SELECT id, first_name, last_name FROM board_members WHERE status = 'active' ORDER BY last_name`).all();

  res.render('director/committees', {
    title: 'Committees',
    committees,
    allMembers,
    layout: 'director/layout'
  });
});

// Create committee (officers only)
router.post('/committees', requireDirector, (req, res) => {
  if (!requireOfficer(req, res)) return res.redirect('/director/committees');
  const db = req.app.locals.db;
  const { name, description, chair_id } = req.body;

  if (!name) {
    req.session.directorFlash = { type: 'error', message: 'Committee name is required.' };
    return res.redirect('/director/committees');
  }

  try {
    const result = db.prepare('INSERT INTO board_committees (name, description, chair_id) VALUES (?, ?, ?)').run(name, description || null, chair_id || null);
    // If chair specified, add as member with chair role
    if (chair_id) {
      db.prepare("INSERT OR IGNORE INTO board_committee_members (committee_id, member_id, role) VALUES (?, ?, 'chair')").run(result.lastInsertRowid, chair_id);
    }
    logActivity(db, { userId: req.session.directorBoardMemberId, userName: req.session.directorName, action: 'created', entityType: 'committee', entityLabel: name });
    req.session.directorFlash = { type: 'success', message: 'Committee created.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to create committee.' };
  }
  res.redirect('/director/committees');
});

// Add member to committee
router.post('/committees/:id/members', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const { member_id, role } = req.body;
  try {
    db.prepare('INSERT OR IGNORE INTO board_committee_members (committee_id, member_id, role) VALUES (?, ?, ?)').run(req.params.id, member_id, role || 'member');
    req.session.directorFlash = { type: 'success', message: 'Member added to committee.' };
  } catch (err) {
    req.session.directorFlash = { type: 'error', message: 'Failed to add member.' };
  }
  res.redirect('/director/committees');
});

// Remove member from committee
router.post('/committees/:cid/members/:mid/remove', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM board_committee_members WHERE committee_id = ? AND member_id = ?').run(req.params.cid, req.params.mid);
  req.session.directorFlash = { type: 'success', message: 'Member removed from committee.' };
  res.redirect('/director/committees');
});


// ── PRINTABLE MEETING MINUTES ────────────────────────────
router.get('/meetings/:id/print', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const meeting = db.prepare('SELECT * FROM board_meetings WHERE id = ?').get(req.params.id);
  if (!meeting) return res.redirect('/director/meetings');

  const attendance = db.prepare(`
    SELECT a.status, b.first_name, b.last_name, b.title, b.officer_title
    FROM board_attendance a
    JOIN board_members b ON a.member_id = b.id
    WHERE a.meeting_id = ?
    ORDER BY b.last_name
  `).all(req.params.id);

  const agendaItems = db.prepare(`
    SELECT * FROM board_agenda_items WHERE meeting_id = ? ORDER BY sort_order
  `).all(req.params.id);

  const votes = db.prepare(`
    SELECT v.*, b.first_name || ' ' || b.last_name as introduced_by_name
    FROM board_votes v
    LEFT JOIN board_members b ON v.introduced_by = b.id
    WHERE v.meeting_id = ?
    ORDER BY v.created_at
  `).all(req.params.id);

  // Active board count for quorum calc
  const totalActiveMembers = db.prepare("SELECT COUNT(*) as c FROM board_members WHERE status = 'active'").get().c;
  const quorumNeeded = Math.ceil(totalActiveMembers / 2);

  res.render('director/meeting-print', {
    title: 'Minutes — ' + meeting.title,
    meeting,
    attendance,
    agendaItems,
    votes,
    totalActiveMembers,
    quorumNeeded,
    layout: false
  });
});


// ── DOCUMENT LIBRARY ─────────────────────────────────────
router.get('/documents/library', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const category = req.query.category || '';

  let where = "WHERE d.audience IN ('all', 'director')";
  const params = [];
  if (category) { where += ' AND d.category = ?'; params.push(category); }

  const docs = db.prepare(`
    SELECT d.*,
      (SELECT acknowledged_at FROM document_acknowledgments 
       WHERE document_id = d.id AND user_type = 'director' AND user_id = ?) as my_ack_date,
      (SELECT document_version FROM document_acknowledgments 
       WHERE document_id = d.id AND user_type = 'director' AND user_id = ?) as my_ack_version
    FROM board_documents d
    ${where}
    ORDER BY d.is_required DESC, d.sort_order ASC, d.category ASC, d.title ASC
  `).all(mid, mid, ...params);

  docs.forEach(d => {
    d.needs_ack = d.is_required && (!d.my_ack_date || (d.ack_required_after && d.my_ack_date < d.ack_required_after));
  });

  const categories = db.prepare("SELECT DISTINCT category FROM board_documents WHERE audience IN ('all', 'director') ORDER BY category").all().map(r => r.category);
  const pendingCount = docs.filter(d => d.needs_ack).length;

  res.render('director/documents-library', {
    title: 'Document Library',
    docs,
    categories,
    currentCategory: category,
    pendingCount,
    layout: 'director/layout'
  });
});

// Acknowledge a document
router.post('/documents/:id/acknowledge', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const mid = req.session.directorBoardMemberId;
  const doc = db.prepare("SELECT * FROM board_documents WHERE id = ? AND audience IN ('all', 'director')").get(req.params.id);
  if (!doc) {
    req.session.directorFlash = { type: 'error', message: 'Document not found.' };
    return res.redirect('/director/documents/library');
  }

  const ip = req.ip || req.connection.remoteAddress;
  try {
    db.prepare('DELETE FROM document_acknowledgments WHERE document_id = ? AND user_type = ? AND user_id = ?').run(doc.id, 'director', mid);
    db.prepare(`
      INSERT INTO document_acknowledgments (document_id, user_type, user_id, ip_address, document_version)
      VALUES (?, 'director', ?, ?, ?)
    `).run(doc.id, mid, ip, doc.version || 1);
    req.session.directorFlash = { type: 'success', message: 'Document acknowledged.' };
  } catch (e) {
    req.session.directorFlash = { type: 'error', message: 'Failed to acknowledge document.' };
  }
  res.redirect('/director/documents/library');
});

// Download from library
router.get('/documents/:id/download-lib', requireDirector, (req, res) => {
  const db = req.app.locals.db;
  const doc = db.prepare("SELECT * FROM board_documents WHERE id = ? AND audience IN ('all', 'director')").get(req.params.id);
  if (!doc) {
    req.session.directorFlash = { type: 'error', message: 'Document not found.' };
    return res.redirect('/director/documents/library');
  }
  const filePath = path.join(__dirname, '..', 'uploads', 'board', doc.filename);
  if (!fs.existsSync(filePath)) {
    req.session.directorFlash = { type: 'error', message: 'File not found.' };
    return res.redirect('/director/documents/library');
  }
  res.download(filePath, doc.original_name || doc.filename);
});

module.exports = router;
