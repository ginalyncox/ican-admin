const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { loadInitiatives } = require('../lib/constants');
const router = express.Router();

// ── LIST ALL INITIATIVES ────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const initiatives = db.prepare('SELECT * FROM initiatives ORDER BY sort_order ASC').all();

  // Volunteer counts per initiative slug
  const volunteerCounts = {};
  try {
    const rows = db.prepare('SELECT program, COUNT(*) as c FROM volunteer_programs GROUP BY program').all();
    for (const r of rows) volunteerCounts[r.program] = r.c;
  } catch (e) { /* table may not exist */ }

  res.render('initiatives/index', {
    title: 'Initiatives',
    initiatives,
    volunteerCounts
  });
});

// ── NEW INITIATIVE FORM ─────────────────────────────────────
router.get('/new', requireAuth, (req, res) => {
  res.render('initiatives/form', {
    title: 'New Initiative',
    initiative: null,
    isEdit: false
  });
});

// ── CREATE INITIATIVE ───────────────────────────────────────
router.post('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { slug, sdg_number, sdg_label, program_name, description, color, sdg_color, icon, visibility, requires_application, volunteer_instructions, sort_order } = req.body;

  if (!slug || !slug.trim() || !program_name || !program_name.trim()) {
    req.session.flash = { type: 'error', message: 'Slug and program name are required.' };
    return res.redirect('/admin/initiatives/new');
  }

  // Sanitize slug: lowercase, underscores only
  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

  try {
    db.prepare(`INSERT INTO initiatives (slug, sdg_number, sdg_label, program_name, description, color, sdg_color, icon, visibility, requires_application, volunteer_instructions, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(cleanSlug, parseInt(sdg_number) || 1, sdg_label || '', program_name.trim(), description || '', color || '#5E6B52', sdg_color || '#5E6B52', icon || '🌱', visibility || 'private', requires_application ? 1 : 0, volunteer_instructions || null, parseInt(sort_order) || 99);

    loadInitiatives(db);
    req.session.flash = { type: 'success', message: `Initiative "${program_name.trim()}" created.` };
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      req.session.flash = { type: 'error', message: `Slug "${cleanSlug}" already exists.` };
    } else {
      req.session.flash = { type: 'error', message: 'Failed to create initiative: ' + e.message };
    }
    return res.redirect('/admin/initiatives/new');
  }
  res.redirect('/admin/initiatives');
});

// ── EDIT FORM ───────────────────────────────────────────────
router.get('/:id/edit', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const initiative = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(req.params.id);

  if (!initiative) {
    req.session.flash = { type: 'error', message: 'Initiative not found.' };
    return res.redirect('/admin/initiatives');
  }

  res.render('initiatives/form', {
    title: 'Edit: ' + initiative.program_name,
    initiative,
    isEdit: true
  });
});

// ── UPDATE INITIATIVE ───────────────────────────────────────
router.post('/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { sdg_number, sdg_label, program_name, description, color, sdg_color, icon, visibility, requires_application, volunteer_instructions, sort_order } = req.body;

  if (!program_name || !program_name.trim()) {
    req.session.flash = { type: 'error', message: 'Program name is required.' };
    return res.redirect(`/admin/initiatives/${req.params.id}/edit`);
  }

  db.prepare(`UPDATE initiatives SET sdg_number = ?, sdg_label = ?, program_name = ?, description = ?, color = ?, sdg_color = ?, icon = ?, visibility = ?, requires_application = ?, volunteer_instructions = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(parseInt(sdg_number) || 1, sdg_label || '', program_name.trim(), description || '', color || '#5E6B52', sdg_color || '#5E6B52', icon || '🌱', visibility || 'private', requires_application ? 1 : 0, volunteer_instructions || null, parseInt(sort_order) || 99, req.params.id);

  loadInitiatives(db);
  req.session.flash = { type: 'success', message: `Initiative "${program_name.trim()}" updated.` };
  res.redirect('/admin/initiatives');
});

// ── TOGGLE VISIBILITY ───────────────────────────────────────
router.post('/:id/visibility', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { visibility } = req.body;
  const valid = ['public', 'private', 'archived'];
  if (!valid.includes(visibility)) {
    req.session.flash = { type: 'error', message: 'Invalid visibility value.' };
    return res.redirect('/admin/initiatives');
  }

  db.prepare('UPDATE initiatives SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(visibility, req.params.id);
  loadInitiatives(db);
  req.session.flash = { type: 'success', message: `Visibility set to ${visibility}.` };
  res.redirect('/admin/initiatives');
});

// ── DELETE INITIATIVE ───────────────────────────────────────
router.post('/:id/delete', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const initiative = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(req.params.id);

  if (!initiative) {
    req.session.flash = { type: 'error', message: 'Initiative not found.' };
    return res.redirect('/admin/initiatives');
  }

  // Check if volunteers are assigned
  let assignedCount = 0;
  try {
    assignedCount = db.prepare('SELECT COUNT(*) as c FROM volunteer_programs WHERE program = ?').get(initiative.slug).c;
  } catch (e) { /* ignore */ }

  if (assignedCount > 0) {
    req.session.flash = { type: 'error', message: `Cannot delete "${initiative.program_name}" — ${assignedCount} volunteer(s) are assigned to this program. Remove them first.` };
    return res.redirect('/admin/initiatives');
  }

  db.prepare('DELETE FROM initiatives WHERE id = ?').run(req.params.id);
  loadInitiatives(db);
  req.session.flash = { type: 'success', message: `Initiative "${initiative.program_name}" deleted.` };
  res.redirect('/admin/initiatives');
});

module.exports = router;
