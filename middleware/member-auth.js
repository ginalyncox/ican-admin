function requireMember(req, res, next) {
  if (req.session && req.session.memberId) {
    // If onboarding not completed, redirect (but allow onboarding routes + logout)
    const onboardingPaths = ['/member/onboarding', '/member/logout', '/member/resources/'];
    const currentPath = req.originalUrl.split('?')[0];
    const isOnboardingRoute = onboardingPaths.some(p => currentPath.startsWith(p));

    if (!isOnboardingRoute && (req.session.memberMustChangePassword || !req.session.memberOnboardingCompleted)) {
      return res.redirect('/member/onboarding');
    }
    return next();
  }
  res.redirect('/login');
}

function setMemberLocals(req, res, next) {
  res.locals.member = req.session.memberId ? {
    id: req.session.memberId,
    gardenerId: req.session.memberGardenerId,
    name: req.session.memberName,
    email: req.session.memberEmail
  } : null;
  res.locals.path = req.originalUrl.split('?')[0];

  // Expose program assignments for conditional nav rendering
  if (req.session.memberId && req.session.memberGardenerId) {
    try {
      const db = req.app.locals.db;
      const programs = db.prepare('SELECT program FROM volunteer_programs WHERE volunteer_id = ?').all(req.session.memberGardenerId);
      res.locals.memberPrograms = programs.map(p => p.program);
    } catch (e) {
      res.locals.memberPrograms = [];
    }
  } else {
    res.locals.memberPrograms = [];
  }

  // Cross-portal access flags (session-based from unified login)
  res.locals.hasAdminAccess = !!req.session.userId;
  res.locals.hasDirectorAccess = !!req.session.directorId;

  // Unread message count for mailbox badge
  if (req.session.memberId && req.session.memberGardenerId) {
    try {
      const db = req.app.locals.db;
      const memberProgs = (res.locals.memberPrograms || []);
      const progPlaceholders = memberProgs.length > 0 ? memberProgs.map(() => '?').join(',') : "''";
      const unread = db.prepare(`
        SELECT COUNT(*) as c FROM member_messages m
        WHERE (m.target_program IS NULL OR m.target_program IN (${progPlaceholders}))
        AND m.id NOT IN (SELECT message_id FROM member_message_reads WHERE member_id = ?)
      `).get(...memberProgs, req.session.memberId);
      res.locals.unreadMessages = unread ? unread.c : 0;
    } catch (e) {
      res.locals.unreadMessages = 0;
    }
  } else {
    res.locals.unreadMessages = 0;
  }

  // Application status notifications (recently approved/denied)
  if (req.session.memberId && req.session.memberGardenerId) {
    try {
      const db = req.app.locals.db;
      const recentApps = db.prepare(`
        SELECT program, status, reviewed_at FROM program_applications
        WHERE volunteer_id = ? AND status IN ('approved', 'denied') AND reviewed_at IS NOT NULL
        ORDER BY reviewed_at DESC LIMIT 5
      `).all(req.session.memberGardenerId);
      res.locals.recentAppUpdates = recentApps;
    } catch (e) {
      res.locals.recentAppUpdates = [];
    }
  } else {
    res.locals.recentAppUpdates = [];
  }

  // Total notification count (unread messages + recent app decisions)
  res.locals.totalNotifications = (res.locals.unreadMessages || 0);

  // Flash messages for member portal
  res.locals.memberFlash = req.session.memberFlash || null;
  delete req.session.memberFlash;
  next();
}

module.exports = { requireMember, setMemberLocals };
