const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ── PEOPLE DASHBOARD ────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const totalVolunteers = db.prepare("SELECT COUNT(*) as c FROM gardeners").get().c;
  const activeVolunteers = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE status = 'active'").get().c;
  const totalDirectors = db.prepare("SELECT COUNT(*) as c FROM board_members WHERE status IN ('active', 'locked')").get().c;
  const totalSubscribers = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  const totalContacts = totalVolunteers + totalDirectors + totalSubscribers;

  // New this month
  const newVolunteersMonth = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE joined_date >= ?").get(monthStart).c;
  const newSubscribersMonth = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE subscribed_at >= ?").get(monthStart).c;
  const newThisMonth = newVolunteersMonth + newSubscribersMonth;

  // Active this month (logged hours or harvests)
  const activeThisMonth = db.prepare("SELECT COUNT(DISTINCT gardener_id) as c FROM garden_hours WHERE work_date >= ?").get(monthStart).c;

  // Pipeline counts
  const withPortalAccess = db.prepare("SELECT COUNT(*) as c FROM member_credentials").get().c;
  const onBoardMembers = db.prepare("SELECT COUNT(*) as c FROM board_members WHERE status = 'active'").get().c;

  // Recent interactions
  const recentInteractions = db.prepare(`
    SELECT ci.*,
      CASE ci.contact_type
        WHEN 'volunteer' THEN (SELECT first_name || ' ' || last_name FROM gardeners WHERE id = ci.contact_id)
        WHEN 'director' THEN (SELECT first_name || ' ' || last_name FROM board_members WHERE id = ci.contact_id)
        WHEN 'subscriber' THEN (SELECT COALESCE(name, email) FROM subscribers WHERE id = ci.contact_id)
        ELSE 'Unknown'
      END as contact_name
    FROM contact_interactions ci ORDER BY ci.created_at DESC LIMIT 20
  `).all();

  // Tag usage
  const tagUsage = db.prepare(`
    SELECT ct.id, ct.tag_name, ct.color, COUNT(cta.id) as usage_count
    FROM contact_tags ct LEFT JOIN contact_tag_assignments cta ON ct.id = cta.tag_id
    GROUP BY ct.id ORDER BY usage_count DESC
  `).all();

  res.render('crm/dashboard', {
    title: 'People Dashboard',
    totalContacts,
    activeVolunteers,
    totalVolunteers,
    totalDirectors,
    totalSubscribers,
    newThisMonth,
    activeThisMonth,
    withPortalAccess,
    onBoardMembers,
    recentInteractions,
    tagUsage
  });
});

