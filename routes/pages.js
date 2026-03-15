const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// List pages
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const pages = db.prepare('SELECT p.*, u.name as editor_name FROM pages p LEFT JOIN users u ON p.updated_by = u.id ORDER BY p.title').all();
  res.render('pages/index', { title: 'Pages', pages });
});

// Edit page form
router.get('/:id/edit', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) {
    req.session.flash = { type: 'error', message: 'Page not found.' };
    return res.redirect('/admin/pages');
  }
  res.render('pages/editor', { title: 'Edit: ' + page.title, page });
});

// Update page
router.post('/:id', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { content } = req.body;
  const pageId = req.params.id;

  try {
    db.prepare('UPDATE pages SET content = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?')
      .run(content, req.session.userId, pageId);
    req.session.flash = { type: 'success', message: 'Page updated successfully.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to update page.' };
  }

  res.redirect('/admin/pages');
});

module.exports = router;
