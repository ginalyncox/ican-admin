const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /admin/donations — Dashboard
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;

  const totalAll = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE status = 'completed'").get().total;
  const now = new Date();
  const monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
  const yearStart = now.getFullYear() + '-01-01';
  const totalMonth = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE status = 'completed' AND created_at >= ?").get(monthStart).total;
  const totalYear = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM donations WHERE status = 'completed' AND created_at >= ?").get(yearStart).total;
  const donationCount = db.prepare("SELECT COUNT(*) as c FROM donations WHERE status = 'completed'").get().c;

  const recent = db.prepare("SELECT * FROM donations ORDER BY created_at DESC LIMIT 50").all();

  res.render('donations/index', {
    title: 'Donations',
    totalAll,
    totalMonth,
    totalYear,
    donationCount,
    recent
  });
});

// POST /admin/donations — Manual donation entry
router.post('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { donor_name, donor_email, amount, donation_type, notes } = req.body;

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    req.session.flash = { type: 'error', message: 'Please enter a valid donation amount.' };
    return res.redirect('/admin/donations');
  }

  const amountCents = Math.round(parseFloat(amount) * 100);

  db.prepare('INSERT INTO donations (donor_name, donor_email, amount_cents, donation_type, notes, status) VALUES (?, ?, ?, ?, ?, ?)').run(
    donor_name || null,
    donor_email || null,
    amountCents,
    donation_type || 'one-time',
    notes || null,
    'completed'
  );

  req.session.flash = { type: 'success', message: 'Donation of $' + (amountCents / 100).toFixed(2) + ' recorded.' };
  res.redirect('/admin/donations');
});

module.exports = router;
