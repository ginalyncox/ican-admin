const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { PROGRAM_INFO } = require('../lib/constants');
const router = express.Router();

// ── REPORTS HUB ─────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const currentYear = new Date().getFullYear();

  // Quick stats for the reports hub
  const totalHoursAllTime = db.prepare('SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours').get().c;
  const totalHoursThisYear = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE work_date >= ?").get(`${currentYear}-01-01`).c;
  const activeVolunteers = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE status = 'active'").get().c;

  // Available years for reports
  const years = db.prepare("SELECT DISTINCT CAST(strftime('%Y', work_date) AS INTEGER) as year FROM garden_hours ORDER BY year DESC").all().map(r => r.year);
  if (!years.includes(currentYear)) years.unshift(currentYear);

  res.render('reports/index', {
    title: 'Reports',
    currentYear,
    totalHoursAllTime,
    totalHoursThisYear,
    activeVolunteers,
    years
  });
});

// ── VOLUNTEER HOURS REPORT (Annual / YTD / Custom) ──────────
router.get('/hours', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const currentYear = new Date().getFullYear();
  const year = parseInt(req.query.year) || currentYear;
  const program = req.query.program || '';
  const format = req.query.format || 'view'; // view, csv, or certified

  let dateStart = `${year}-01-01`;
  let dateEnd = `${year}-12-31`;
  const reportTitle = year === currentYear ? `Year-to-Date ${year}` : `Annual ${year}`;

  // Build query
  let query = `
    SELECT vh.*, g.first_name, g.last_name, g.email, s.name as season_name
    FROM garden_hours vh
    JOIN gardeners g ON vh.gardener_id = g.id
    LEFT JOIN garden_seasons s ON vh.season_id = s.id
    WHERE vh.work_date >= ? AND vh.work_date <= ?
  `;
  const params = [dateStart, dateEnd];
  if (program) { query += ' AND vh.program = ?'; params.push(program); }
  query += ' ORDER BY g.last_name, g.first_name, vh.work_date';

  const entries = db.prepare(query).all(...params);

  // Aggregate by volunteer
  const volunteerMap = {};
  for (const e of entries) {
    const key = e.gardener_id;
    if (!volunteerMap[key]) {
      volunteerMap[key] = {
        id: key,
        name: `${e.first_name} ${e.last_name}`,
        email: e.email || '',
        totalHours: 0,
        entries: 0,
        programs: new Set(),
        firstDate: e.work_date,
        lastDate: e.work_date
      };
    }
    volunteerMap[key].totalHours += e.hours;
    volunteerMap[key].entries++;
    volunteerMap[key].programs.add(e.program || 'victory_garden');
    if (e.work_date < volunteerMap[key].firstDate) volunteerMap[key].firstDate = e.work_date;
    if (e.work_date > volunteerMap[key].lastDate) volunteerMap[key].lastDate = e.work_date;
  }
  const volunteers = Object.values(volunteerMap).sort((a, b) => b.totalHours - a.totalHours);
  for (const v of volunteers) { v.programs = Array.from(v.programs); }

  // Summary stats
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const totalEntries = entries.length;
  const uniqueVolunteers = volunteers.length;

  // Hours by program
  const byProgram = {};
  for (const e of entries) {
    const p = e.program || 'victory_garden';
    if (!byProgram[p]) byProgram[p] = { hours: 0, entries: 0, volunteers: new Set() };
    byProgram[p].hours += e.hours;
    byProgram[p].entries++;
    byProgram[p].volunteers.add(e.gardener_id);
  }
  for (const p of Object.values(byProgram)) { p.volunteerCount = p.volunteers.size; delete p.volunteers; }

  // CSV export
  if (format === 'csv') {
    let csv = 'Volunteer,Email,Program,Date,Hours,Activity,Notes\n';
    for (const e of entries) {
      const prog = (PROGRAM_INFO[e.program] || { label: e.program || 'Victory Garden' }).label;
      csv += `"${e.first_name} ${e.last_name}","${e.email || ''}","${prog}","${e.work_date}",${e.hours},"${(e.activity || '').replace(/"/g, '""')}","${(e.notes || '').replace(/"/g, '""')}"\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ICAN-Hours-${reportTitle.replace(/\s/g, '-')}.csv"`);
    return res.send(csv);
  }

  // Summary CSV export
  if (format === 'summary-csv') {
    let csv = 'Volunteer,Email,Total Hours,Entries,Programs,First Activity,Last Activity\n';
    for (const v of volunteers) {
      const progs = v.programs.map(p => (PROGRAM_INFO[p] || { label: p }).label).join('; ');
      csv += `"${v.name}","${v.email}",${v.totalHours.toFixed(2)},${v.entries},"${progs}","${v.firstDate}","${v.lastDate}"\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ICAN-Hours-Summary-${reportTitle.replace(/\s/g, '-')}.csv"`);
    return res.send(csv);
  }

  // Certified printable report
  if (format === 'certified') {
    return res.render('reports/certified-hours', {
      layout: false,
      reportTitle,
      year,
      program,
      programLabel: program ? (PROGRAM_INFO[program] || { label: program }).label : 'All Programs',
      totalHours,
      totalEntries,
      uniqueVolunteers,
      volunteers,
      byProgram,
      entries,
      generatedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'long', timeStyle: 'short' }),
      programInfo: PROGRAM_INFO
    });
  }

  // Standard view
  res.render('reports/hours', {
    title: `Hours Report — ${reportTitle}`,
    reportTitle,
    year,
    program,
    totalHours,
    totalEntries,
    uniqueVolunteers,
    volunteers,
    byProgram,
    entries,
    years: db.prepare("SELECT DISTINCT CAST(strftime('%Y', work_date) AS INTEGER) as year FROM garden_hours ORDER BY year DESC").all().map(r => r.year),
    programInfo: PROGRAM_INFO
  });
});

// ── INDIVIDUAL VOLUNTEER CERTIFIED HOURS LETTER ─────────────
router.get('/hours/volunteer/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const currentYear = new Date().getFullYear();
  const year = parseInt(req.query.year) || currentYear;
  const volunteerId = parseInt(req.params.id);

  const volunteer = db.prepare('SELECT * FROM gardeners WHERE id = ?').get(volunteerId);
  if (!volunteer) {
    req.session.flash = { type: 'error', message: 'Volunteer not found.' };
    return res.redirect('/admin/reports');
  }

  const entries = db.prepare(`
    SELECT vh.*, s.name as season_name
    FROM garden_hours vh
    LEFT JOIN garden_seasons s ON vh.season_id = s.id
    WHERE vh.gardener_id = ? AND vh.work_date >= ? AND vh.work_date <= ?
    ORDER BY vh.work_date
  `).all(volunteerId, `${year}-01-01`, `${year}-12-31`);

  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const programs = [...new Set(entries.map(e => e.program || 'victory_garden'))];

  const reportTitle = year === currentYear ? `Year-to-Date ${year}` : `Annual ${year}`;

  res.render('reports/certified-volunteer', {
    layout: false,
    volunteer,
    entries,
    totalHours,
    programs,
    year,
    reportTitle,
    generatedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'long', timeStyle: 'short' }),
    programInfo: PROGRAM_INFO
  });
});

module.exports = router;
