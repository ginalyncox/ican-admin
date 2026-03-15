const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// ── GARDEN DASHBOARD (overview) ─────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;

  // Active season
  const activeSeason = db.prepare("SELECT * FROM garden_seasons WHERE status = 'active' ORDER BY year DESC LIMIT 1").get();
  const seasonId = activeSeason ? activeSeason.id : null;

  // Stats
  const totalGardeners = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE status = 'active'" + (seasonId ? " AND season_id = ?" : "")).get(...(seasonId ? [seasonId] : [])).c;
  const totalSites = db.prepare("SELECT COUNT(*) as c FROM garden_sites WHERE status = 'active'").get().c;
  const totalHarvestLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests" + (seasonId ? " WHERE season_id = ?" : "")).get(...(seasonId ? [seasonId] : [])).c;
  const totalVolunteerHrs = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours" + (seasonId ? " WHERE season_id = ?" : "")).get(...(seasonId ? [seasonId] : [])).c;
  const totalDonatedLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE donated = 1" + (seasonId ? " AND season_id = ?" : "")).get(...(seasonId ? [seasonId] : [])).c;

  // Leaderboard — top 5 by harvest
  const topHarvesters = db.prepare(`
    SELECT g.first_name, g.last_name, COALESCE(SUM(h.pounds), 0) as total_lbs
    FROM gardeners g LEFT JOIN garden_harvests h ON g.id = h.gardener_id ${seasonId ? 'AND h.season_id = ?' : ''}
    WHERE g.status = 'active' ${seasonId ? 'AND g.season_id = ?' : ''}
    GROUP BY g.id ORDER BY total_lbs DESC LIMIT 5
  `).all(...(seasonId ? [seasonId, seasonId] : []));

  // Top 5 by volunteer hours
  const topVolunteers = db.prepare(`
    SELECT g.first_name, g.last_name, COALESCE(SUM(vh.hours), 0) as total_hrs
    FROM gardeners g LEFT JOIN garden_hours vh ON g.id = vh.gardener_id ${seasonId ? 'AND vh.season_id = ?' : ''}
    WHERE g.status = 'active' ${seasonId ? 'AND g.season_id = ?' : ''}
    GROUP BY g.id ORDER BY total_hrs DESC LIMIT 5
  `).all(...(seasonId ? [seasonId, seasonId] : []));

  // Recent activity (last 10 harvests + hours combined)
  const recentHarvests = db.prepare(`
    SELECT h.*, g.first_name, g.last_name FROM garden_harvests h
    JOIN gardeners g ON h.gardener_id = g.id
    ORDER BY h.harvest_date DESC LIMIT 5
  `).all();

  // All seasons for dropdown
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC, start_date DESC").all();

  res.render('garden/dashboard', {
    title: 'Victory Garden',
    activeSeason,
    seasons,
    stats: { totalGardeners, totalSites, totalHarvestLbs, totalVolunteerHrs, totalDonatedLbs },
    topHarvesters,
    topVolunteers,
    recentHarvests
  });
});


// ── SEASONS ─────────────────────────────────────────────────
router.get('/seasons', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC, start_date DESC").all();

  // Enrich with stats
  const enriched = seasons.map(s => {
    const gardenerCount = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE season_id = ?").get(s.id).c;
    const harvestLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE season_id = ?").get(s.id).c;
    const volunteerHrs = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE season_id = ?").get(s.id).c;
    const awardCount = db.prepare("SELECT COUNT(*) as c FROM garden_awards WHERE season_id = ?").get(s.id).c;
    return { ...s, gardenerCount, harvestLbs, volunteerHrs, awardCount };
  });

  res.render('garden/seasons', { title: 'Contest Seasons', seasons: enriched });
});

router.get('/seasons/new', requireRole('admin', 'editor'), (req, res) => {
  res.render('garden/season-form', {
    title: 'New Season',
    season: { id: null, name: '', year: new Date().getFullYear(), start_date: '', end_date: '', status: 'upcoming', notes: '' },
    isNew: true
  });
});

