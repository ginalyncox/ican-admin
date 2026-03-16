function requireDirector(req, res, next) {
  if (req.session && req.session.directorId) {
    return next();
  }
  res.redirect('/director/login');
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
  // Flash messages for director portal
  res.locals.directorFlash = req.session.directorFlash || null;
  delete req.session.directorFlash;
  next();
}

module.exports = { requireDirector, setDirectorLocals };
