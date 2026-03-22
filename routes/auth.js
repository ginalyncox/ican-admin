const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

// ── UNIFIED LOGIN PAGE ─────────────────────────────────────
router.get('/login', (req, res) => {
  // If already authenticated, redirect to appropriate portal
  if (req.session.accountId) {
    const roles = req.session.accountRoles || [];
    if (roles.length > 1) return res.redirect('/portal-select');
    if (req.session.userId) return res.redirect('/admin');
    if (req.session.memberId) return res.redirect('/member');
    if (req.session.directorId) return res.redirect('/director');
  }
  const ge = req.app.locals.googleAuthEnabled || false;
  const errParam = req.query.error;
  let error = null;
  if (errParam === 'google_denied') error = 'Google sign-in was denied or cancelled.';
  if (errParam === 'no_account') error = 'No ICAN account found for that Google email.';
  res.render('unified-login', { title: 'Sign In — ICAN', error, googleEnabled: ge, layout: false });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;

  if (!email || !password) {
    return res.render('unified-login', { title: 'Sign In — ICAN', error: 'Email and password are required.', googleEnabled: req.app.locals.googleAuthEnabled || false, layout: false })
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Look up in unified accounts table
  const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(normalizedEmail);
  if (!account) {
    return res.render('unified-login', { title: 'Sign In — ICAN', error: 'Invalid email or password.', googleEnabled: req.app.locals.googleAuthEnabled || false, layout: false })
  }

  if (account.status === 'locked') {
    return res.render('unified-login', { title: 'Sign In — ICAN', error: 'Your account has been locked. Please contact the administrator.', googleEnabled: req.app.locals.googleAuthEnabled || false, layout: false })
  }

  if (account.status !== 'active') {
    return res.render('unified-login', { title: 'Sign In — ICAN', error: 'Your account is not active. Please contact the administrator.', googleEnabled: req.app.locals.googleAuthEnabled || false, layout: false })
  }

  const valid = bcrypt.compareSync(password, account.password_hash);
  if (!valid) {
    return res.render('unified-login', { title: 'Sign In — ICAN', error: 'Invalid email or password.', googleEnabled: req.app.locals.googleAuthEnabled || false, layout: false })
  }

  // Update last login
  db.prepare("UPDATE accounts SET last_login = datetime('now') WHERE id = ?").run(account.id);

  const roles = JSON.parse(account.roles || '[]');

  // Store the account ID and roles in session
  req.session.accountId = account.id;
  req.session.accountEmail = account.email;
  req.session.accountName = account.name;
  req.session.accountRoles = roles;

  // Auto-activate ALL portals the user has access to at login time
  // This way they can switch between portals without re-authenticating

  // ── Admin session vars ──
  if (roles.includes('admin') && account.admin_user_id) {
    const adminUser = db.prepare('SELECT * FROM users WHERE id = ?').get(account.admin_user_id);
    if (adminUser) {
      req.session.userId = adminUser.id;
      req.session.userName = adminUser.name;
      req.session.userEmail = adminUser.email;
      req.session.userRole = adminUser.role;
    }
  }

  // ── Volunteer session vars ──
  if (roles.includes('volunteer') && account.gardener_id) {
    const mc = db.prepare(`
      SELECT mc.*, g.first_name, g.last_name, g.status as gardener_status
      FROM member_credentials mc
      JOIN gardeners g ON mc.gardener_id = g.id
      WHERE mc.gardener_id = ?
    `).get(account.gardener_id);
    if (mc && mc.gardener_status === 'active') {
      req.session.memberId = mc.id;
      req.session.memberGardenerId = mc.gardener_id;
      req.session.memberName = mc.first_name + ' ' + mc.last_name;
      req.session.memberEmail = mc.email;
      req.session.memberMustChangePassword = mc.must_change_password;
      req.session.memberOnboardingCompleted = mc.onboarding_completed;
    }
  }

  // ── Director session vars ──
  if (roles.includes('director') && account.board_member_id) {
    const bm = db.prepare('SELECT * FROM board_members WHERE id = ?').get(account.board_member_id);
    if (bm && (bm.status === 'active' || bm.status === 'locked')) {
      req.session.directorId = bm.id;
      req.session.directorBoardMemberId = bm.id;
      req.session.directorName = bm.first_name + ' ' + bm.last_name;
      req.session.directorEmail = bm.email;
      req.session.directorTitle = bm.title;
      req.session.directorIsOfficer = bm.is_officer;
      req.session.directorOfficerTitle = bm.officer_title;
      req.session.directorMustChangePassword = bm.must_change_password;
      req.session.directorOnboardingCompleted = bm.onboarding_completed;
    }
  }

  // If user has exactly one role, go directly to that portal
  if (roles.length === 1) {
    if (roles[0] === 'admin') return res.redirect('/admin');
    if (roles[0] === 'volunteer') {
      if (req.session.memberMustChangePassword || !req.session.memberOnboardingCompleted) {
        return res.redirect('/member/onboarding');
      }
      return res.redirect('/member');
    }
    if (roles[0] === 'director') {
      if (req.session.directorMustChangePassword || !req.session.directorOnboardingCompleted) {
        return res.redirect('/director/onboarding');
      }
      return res.redirect('/director');
    }
  }

  // Multiple roles — show portal selection
  res.redirect('/portal-select');
});

// ── PORTAL SELECTION ────────────────────────────────────────
router.get('/portal-select', (req, res) => {
  if (!req.session.accountId) return res.redirect('/login');
  const roles = req.session.accountRoles || [];
  if (roles.length === 0) return res.redirect('/login');

  res.render('portal-select', {
    title: 'Choose Portal — ICAN',
    roles,
    accountName: req.session.accountName,
    layout: false
  });
});

router.post('/portal-select', (req, res) => {
  if (!req.session.accountId) return res.redirect('/login');
  const { portal } = req.body;
  const roles = req.session.accountRoles || [];

  if (portal === 'admin' && roles.includes('admin')) {
    return res.redirect('/admin');
  }
  if (portal === 'volunteer' && roles.includes('volunteer')) {
    if (req.session.memberMustChangePassword || !req.session.memberOnboardingCompleted) {
      return res.redirect('/member/onboarding');
    }
    return res.redirect('/member');
  }
  if (portal === 'director' && roles.includes('director')) {
    if (req.session.directorMustChangePassword || !req.session.directorOnboardingCompleted) {
      return res.redirect('/director/onboarding');
    }
    return res.redirect('/director');
  }

  // Invalid selection
  res.redirect('/portal-select');
});

// ── SELF-REGISTRATION ────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session.accountId) return res.redirect('/');
  res.render('register', { title: 'Create Account — ICAN', error: null, layout: false });
});

