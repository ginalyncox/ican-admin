const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../lib/activity-log');

router.use(requireAuth);

// List messages
router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const messages = db.prepare(`
    SELECT m.*, u.name as sender_name,
      (SELECT COUNT(DISTINCT mr.member_id) FROM member_message_reads mr WHERE mr.message_id = m.id) as read_count
    FROM member_messages m
    LEFT JOIN users u ON m.sent_by = u.id
    ORDER BY m.created_at DESC
  `).all();
  const totalMembers = db.prepare('SELECT COUNT(*) as c FROM member_credentials').get().c;
  res.render('messages/index', { title: 'Messages', messages, totalMembers });
});

// Compose form
router.get('/compose', (req, res) => {
  res.render('messages/compose', { title: 'Compose Message' });
});

// Send message
router.post('/send', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { subject, body, message_type, target_program } = req.body;
  if (!subject || !body) {
    req.session.flash = { type: 'error', message: 'Subject and body are required.' };
    return res.redirect('/admin/messages/compose');
  }
  try {
    db.prepare('INSERT INTO member_messages (subject, body, message_type, target_program, sent_by) VALUES (?, ?, ?, ?, ?)').run(
      subject, body, message_type || 'general', target_program || null, req.session.userId
    );
    logActivity(db, { userId: req.session.userId, userName: res.locals.user?.name, action: 'sent message', entityType: 'message', entityLabel: subject, details: message_type === 'general' ? 'To all members' : 'To ' + (target_program || 'all') });
    req.session.flash = { type: 'success', message: 'Message sent to all members.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to send message.' };
  }
  res.redirect('/admin/messages');
});

// Message detail with read receipts
router.get('/:id', (req, res) => {
  const db = req.app.locals.db;
  const message = db.prepare(`
    SELECT m.*, u.name as sender_name
    FROM member_messages m LEFT JOIN users u ON m.sent_by = u.id
    WHERE m.id = ?
  `).get(req.params.id);
  if (!message) {
    req.session.flash = { type: 'error', message: 'Message not found.' };
    return res.redirect('/admin/messages');
  }
  const reads = db.prepare(`
    SELECT mr.read_at, g.first_name, g.last_name, mc.email
    FROM member_message_reads mr
    JOIN member_credentials mc ON mr.member_id = mc.id
    JOIN gardeners g ON mc.gardener_id = g.id
    WHERE mr.message_id = ?
    ORDER BY mr.read_at DESC
  `).all(req.params.id);
  const totalMembers = db.prepare('SELECT COUNT(*) as c FROM member_credentials').get().c;
  res.render('messages/detail', { title: message.subject, message, reads, totalMembers });
});

// Delete message
router.post('/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare('DELETE FROM member_messages WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Message deleted.' };
  res.redirect('/admin/messages');
});

module.exports = router;
