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

  // Sidebar badge counts (only for authenticated admin users)
  if (req.session.userId && req.app.locals.db) {
    try {
      const db = req.app.locals.db;
      res.locals.pendingAppCount = db.prepare("SELECT COUNT(*) as c FROM program_applications WHERE status = 'pending'").get().c;
      res.locals.unreadCount = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE read = 0").get().c;
    } catch (e) { /* tables may not exist yet */ }
  }
  next();
}

module.exports = { requireAuth, requireRole, setLocals };