router.post('/seasons', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { name, year, start_date, end_date, status, notes } = req.body;
  try {
    db.prepare("INSERT INTO garden_seasons (name, year, start_date, end_date, status, notes) VALUES (?, ?, ?, ?, ?, ?)").run(name, parseInt(year), start_date, end_date, status || 'upcoming', notes || null);
    req.session.flash = { type: 'success', message: 'Season created.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to create season.' };
  }
  res.redirect('/admin/garden/seasons');
});

router.get('/seasons/:id/edit', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const season = db.prepare("SELECT * FROM garden_seasons WHERE id = ?").get(req.params.id);
  if (!season) { req.session.flash = { type: 'error', message: 'Season not found.' }; return res.redirect('/admin/garden/seasons'); }
  res.render('garden/season-form', { title: 'Edit Season', season, isNew: false });
});

router.post('/seasons/:id', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { name, year, start_date, end_date, status, notes } = req.body;
  try {
    db.prepare("UPDATE garden_seasons SET name = ?, year = ?, start_date = ?, end_date = ?, status = ?, notes = ? WHERE id = ?").run(name, parseInt(year), start_date, end_date, status, notes || null, req.params.id);
    req.session.flash = { type: 'success', message: 'Season updated.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to update season.' };
  }
  res.redirect('/admin/garden/seasons');
});

router.post('/seasons/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM garden_seasons WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Season deleted.' };
  res.redirect('/admin/garden/seasons');
});


// ── GARDEN SITES ────────────────────────────────────────────
router.get('/sites', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const sites = db.prepare("SELECT * FROM garden_sites ORDER BY name").all();
  const enriched = sites.map(s => {
    const gardenerCount = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE site_id = ? AND status = 'active'").get(s.id).c;
    return { ...s, gardenerCount };
  });
  res.render('garden/sites', { title: 'Garden Sites', sites: enriched });
});

router.get('/sites/new', requireRole('admin', 'editor'), (req, res) => {
  res.render('garden/site-form', {
    title: 'New Garden Site',
    site: { id: null, name: '', address: '', partner: '', total_plots: '', status: 'active', notes: '' },
    isNew: true
  });
});

router.post('/sites', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { name, address, partner, total_plots, status, notes } = req.body;
  try {
    db.prepare("INSERT INTO garden_sites (name, address, partner, total_plots, status, notes) VALUES (?, ?, ?, ?, ?, ?)").run(name, address || null, partner || null, parseInt(total_plots) || 0, status || 'active', notes || null);
    req.session.flash = { type: 'success', message: 'Garden site added.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to add site.' };
  }
  res.redirect('/admin/garden/sites');
});

router.get('/sites/:id/edit', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const site = db.prepare("SELECT * FROM garden_sites WHERE id = ?").get(req.params.id);
  if (!site) { req.session.flash = { type: 'error', message: 'Site not found.' }; return res.redirect('/admin/garden/sites'); }
  res.render('garden/site-form', { title: 'Edit Garden Site', site, isNew: false });
});

router.post('/sites/:id', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { name, address, partner, total_plots, status, notes } = req.body;
  try {
    db.prepare("UPDATE garden_sites SET name = ?, address = ?, partner = ?, total_plots = ?, status = ?, notes = ? WHERE id = ?").run(name, address || null, partner || null, parseInt(total_plots) || 0, status, notes || null, req.params.id);
    req.session.flash = { type: 'success', message: 'Site updated.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to update site.' };
  }
  res.redirect('/admin/garden/sites');
});

router.post('/sites/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM garden_sites WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Site deleted.' };
  res.redirect('/admin/garden/sites');
});


