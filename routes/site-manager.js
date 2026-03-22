const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Helper: get all settings as object
function getSettings(db) {
  const rows = db.prepare("SELECT key, value FROM site_settings").all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value || '';
  return settings;
}

// ── SITE MANAGER DASHBOARD ──────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const settings = getSettings(db);

  const lastDeploy = settings.last_deploy_at || null;
  const lastDeployBy = settings.last_deploy_by || null;

  // Deploy history (stored as JSON array in site_settings)
  let deployHistory = [];
  try {
    deployHistory = JSON.parse(settings.deploy_history || '[]');
  } catch (e) { /* ignore */ }

  res.render('site-manager/index', {
    title: 'Site Manager',
    settings,
    lastDeploy,
    lastDeployBy,
    deployHistory: deployHistory.slice(0, 10)
  });
});

// ── SAVE SETTINGS ───────────────────────────────────────────
router.post('/settings', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const fields = [
    'org_name', 'org_legal_name', 'org_email', 'org_phone', 'org_address',
    'org_ein', 'org_website', 'org_facebook', 'org_mission', 'org_tagline',
    'web3forms_key'
  ];

  const upsert = db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP");

  const tx = db.transaction(() => {
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        upsert.run(field, req.body[field].trim());
      }
    }
  });
  tx();

  req.session.flash = { type: 'success', message: 'Settings saved.' };
  res.redirect('/admin/site');
});

// ── DEPLOY PAGE ─────────────────────────────────────────────
router.get('/deploy', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const settings = getSettings(db);

  let deployHistory = [];
  try {
    deployHistory = JSON.parse(settings.deploy_history || '[]');
  } catch (e) { /* ignore */ }

  res.render('site-manager/deploy', {
    title: 'Deploy Website',
    settings,
    lastDeploy: settings.last_deploy_at || null,
    lastDeployBy: settings.last_deploy_by || null,
    deployHistory: deployHistory.slice(0, 20)
  });
});

// ── TRIGGER DEPLOY ──────────────────────────────────────────
router.post('/deploy', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const now = new Date().toISOString();
  const userName = res.locals.user.name;

  const upsert = db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP");

  // Record deploy intent
  upsert.run('last_deploy_at', now);
  upsert.run('last_deploy_by', userName);
  upsert.run('deploy_pending', '1');

  // Append to history
  const settings = getSettings(db);
  let history = [];
  try { history = JSON.parse(settings.deploy_history || '[]'); } catch (e) { /* ignore */ }
  history.unshift({ at: now, by: userName, status: 'pending' });
  if (history.length > 50) history = history.slice(0, 50);
  upsert.run('deploy_history', JSON.stringify(history));

  req.session.flash = { type: 'success', message: 'Deploy queued. The site will be updated shortly.' };
  res.redirect('/admin/site/deploy');
});

module.exports = router;