router.post('/register', (req, res) => {
  const { first_name, last_name, email, password, confirm_password } = req.body;
  const db = req.app.locals.db;

  // Validation
  if (!first_name || !last_name || !email || !password || !confirm_password) {
    return res.render('register', { title: 'Create Account — ICAN', error: 'All fields are required.', layout: false });
  }
  if (password !== confirm_password) {
    return res.render('register', { title: 'Create Account — ICAN', error: 'Passwords do not match.', layout: false });
  }
  if (password.length < 8) {
    return res.render('register', { title: 'Create Account — ICAN', error: 'Password must be at least 8 characters.', layout: false });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if email already exists
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.render('register', { title: 'Create Account — ICAN', error: 'An account with that email already exists. Try signing in instead.', layout: false });
  }

  const hash = bcrypt.hashSync(password, 10);
  const fullName = first_name.trim() + ' ' + last_name.trim();

  try {
    const tx = db.transaction(() => {
      // Create gardener (volunteer profile)
      const gardener = db.prepare(
        'INSERT INTO gardeners (first_name, last_name, email, status) VALUES (?, ?, ?, ?)'
      ).run(first_name.trim(), last_name.trim(), normalizedEmail, 'active');

      // Create member credentials
      const mc = db.prepare(
        'INSERT INTO member_credentials (gardener_id, email, password_hash, must_change_password, onboarding_completed, documents_acknowledged, agreement_signed) VALUES (?, ?, ?, 0, 0, 0, 0)'
      ).run(gardener.lastInsertRowid, normalizedEmail, hash);

      // Create unified account
      db.prepare(
        'INSERT INTO accounts (email, password_hash, name, roles, gardener_id, must_change_password, onboarding_completed, status) VALUES (?, ?, ?, ?, ?, 0, 0, ?)'
      ).run(normalizedEmail, hash, fullName, JSON.stringify(['volunteer']), gardener.lastInsertRowid, 'active');

      // Auto-subscribe to newsletter
      try {
        db.prepare("INSERT OR IGNORE INTO subscribers (email, name, source, status) VALUES (?, ?, 'registration', 'active')")
          .run(normalizedEmail, fullName);
      } catch (e) { /* ignore if subscribers table doesn't exist */ }

      return { gardenerId: gardener.lastInsertRowid, mcId: mc.lastInsertRowid };
    });

    const result = tx();

    // Auto-login
    const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(normalizedEmail);
    req.session.accountId = account.id;
    req.session.accountEmail = account.email;
    req.session.accountName = account.name;
    req.session.accountRoles = ['volunteer'];

    // Set member session vars
    req.session.memberId = result.mcId;
    req.session.memberGardenerId = result.gardenerId;
    req.session.memberName = fullName;
    req.session.memberEmail = normalizedEmail;
    req.session.memberMustChangePassword = 0;
    req.session.memberOnboardingCompleted = 0;

    // Redirect to onboarding
    res.redirect('/member/onboarding');
  } catch (err) {
    console.error('Registration error:', err);
    res.render('register', { title: 'Create Account — ICAN', error: 'Registration failed. Please try again.', layout: false });
  }
});

// ── LOGOUT ──────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
