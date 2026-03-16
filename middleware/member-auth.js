function requireMember(req, res, next) {
  if (req.session && req.session.memberId) {
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
  // Flash messages for member portal
  res.locals.memberFlash = req.session.memberFlash || null;
  delete req.session.memberFlash;
  next();
}

module.exports = { requireMember, setMemberLocals };
