function requireDirector(req, res, next) {
  if (req.session && req.session.directorId) {
    // Re-check that the director is still active in the database
    const db = req.app.locals.db;
    const member = db.prepare('SELECT status FROM board_members WHERE id = ?').get(req.session.directorBoardMemberId);
    if (!member || member.status !== 'active') {
      req.session.destroy(() => {
        res.redirect('/login');
      });
      return;
    }

    // If onboarding not completed, redirect (but allow onboarding routes + logout)
    const onboardingPaths = ['/director/onboarding', '/director/logout'];
    const currentPath = req.originalUrl.split('?')[0];
    const isOnboardingRoute = onboardingPaths.some(p => currentPath.startsWith(p));

    if (!isOnboardingRoute && (req.session.directorMustChangePassword || !req.session.directorOnboardingCompleted)) {
      return res.redirect('/director/onboarding');
    }
    return next();
  }
  res.redirect('/login');
}

function setDirectorLocals(req, res, next) {
  res.locals.director = req.session.directorId ? {
    id: req.session.directorId,
    boardMemberId: req.session.directorBoardMemberId,
    name: req.session.directorName,
    email: req.session.directorEmail,
    title: req.session.directorTitle,
    isOfficer: req.session.directorIsOfficer,
    officerTitle: req.session.directorOfficerTitle
  } : null;
  res.locals.path = req.originalUrl.split('?')[0];

  // Cross-portal access flags (session-based from unified login)
  res.locals.hasAdminAccess = !!req.session.userId;
  res.locals.hasVolunteerAccess = !!req.session.memberId;

  // Flash messages for director portal
  res.locals.directorFlash = req.session.directorFlash || null;
  delete req.session.directorFlash;
  next();
}

module.exports = { requireDirector, setDirectorLocals };
