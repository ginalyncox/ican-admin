const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// ── NEWSLETTER COMPOSE ──────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const sends = db.prepare(`
    SELECT ns.*, u.name as sender_name
    FROM newsletter_sends ns
    LEFT JOIN users u ON ns.sent_by = u.id
    ORDER BY ns.sent_at DESC LIMIT 20
  `).all();
  const activeCount = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  res.render('newsletter/index', { title: 'Newsletter', sends, activeCount });
});

router.get('/compose', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const activeCount = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  res.render('newsletter/compose', { title: 'Compose Newsletter', activeCount });
});

// Preview before sending
router.post('/preview', requireRole('admin', 'editor'), (req, res) => {
  const { subject, body } = req.body;
  const db = req.app.locals.db;
  const activeCount = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  res.render('newsletter/preview', { title: 'Preview Newsletter', subject, body, activeCount });
});

// Send newsletter (uses Web3Forms as relay or logs for manual send)
router.post('/send', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { subject, body } = req.body;

  if (!subject || !body) {
    req.session.flash = { type: 'error', message: 'Subject and body are required.' };
    return res.redirect('/admin/newsletter/compose');
  }

  const subscribers = db.prepare("SELECT email, name FROM subscribers WHERE status = 'active'").all();
  const recipientCount = subscribers.length;

  if (recipientCount === 0) {
    req.session.flash = { type: 'warning', message: 'No active subscribers to send to.' };
    return res.redirect('/admin/newsletter');
  }

  // Log the send
  db.prepare('INSERT INTO newsletter_sends (subject, body, recipient_count, sent_by) VALUES (?, ?, ?, ?)').run(subject, body, recipientCount, req.session.userId);

  // Generate the recipient list as a downloadable reference
  // In production, this would integrate with an email service (Mailchimp, SendGrid, etc.)
  req.session.flash = {
    type: 'success',
    message: `Newsletter "${subject}" recorded for ${recipientCount} subscriber(s). Use the subscriber export to send via your email provider.`
  };
  res.redirect('/admin/newsletter');
});

// View a past send
router.get('/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const send = db.prepare(`
    SELECT ns.*, u.name as sender_name
    FROM newsletter_sends ns LEFT JOIN users u ON ns.sent_by = u.id
    WHERE ns.id = ?
  `).get(req.params.id);
  if (!send) { req.session.flash = { type: 'error', message: 'Newsletter not found.' }; return res.redirect('/admin/newsletter'); }
  res.render('newsletter/detail', { title: send.subject, send });
});

router.post('/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM newsletter_sends WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Newsletter record deleted.' };
  res.redirect('/admin/newsletter');
});

module.exports = router;
