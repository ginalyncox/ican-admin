const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /admin/leadership — Leadership roles dashboard
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;

  const leaders = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, g.email, g.leadership_role, g.leadership_program,
           i.program_name, i.icon, i.color
    FROM gardeners g
    LEFT JOIN initiatives i ON g.leadership_program = i.slug
    WHERE g.leadership_role IS NOT NULL AND g.status = 'active'
    ORDER BY
      CASE g.leadership_role
        WHEN 'coordinator' THEN 1
        WHEN 'committee_chair' THEN 2
        WHEN 'team_lead' THEN 3
        ELSE 4
      END,
      g.last_name ASC
  `).all();

  const volunteers = db.prepare("SELECT id, first_name, last_name, email FROM gardeners WHERE status = 'active' ORDER BY last_name, first_name").all();

  let initiatives = [];
  try {
    initiatives = db.prepare("SELECT slug, program_name, icon, color FROM initiatives WHERE visibility != 'archived' ORDER BY sort_order").all();
  } catch (e) {}

  res.render('leadership/index', {
    title: 'Leadership Roles',
    leaders,
    volunteers,
    initiatives
  });
});

// POST /admin/leadership/assign — Assign leadership role
router.post('/assign', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { volunteer_id, leadership_role, leadership_program } = req.body;

  if (!volunteer_id || !leadership_role) {
    req.session.flash = { type: 'error', message: 'Please select a volunteer and role.' };
    return res.redirect('/admin/leadership');
  }

  db.prepare('UPDATE gardeners SET leadership_role = ?, leadership_program = ? WHERE id = ?').run(
    leadership_role,
    leadership_program || null,
    volunteer_id
  );

  const vol = db.prepare('SELECT first_name, last_name FROM gardeners WHERE id = ?').get(volunteer_id);
  const name = vol ? vol.first_name + ' ' + vol.last_name : 'Volunteer';
  req.session.flash = { type: 'success', message: name + ' assigned as ' + leadership_role.replace('_', ' ') + '.' };
  res.redirect('/admin/leadership');
});

// POST /admin/leadership/remove/:id — Remove leadership role
router.post('/remove/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  db.prepare('UPDATE gardeners SET leadership_role = NULL, leadership_program = NULL WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Leadership role removed.' };
  res.redirect('/admin/leadership');
});

module.exports = router;
