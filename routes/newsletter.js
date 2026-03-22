const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendNewsletter, buildEmailHTML } = require('../lib/email');
const router = express.Router();

// ── NEWSLETTER LIST ──────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const sends = db.prepare(`
    SELECT ns.*, u.name as sender_name
    FROM newsletter_sends ns
    LEFT JOIN users u ON ns.sent_by = u.id
    ORDER BY ns.sent_at DESC LIMIT 20
  `).all();
  const activeCount = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  const brevoConfigured = !!process.env.BREVO_API_KEY;
  res.render('newsletter/index', { title: 'Newsletter', sends, activeCount, brevoConfigured });
});

router.get('/compose', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const activeCount = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  const brevoConfigured = !!process.env.BREVO_API_KEY;
  res.render('newsletter/compose', { title: 'Compose Newsletter', activeCount, brevoConfigured });
});

// Preview before sending
router.post('/preview', requireRole('admin', 'editor'), (req, res) => {
  const { subject, body } = req.body;
  const db = req.app.locals.db;
  const activeCount = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  const htmlPreview = buildEmailHTML(subject, body);
  res.render('newsletter/preview', { title: 'Preview Newsletter', subject, body, activeCount, htmlPreview });
});

// Send newsletter
router.post('/send', requireRole('admin', 'editor'), async (req, res) => {
  const db = req.app.locals.db;
  const { subject, body } = req.body;

  if (!subject || !body) {
    req.session.flash = { type: 'error', message: 'Subject and body are required.' };
    return res.redirect('/admin/newsletter/compose');
  }

  const subscribers = db.prepare("SELECT email, name FROM subscribers WHERE status = 'active'").all();
  if (subscribers.length === 0) {
    req.session.flash = { type: 'warning', message: 'No active subscribers to send to.' };
    return res.redirect('/admin/newsletter');
  }

  if (process.env.BREVO_API_KEY) {
    // Send real emails via Brevo
    try {
      const result = await sendNewsletter(db, subject, body, req.session.userId);
      if (result.success) {
        req.session.flash = {
          type: 'success',
          message: `Newsletter "${subject}" sent to ${result.sent} subscriber(s) via email.${result.errors.length > 0 ? ' Some batches had errors.' : ''}`
        };
      } else {
        req.session.flash = {
          type: 'error',
          message: `Failed to send newsletter: ${result.error || 'Unknown error'}`
        };
      }
    } catch (err) {
      console.error('Newsletter send error:', err);
      req.session.flash = { type: 'error', message: 'Failed to send newsletter. Check server logs.' };
    }
  } else {
    // No email provider — log only (legacy behavior)
    db.prepare('INSERT INTO newsletter_sends (subject, body, recipient_count, sent_by) VALUES (?, ?, ?, ?)')
      .run(subject, body, subscribers.length, req.session.userId);

    try {
      db.prepare("INSERT INTO member_messages (subject, body, message_type, sent_by) VALUES (?, ?, 'newsletter', ?)")
        .run(subject, body, req.session.userId);
    } catch (e) { /* ignore */ }

    req.session.flash = {
      type: 'success',
      message: `Newsletter "${subject}" recorded for ${subscribers.length} subscriber(s). Set up Brevo to send real emails.`
    };
  }

  res.redirect('/admin/newsletter');
});

// Send test email to yourself
router.post('/test', requireRole('admin', 'editor'), async (req, res) => {
  const { subject, body } = req.body;
  
  if (!process.env.BREVO_API_KEY) {
    req.session.flash = { type: 'error', message: 'Brevo is not configured. Add BREVO_API_KEY to environment variables.' };
    return res.redirect('/admin/newsletter/compose');
  }

  const { sendEmail, buildEmailHTML } = require('../lib/email');
  const htmlContent = buildEmailHTML(subject || 'Test Newsletter', body || 'This is a test email.');

  const result = await sendEmail({
    to: [{ email: req.session.userEmail || 'hello@iowacannabisaction.org', name: req.session.userName || 'Admin' }],
    subject: '[TEST] ' + (subject || 'Test Newsletter'),
    htmlContent,
    textContent: body || 'This is a test email.',
  });

  if (result.success) {
    req.session.flash = { type: 'success', message: 'Test email sent to ' + (req.session.userEmail || 'hello@iowacannabisaction.org') };
  } else {
    req.session.flash = { type: 'error', message: 'Failed to send test: ' + (result.error || 'Unknown error') };
  }
  res.redirect('/admin/newsletter/compose');
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
