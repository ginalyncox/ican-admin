function requireMember(req, res, next) {
  if (req.session && req.session.memberId) {
    // If onboarding not completed, redirect (but allow onboarding routes + logout)
    const onboardingPaths = ['/member/onboarding', '/member/logout'];
    const currentPath = req.originalUrl.split('?')[0];
    const isOnboardingRoute = onboardingPaths.some(p => currentPath.startsWith(p));

    if (!isOnboardingRoute && (req.session.memberMustChangePassword || !req.session.memberOnboardingCompleted)) {
      return res.redirect('/member/onboarding');
    }
    return next();
  }
  res.redirect('/member/login');
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

  // Check if volunteer also has director access (matching board_member email)
  if (req.session.memberEmail) {
    try {
      const db = req.app.locals.db;
      const boardMatch = db.prepare('SELECT id FROM board_members WHERE email = ? AND status IN (\'active\', \'locked\')').get(req.session.memberEmail);
      res.locals.hasDirectorAccess = !!boardMatch;
    } catch (e) {
      res.locals.hasDirectorAccess = false;
    }
  } else {
    res.locals.hasDirectorAccess = false;
  }

  // Flash messages for member portal
  res.locals.memberFlash = req.session.memberFlash || null;
  delete req.session.memberFlash;
  next();
}

module.exports = { requireMember, setMemberLocals };
