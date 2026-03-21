const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('login', { title: 'Login', error: null, layout: false });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = req.app.locals.db;

  if (!email || !password) {
    return res.render('login', { title: 'Login', error: 'Email and password are required.', layout: false });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) {
    return res.render('login', { title: 'Login', error: 'Invalid email or password.', layout: false });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.render('login', { title: 'Login', error: 'Invalid email or password.', layout: false });
  }

  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  req.session.userRole = user.role;

  res.redirect('/admin');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

module.exports = router;
