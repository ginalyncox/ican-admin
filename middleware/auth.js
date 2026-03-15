function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect('/admin/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.redirect('/admin/login');
    }
    if (!roles.includes(req.session.userRole)) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this resource.',
        user: { name: req.session.userName, role: req.session.userRole },
        layout: false
      });
    }
    next();
  };
}

function setLocals(req, res, next) {
  res.locals.user = req.session.userId ? {
    id: req.session.userId,
    name: req.session.userName,
    email: req.session.userEmail,
    role: req.session.userRole
  } : null;
  res.locals.path = req.originalUrl.split('?')[0];
  next();
}

module.exports = { requireAuth, requireRole, setLocals };