// ── GARDENERS ───────────────────────────────────────────────
router.get('/gardeners', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const seasonFilter = req.query.season || '';
  const statusFilter = req.query.status || '';

  let query = `SELECT g.*, gs.name as site_name, gsn.name as season_name
    FROM gardeners g
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    LEFT JOIN garden_seasons gsn ON g.season_id = gsn.id`;
  const conditions = [];
  const params = [];

  if (seasonFilter) { conditions.push('g.season_id = ?'); params.push(seasonFilter); }
  if (statusFilter) { conditions.push('g.status = ?'); params.push(statusFilter); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY g.last_name, g.first_name';

  const gardeners = db.prepare(query).all(...params);
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();

  res.render('garden/gardeners', { title: 'Gardeners', gardeners, seasons, filters: { season: seasonFilter, status: statusFilter } });
});

router.get('/gardeners/new', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const sites = db.prepare("SELECT * FROM garden_sites WHERE status = 'active' ORDER BY name").all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();
  res.render('garden/gardener-form', {
    title: 'New Gardener',
    gardener: { id: null, first_name: '', last_name: '', email: '', phone: '', site_id: '', plot_number: '', season_id: '', status: 'active', notes: '' },
    sites, seasons, isNew: true
  });
});

router.post('/gardeners', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { first_name, last_name, email, phone, site_id, plot_number, season_id, status, notes } = req.body;
  try {
    db.prepare(`INSERT INTO gardeners (first_name, last_name, email, phone, site_id, plot_number, season_id, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(first_name, last_name, email || null, phone || null, site_id || null, plot_number || null, season_id || null, status || 'active', notes || null);
    req.session.flash = { type: 'success', message: 'Gardener added.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to add gardener.' };
  }
  res.redirect('/admin/garden/gardeners');
});

router.get('/gardeners/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const gardener = db.prepare(`SELECT g.*, gs.name as site_name, gsn.name as season_name
    FROM gardeners g LEFT JOIN garden_sites gs ON g.site_id = gs.id
    LEFT JOIN garden_seasons gsn ON g.season_id = gsn.id WHERE g.id = ?`).get(req.params.id);
  if (!gardener) { req.session.flash = { type: 'error', message: 'Gardener not found.' }; return res.redirect('/admin/garden/gardeners'); }

  const harvests = db.prepare("SELECT * FROM garden_harvests WHERE gardener_id = ? ORDER BY harvest_date DESC").all(req.params.id);
  const hours = db.prepare("SELECT * FROM garden_hours WHERE gardener_id = ? ORDER BY work_date DESC").all(req.params.id);
  const awards = db.prepare("SELECT a.*, s.name as season_name FROM garden_awards a LEFT JOIN garden_seasons s ON a.season_id = s.id WHERE a.gardener_id = ? ORDER BY a.created_at DESC").all(req.params.id);
  const totalLbs = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ?").get(req.params.id).c;
  const totalHrs = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ?").get(req.params.id).c;

  res.render('garden/gardener-detail', {
    title: gardener.first_name + ' ' + gardener.last_name,
    gardener, harvests, hours, awards,
    stats: { totalLbs, totalHrs }
  });
});

router.get('/gardeners/:id/edit', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const gardener = db.prepare("SELECT * FROM gardeners WHERE id = ?").get(req.params.id);
  if (!gardener) { req.session.flash = { type: 'error', message: 'Gardener not found.' }; return res.redirect('/admin/garden/gardeners'); }
  const sites = db.prepare("SELECT * FROM garden_sites WHERE status = 'active' ORDER BY name").all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();
  res.render('garden/gardener-form', { title: 'Edit Gardener', gardener, sites, seasons, isNew: false });
});

router.post('/gardeners/:id', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { first_name, last_name, email, phone, site_id, plot_number, season_id, status, notes } = req.body;
  try {
    db.prepare(`UPDATE gardeners SET first_name = ?, last_name = ?, email = ?, phone = ?, site_id = ?, plot_number = ?, season_id = ?, status = ?, notes = ? WHERE id = ?`)
      .run(first_name, last_name, email || null, phone || null, site_id || null, plot_number || null, season_id || null, status, notes || null, req.params.id);
    req.session.flash = { type: 'success', message: 'Gardener updated.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to update gardener.' };
  }
  res.redirect('/admin/garden/gardeners/' + req.params.id);
});

router.post('/gardeners/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM gardeners WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Gardener removed.' };
  res.redirect('/admin/garden/gardeners');
});


// ── HARVESTS ────────────────────────────────────────────────
router.get('/harvests', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const gardenerFilter = req.query.gardener || '';
  const seasonFilter = req.query.season || '';
  const statusFilter = req.query.donation_status || '';

  let query = `SELECT h.*, g.first_name, g.last_name, s.name as season_name, u.name as verifier_name
    FROM garden_harvests h
    JOIN gardeners g ON h.gardener_id = g.id
    LEFT JOIN garden_seasons s ON h.season_id = s.id
    LEFT JOIN users u ON h.verified_by = u.id`;
  const conditions = [];
  const params = [];
  if (gardenerFilter) { conditions.push('h.gardener_id = ?'); params.push(gardenerFilter); }
  if (seasonFilter) { conditions.push('h.season_id = ?'); params.push(seasonFilter); }
  if (statusFilter) { conditions.push('h.donation_status = ?'); params.push(statusFilter); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY h.harvest_date DESC';

  const harvests = db.prepare(query).all(...params);
  const gardeners = db.prepare("SELECT id, first_name, last_name FROM gardeners WHERE status = 'active' ORDER BY last_name, first_name").all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();

  // Verification summary counts
  const pendingCount = db.prepare("SELECT COUNT(*) as c FROM garden_harvests WHERE donation_status = 'pending' AND donated = 1").get().c;
  const verifiedCount = db.prepare("SELECT COUNT(*) as c FROM garden_harvests WHERE donation_status = 'verified'").get().c;
  const flaggedCount = db.prepare("SELECT COUNT(*) as c FROM garden_harvests WHERE donation_status = 'flagged'").get().c;

  res.render('garden/harvests', {
    title: 'Harvest Log', harvests, gardeners, seasons,
    filters: { gardener: gardenerFilter, season: seasonFilter, donation_status: statusFilter },
    verificationStats: { pendingCount, verifiedCount, flaggedCount }
  });
});

router.get('/harvests/new', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const gardeners = db.prepare("SELECT id, first_name, last_name FROM gardeners WHERE status = 'active' ORDER BY last_name, first_name").all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();
  res.render('garden/harvest-form', {
    title: 'Log Harvest',
    harvest: { id: null, gardener_id: req.query.gardener || '', season_id: '', harvest_date: new Date().toISOString().split('T')[0], crop: '', pounds: '', donated: 1, donated_to: '', donation_status: 'pending', notes: '' },
    gardeners, seasons, isNew: true
  });
});

router.post('/harvests', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { gardener_id, season_id, harvest_date, crop, pounds, donated, donated_to, notes } = req.body;
  try {
    db.prepare("INSERT INTO garden_harvests (gardener_id, season_id, harvest_date, crop, pounds, donated, donated_to, donation_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(gardener_id, season_id || null, harvest_date, crop, parseFloat(pounds) || 0, donated ? 1 : 0, donated_to || null, notes || null);
    req.session.flash = { type: 'success', message: 'Harvest logged.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to log harvest.' };
  }
  res.redirect('/admin/garden/harvests');
});

// Verify a donation
router.post('/harvests/:id/verify', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("UPDATE garden_harvests SET donation_status = 'verified', verified_by = ?, verified_at = datetime('now'), flag_reason = NULL WHERE id = ?")
    .run(req.session.userId, req.params.id);
  req.session.flash = { type: 'success', message: 'Donation verified.' };
  res.redirect(req.headers.referer || '/admin/garden/harvests');
});

// Flag a donation
router.post('/harvests/:id/flag', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { flag_reason } = req.body;
  db.prepare("UPDATE garden_harvests SET donation_status = 'flagged', verified_by = ?, verified_at = datetime('now'), flag_reason = ? WHERE id = ?")
    .run(req.session.userId, flag_reason || 'Needs review', req.params.id);
  req.session.flash = { type: 'warning', message: 'Harvest flagged for review.' };
  res.redirect(req.headers.referer || '/admin/garden/harvests');
});

// Reset to pending
router.post('/harvests/:id/reset-status', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("UPDATE garden_harvests SET donation_status = 'pending', verified_by = NULL, verified_at = NULL, flag_reason = NULL WHERE id = ?")
    .run(req.params.id);
  req.session.flash = { type: 'success', message: 'Status reset to pending.' };
  res.redirect(req.headers.referer || '/admin/garden/harvests');
});

// Batch verify all pending donations
router.post('/harvests/batch-verify', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const result = db.prepare("UPDATE garden_harvests SET donation_status = 'verified', verified_by = ?, verified_at = datetime('now') WHERE donation_status = 'pending' AND donated = 1")
    .run(req.session.userId);
  req.session.flash = { type: 'success', message: `${result.changes} donation(s) verified.` };
  res.redirect(req.headers.referer || '/admin/garden/harvests');
});

// Batch verify selected IDs
router.post('/harvests/batch-action', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { ids, action: batchAction } = req.body;
  if (!ids) {
    req.session.flash = { type: 'error', message: 'No entries selected.' };
    return res.redirect(req.headers.referer || '/admin/garden/harvests');
  }
  const idList = Array.isArray(ids) ? ids : [ids];
  let count = 0;
  if (batchAction === 'verify') {
    const stmt = db.prepare("UPDATE garden_harvests SET donation_status = 'verified', verified_by = ?, verified_at = datetime('now'), flag_reason = NULL WHERE id = ?");
    for (const id of idList) { stmt.run(req.session.userId, id); count++; }
    req.session.flash = { type: 'success', message: `${count} donation(s) verified.` };
  } else if (batchAction === 'flag') {
    const stmt = db.prepare("UPDATE garden_harvests SET donation_status = 'flagged', verified_by = ?, verified_at = datetime('now'), flag_reason = 'Batch flagged' WHERE id = ?");
    for (const id of idList) { stmt.run(req.session.userId, id); count++; }
    req.session.flash = { type: 'warning', message: `${count} donation(s) flagged.` };
  }
  res.redirect(req.headers.referer || '/admin/garden/harvests');
});

// Dedicated verification queue
router.get('/verify', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const tab = req.query.tab || 'pending';

  const pending = db.prepare(`
    SELECT h.*, g.first_name, g.last_name, s.name as season_name
    FROM garden_harvests h
    JOIN gardeners g ON h.gardener_id = g.id
    LEFT JOIN garden_seasons s ON h.season_id = s.id
    WHERE h.donated = 1 AND h.donation_status = 'pending'
    ORDER BY h.harvest_date DESC
  `).all();

  const flagged = db.prepare(`
    SELECT h.*, g.first_name, g.last_name, s.name as season_name, u.name as verifier_name
    FROM garden_harvests h
    JOIN gardeners g ON h.gardener_id = g.id
    LEFT JOIN garden_seasons s ON h.season_id = s.id
    LEFT JOIN users u ON h.verified_by = u.id
    WHERE h.donation_status = 'flagged'
    ORDER BY h.verified_at DESC
  `).all();

  const recentlyVerified = db.prepare(`
    SELECT h.*, g.first_name, g.last_name, u.name as verifier_name
    FROM garden_harvests h
    JOIN gardeners g ON h.gardener_id = g.id
    LEFT JOIN users u ON h.verified_by = u.id
    WHERE h.donation_status = 'verified'
    ORDER BY h.verified_at DESC LIMIT 20
  `).all();

  // Group pending by recipient for quick batch verify
  const pendingByRecipient = {};
  for (const h of pending) {
    const key = h.donated_to || 'Unspecified';
    if (!pendingByRecipient[key]) pendingByRecipient[key] = { items: [], totalLbs: 0 };
    pendingByRecipient[key].items.push(h);
    pendingByRecipient[key].totalLbs += h.pounds;
  }

  res.render('garden/verify', {
    title: 'Verify Donations',
    pending, flagged, recentlyVerified, pendingByRecipient, tab
  });
});

// Donation summary report
router.get('/donations', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const seasonFilter = req.query.season || '';

  const seasonCond = seasonFilter ? 'AND h.season_id = ?' : '';
  const params = seasonFilter ? [seasonFilter] : [];

  // By recipient
  const byRecipient = db.prepare(`
    SELECT h.donated_to, COUNT(*) as entries, SUM(h.pounds) as total_lbs,
           SUM(CASE WHEN h.donation_status = 'verified' THEN h.pounds ELSE 0 END) as verified_lbs
    FROM garden_harvests h
    WHERE h.donated = 1 AND h.donated_to IS NOT NULL ${seasonCond}
    GROUP BY h.donated_to ORDER BY total_lbs DESC
  `).all(...params);

  // By crop
  const byCrop = db.prepare(`
    SELECT h.crop, SUM(h.pounds) as total_lbs, COUNT(*) as entries
    FROM garden_harvests h WHERE h.donated = 1 ${seasonCond}
    GROUP BY h.crop ORDER BY total_lbs DESC
  `).all(...params);

  // Monthly totals
  const byMonth = db.prepare(`
    SELECT strftime('%Y-%m', h.harvest_date) as month, SUM(h.pounds) as total_lbs,
           SUM(CASE WHEN h.donation_status = 'verified' THEN h.pounds ELSE 0 END) as verified_lbs
    FROM garden_harvests h WHERE h.donated = 1 ${seasonCond}
    GROUP BY month ORDER BY month
  `).all(...params);

  // Totals
  const totals = db.prepare(`
    SELECT COALESCE(SUM(h.pounds), 0) as total_lbs,
           SUM(CASE WHEN h.donation_status = 'verified' THEN h.pounds ELSE 0 END) as verified_lbs,
           SUM(CASE WHEN h.donation_status = 'pending' THEN h.pounds ELSE 0 END) as pending_lbs,
           COUNT(DISTINCT h.donated_to) as recipient_count
    FROM garden_harvests h WHERE h.donated = 1 ${seasonCond}
  `).get(...params);

  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();

  res.render('garden/donations', {
    title: 'Donation Report',
    byRecipient, byCrop, byMonth, totals, seasons,
    filters: { season: seasonFilter }
  });
});

router.post('/harvests/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM garden_harvests WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Harvest entry deleted.' };
  res.redirect('/admin/garden/harvests');
});


// ── VOLUNTEER HOURS ─────────────────────────────────────────
router.get('/hours', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const gardenerFilter = req.query.gardener || '';
  const seasonFilter = req.query.season || '';

  let query = `SELECT vh.*, g.first_name, g.last_name, s.name as season_name
    FROM garden_hours vh
    JOIN gardeners g ON vh.gardener_id = g.id
    LEFT JOIN garden_seasons s ON vh.season_id = s.id`;
  const conditions = [];
  const params = [];
  if (gardenerFilter) { conditions.push('vh.gardener_id = ?'); params.push(gardenerFilter); }
  if (seasonFilter) { conditions.push('vh.season_id = ?'); params.push(seasonFilter); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY vh.work_date DESC';

  const entries = db.prepare(query).all(...params);
  const gardeners = db.prepare("SELECT id, first_name, last_name FROM gardeners WHERE status = 'active' ORDER BY last_name, first_name").all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();

  res.render('garden/hours', { title: 'Volunteer Hours', entries, gardeners, seasons, filters: { gardener: gardenerFilter, season: seasonFilter } });
});

router.get('/hours/new', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const gardeners = db.prepare("SELECT id, first_name, last_name FROM gardeners WHERE status = 'active' ORDER BY last_name, first_name").all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();
  res.render('garden/hour-form', {
    title: 'Log Hours',
    entry: { id: null, gardener_id: req.query.gardener || '', season_id: '', work_date: new Date().toISOString().split('T')[0], hours: '', activity: '', notes: '' },
    gardeners, seasons, isNew: true
  });
});

router.post('/hours', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { gardener_id, season_id, work_date, hours, activity, notes } = req.body;
  try {
    db.prepare("INSERT INTO garden_hours (gardener_id, season_id, work_date, hours, activity, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(gardener_id, season_id || null, work_date, parseFloat(hours) || 0, activity || null, notes || null);
    req.session.flash = { type: 'success', message: 'Hours logged.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to log hours.' };
  }
  res.redirect('/admin/garden/hours');
});

router.post('/hours/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM garden_hours WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Hours entry deleted.' };
  res.redirect('/admin/garden/hours');
});


// ── AWARDS ──────────────────────────────────────────────────
router.get('/awards', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const seasonFilter = req.query.season || '';

  let query = `SELECT a.*, g.first_name, g.last_name, s.name as season_name
    FROM garden_awards a
    JOIN gardeners g ON a.gardener_id = g.id
    LEFT JOIN garden_seasons s ON a.season_id = s.id`;
  if (seasonFilter) query += ' WHERE a.season_id = ?';
  query += ' ORDER BY a.created_at DESC';

  const awards = seasonFilter ? db.prepare(query).all(seasonFilter) : db.prepare(query).all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();

  res.render('garden/awards', { title: 'Annual Awards', awards, seasons, filters: { season: seasonFilter } });
});

router.get('/awards/new', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const gardeners = db.prepare("SELECT id, first_name, last_name FROM gardeners ORDER BY last_name, first_name").all();
  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();
  res.render('garden/award-form', {
    title: 'Present Award',
    award: { id: null, season_id: '', gardener_id: '', award_name: '', category: '', description: '', presented_at: '' },
    gardeners, seasons, isNew: true
  });
});

router.post('/awards', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { season_id, gardener_id, award_name, category, description, presented_at } = req.body;
  try {
    db.prepare("INSERT INTO garden_awards (season_id, gardener_id, award_name, category, description, presented_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(season_id || null, gardener_id, award_name, category, description || null, presented_at || null);
    req.session.flash = { type: 'success', message: 'Award presented.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: 'Failed to create award.' };
  }
  res.redirect('/admin/garden/awards');
});

router.post('/awards/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM garden_awards WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Award removed.' };
  res.redirect('/admin/garden/awards');
});


// ── LEADERBOARD ─────────────────────────────────────────────
router.get('/leaderboard', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const seasonFilter = req.query.season || '';

  const seasonCondition = seasonFilter ? 'AND h.season_id = ?' : '';
  const seasonCondition2 = seasonFilter ? 'AND vh.season_id = ?' : '';
  const seasonConditionG = seasonFilter ? 'AND g.season_id = ?' : '';
  const params = seasonFilter ? [seasonFilter] : [];

  // Harvest leaderboard
  const harvestLeaders = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, gs.name as site_name,
           COALESCE(SUM(h.pounds), 0) as total_lbs,
           COUNT(h.id) as harvest_count
    FROM gardeners g
    LEFT JOIN garden_harvests h ON g.id = h.gardener_id ${seasonCondition}
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    WHERE g.status = 'active' ${seasonConditionG}
    GROUP BY g.id ORDER BY total_lbs DESC
  `).all(...params, ...params);

  // Volunteer hours leaderboard
  const hoursLeaders = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, gs.name as site_name,
           COALESCE(SUM(vh.hours), 0) as total_hrs,
           COUNT(vh.id) as entry_count
    FROM gardeners g
    LEFT JOIN garden_hours vh ON g.id = vh.gardener_id ${seasonCondition2}
    LEFT JOIN garden_sites gs ON g.site_id = gs.id
    WHERE g.status = 'active' ${seasonConditionG}
    GROUP BY g.id ORDER BY total_hrs DESC
  `).all(...params, ...params);

  const seasons = db.prepare("SELECT * FROM garden_seasons ORDER BY year DESC").all();

  res.render('garden/leaderboard', {
    title: 'Contest Leaderboard',
    harvestLeaders,
    hoursLeaders,
    seasons,
    filters: { season: seasonFilter }
  });
});


// ── MEMBER ACCOUNTS ─────────────────────────────────────────
router.get('/members', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const members = db.prepare(`
    SELECT mc.*, g.first_name, g.last_name
    FROM member_credentials mc
    JOIN gardeners g ON mc.gardener_id = g.id
    ORDER BY g.last_name, g.first_name
  `).all();
  res.render('garden/members', { title: 'Member Accounts', members });
});

router.get('/members/new', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  // Gardeners who don't yet have a member account
  const gardeners = db.prepare(`
    SELECT g.id, g.first_name, g.last_name, g.email
    FROM gardeners g
    WHERE g.id NOT IN (SELECT gardener_id FROM member_credentials)
    ORDER BY g.last_name, g.first_name
  `).all();
  res.render('garden/member-form', { title: 'Create Member Login', gardeners, isNew: true });
});

router.post('/members', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { gardener_id, email, password } = req.body;
  if (!gardener_id || !email || !password) {
    req.session.flash = { type: 'error', message: 'All fields are required.' };
    return res.redirect('/admin/garden/members/new');
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO member_credentials (gardener_id, email, password_hash) VALUES (?, ?, ?)").run(gardener_id, email, hash);
    req.session.flash = { type: 'success', message: 'Member login created.' };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message.includes('UNIQUE') ? 'That gardener or email already has an account.' : 'Failed to create member login.' };
  }
  res.redirect('/admin/garden/members');
});

router.post('/members/:id/reset', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const { password } = req.body;
  if (!password) {
    req.session.flash = { type: 'error', message: 'Password is required.' };
    return res.redirect('/admin/garden/members');
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE member_credentials SET password_hash = ? WHERE id = ?").run(hash, req.params.id);
  req.session.flash = { type: 'success', message: 'Password reset.' };
  res.redirect('/admin/garden/members');
});

router.post('/members/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM member_credentials WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Member login removed.' };
  res.redirect('/admin/garden/members');
});


// ── CSV EXPORTS ─────────────────────────────────────────────
router.get('/export/gardeners', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const rows = db.prepare(`SELECT g.*, gs.name as site_name, gsn.name as season_name
    FROM gardeners g LEFT JOIN garden_sites gs ON g.site_id = gs.id
    LEFT JOIN garden_seasons gsn ON g.season_id = gsn.id ORDER BY g.last_name`).all();

  let csv = 'First Name,Last Name,Email,Phone,Site,Plot,Season,Status,Joined\n';
  for (const r of rows) {
    csv += `"${r.first_name}","${r.last_name}","${r.email || ''}","${r.phone || ''}","${r.site_name || ''}","${r.plot_number || ''}","${r.season_name || ''}","${r.status}","${r.joined_date || ''}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=ican-gardeners.csv');
  res.send(csv);
});

router.get('/export/harvests', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const rows = db.prepare(`SELECT h.*, g.first_name, g.last_name FROM garden_harvests h
    JOIN gardeners g ON h.gardener_id = g.id ORDER BY h.harvest_date DESC`).all();

  let csv = 'Date,Gardener,Crop,Pounds,Donated,Donated To,Notes\n';
  for (const r of rows) {
    csv += `"${r.harvest_date}","${r.first_name} ${r.last_name}","${r.crop}","${r.pounds}","${r.donated ? 'Yes' : 'No'}","${r.donated_to || ''}","${(r.notes || '').replace(/"/g, '""')}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=ican-harvests.csv');
  res.send(csv);
});

module.exports = router;