// ── CONTACTS LIST ───────────────────────────────────────────
router.get('/contacts', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { type, tag, status, q, page: pageStr } = req.query;
  const page = Math.max(1, parseInt(pageStr) || 1);
  const perPage = 30;

  // Build unified contacts from all sources
  let contacts = [];

  // Volunteers
  if (!type || type === 'volunteer') {
    const volunteers = db.prepare(`
      SELECT id, first_name, last_name, email, phone, status, joined_date as created_at, 'volunteer' as contact_type
      FROM gardeners ORDER BY last_name, first_name
    `).all();
    contacts.push(...volunteers);
  }

  // Directors
  if (!type || type === 'director') {
    const directors = db.prepare(`
      SELECT id, first_name, last_name, email, phone, status, created_at, 'director' as contact_type
      FROM board_members ORDER BY last_name, first_name
    `).all();
    contacts.push(...directors);
  }

  // Subscribers
  if (!type || type === 'subscriber') {
    const subscribers = db.prepare(`
      SELECT id, name as first_name, '' as last_name, email, '' as phone, status, subscribed_at as created_at, 'subscriber' as contact_type
      FROM subscribers ORDER BY email
    `).all();
    contacts.push(...subscribers);
  }

  // Search filter
  if (q && q.trim()) {
    const search = q.toLowerCase();
    contacts = contacts.filter(c => {
      const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
      return name.includes(search) || (c.email || '').toLowerCase().includes(search);
    });
  }

  // Status filter
  if (status) {
    contacts = contacts.filter(c => c.status === status);
  }

  // Tag filter
  if (tag) {
    const taggedIds = db.prepare(`
      SELECT contact_type, contact_id FROM contact_tag_assignments WHERE tag_id = ?
    `).all(tag);
    const tagSet = new Set(taggedIds.map(t => `${t.contact_type}:${t.contact_id}`));
    contacts = contacts.filter(c => tagSet.has(`${c.contact_type}:${c.id}`));
  }

  // Load tags for each contact
  const allTags = db.prepare(`
    SELECT cta.contact_type, cta.contact_id, ct.tag_name, ct.color
    FROM contact_tag_assignments cta JOIN contact_tags ct ON cta.tag_id = ct.id
  `).all();
  const tagMap = {};
  for (const t of allTags) {
    const key = `${t.contact_type}:${t.contact_id}`;
    if (!tagMap[key]) tagMap[key] = [];
    tagMap[key].push({ name: t.tag_name, color: t.color });
  }
  contacts.forEach(c => {
    c.tags = tagMap[`${c.contact_type}:${c.id}`] || [];
  });

  // Sort by name
  contacts.sort((a, b) => {
    const nameA = `${a.last_name || ''} ${a.first_name || ''}`.trim().toLowerCase();
    const nameB = `${b.last_name || ''} ${b.first_name || ''}`.trim().toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const totalCount = contacts.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const offset = (page - 1) * perPage;
  const paged = contacts.slice(offset, offset + perPage);

  const availableTags = db.prepare("SELECT * FROM contact_tags ORDER BY tag_name").all();

  res.render('crm/contacts', {
    title: 'Contacts',
    contacts: paged,
    totalCount,
    page,
    totalPages,
    availableTags,
    filters: { type: type || '', tag: tag || '', status: status || '', q: q || '' }
  });
});

// ── CONTACT DETAIL ──────────────────────────────────────────
router.get('/contacts/:type/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { type, id } = req.params;

  let contact = null;
  let stats = {};

  if (type === 'volunteer') {
    contact = db.prepare("SELECT *, 'volunteer' as contact_type FROM gardeners WHERE id = ?").get(id);
    if (contact) {
      stats.totalHours = db.prepare("SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours WHERE gardener_id = ?").get(id).c;
      stats.totalHarvest = db.prepare("SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE gardener_id = ?").get(id).c;
      stats.programs = db.prepare("SELECT program FROM volunteer_programs WHERE volunteer_id = ?").all(id).map(p => p.program);
      stats.eventsAttended = db.prepare("SELECT COUNT(*) as c FROM event_rsvps WHERE gardener_id = ? AND status = 'going'").get(id).c;
    }
  } else if (type === 'director') {
    contact = db.prepare("SELECT *, 'director' as contact_type FROM board_members WHERE id = ?").get(id);
    if (contact) {
      stats.meetingsAttended = db.prepare("SELECT COUNT(*) as c FROM board_attendance WHERE member_id = ? AND status IN ('present', 'remote')").get(id).c;
      stats.votesParticipated = db.prepare("SELECT COUNT(*) as c FROM board_vote_records WHERE member_id = ?").get(id).c;
      stats.committees = db.prepare("SELECT bc.name FROM board_committee_members bcm JOIN board_committees bc ON bcm.committee_id = bc.id WHERE bcm.member_id = ?").all(id).map(c => c.name);
    }
  } else if (type === 'subscriber') {
    contact = db.prepare("SELECT *, 'subscriber' as contact_type FROM subscribers WHERE id = ?").get(id);
    if (contact) {
      contact.first_name = contact.name || contact.email;
      contact.last_name = '';
    }
  }

  if (!contact) {
    req.session.flash = { type: 'error', message: 'Contact not found.' };
    return res.redirect('/admin/crm/contacts');
  }

  // Interaction timeline
  const interactions = db.prepare(`
    SELECT * FROM contact_interactions
    WHERE contact_type = ? AND contact_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(type, id);

  // Tags
  const contactTags = db.prepare(`
    SELECT ct.* FROM contact_tags ct
    JOIN contact_tag_assignments cta ON ct.id = cta.tag_id
    WHERE cta.contact_type = ? AND cta.contact_id = ?
  `).all(type, id);

  const allTags = db.prepare("SELECT * FROM contact_tags ORDER BY tag_name").all();

  res.render('crm/contact-detail', {
    title: `${contact.first_name} ${contact.last_name || ''}`.trim(),
    contact,
    interactions,
    contactTags,
    allTags,
    stats
  });
});

// ── ADD INTERACTION ─────────────────────────────────────────
router.post('/contacts/:type/:id/interaction', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { type, id } = req.params;
  const { interaction_type, title, body } = req.body;

  if (!interaction_type || !title || !title.trim()) {
    req.session.flash = { type: 'error', message: 'Interaction type and title are required.' };
    return res.redirect(`/admin/crm/contacts/${type}/${id}`);
  }

  db.prepare(`INSERT INTO contact_interactions (contact_type, contact_id, interaction_type, title, body, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(type, id, interaction_type, title.trim(), body || null, res.locals.user.name);

  req.session.flash = { type: 'success', message: 'Interaction logged.' };
  res.redirect(`/admin/crm/contacts/${type}/${id}`);
});

// ── ADD TAG ─────────────────────────────────────────────────
router.post('/contacts/:type/:id/tag', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { type, id } = req.params;
  const { tag_id } = req.body;

  if (tag_id) {
    try {
      db.prepare("INSERT OR IGNORE INTO contact_tag_assignments (contact_type, contact_id, tag_id) VALUES (?, ?, ?)")
        .run(type, id, tag_id);
    } catch (e) { /* duplicate */ }
  }

  req.session.flash = { type: 'success', message: 'Tag added.' };
  res.redirect(`/admin/crm/contacts/${type}/${id}`);
});

// ── REMOVE TAG ──────────────────────────────────────────────
router.post('/contacts/:type/:id/untag/:tagId', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { type, id, tagId } = req.params;

  db.prepare("DELETE FROM contact_tag_assignments WHERE contact_type = ? AND contact_id = ? AND tag_id = ?")
    .run(type, id, tagId);

  req.session.flash = { type: 'success', message: 'Tag removed.' };
  res.redirect(`/admin/crm/contacts/${type}/${id}`);
});

// ── TAG MANAGEMENT ──────────────────────────────────────────
router.get('/tags', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const tags = db.prepare(`
    SELECT ct.*, COUNT(cta.id) as usage_count
    FROM contact_tags ct LEFT JOIN contact_tag_assignments cta ON ct.id = cta.tag_id
    GROUP BY ct.id ORDER BY ct.tag_name
  `).all();

  res.render('crm/tags', { title: 'Manage Tags', tags });
});

router.post('/tags', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { tag_name, color } = req.body;

  if (!tag_name || !tag_name.trim()) {
    req.session.flash = { type: 'error', message: 'Tag name is required.' };
    return res.redirect('/admin/crm/tags');
  }

  try {
    db.prepare("INSERT INTO contact_tags (tag_name, color) VALUES (?, ?)").run(tag_name.trim(), color || '#5E6B52');
    req.session.flash = { type: 'success', message: 'Tag created.' };
  } catch (e) {
    req.session.flash = { type: 'error', message: 'Tag already exists.' };
  }
  res.redirect('/admin/crm/tags');
});

router.post('/tags/:id/delete', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  db.prepare("DELETE FROM contact_tags WHERE id = ?").run(req.params.id);
  req.session.flash = { type: 'success', message: 'Tag deleted.' };
  res.redirect('/admin/crm/tags');
});

module.exports = router;
