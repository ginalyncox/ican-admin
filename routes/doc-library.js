const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../lib/activity-log');
const router = express.Router();

// File upload
const boardUploadsDir = path.join(__dirname, '..', 'uploads', 'board');
if (!fs.existsSync(boardUploadsDir)) fs.mkdirSync(boardUploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, boardUploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, 'doc-' + Date.now() + '-' + Math.round(Math.random() * 1000) + ext);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|png|jpg|jpeg)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// ── LIBRARY INDEX ─────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const category = req.query.category || '';
  const audience = req.query.audience || '';
  const docType = req.query.type || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (category) { where += ' AND d.category = ?'; params.push(category); }
  if (audience) { where += ' AND d.audience = ?'; params.push(audience); }
  if (docType) { where += ' AND d.doc_type = ?'; params.push(docType); }

  const docs = db.prepare(`
    SELECT d.*,
      b.first_name || ' ' || b.last_name as uploaded_by_name,
      (SELECT COUNT(*) FROM document_acknowledgments WHERE document_id = d.id) as ack_count,
      (SELECT COUNT(*) FROM document_versions WHERE document_id = d.id) as version_count
    FROM board_documents d
    LEFT JOIN board_members b ON d.uploaded_by = b.id
    ${where}
    ORDER BY d.sort_order ASC, d.category ASC, d.title ASC
  `).all(...params);

  const categories = db.prepare('SELECT DISTINCT category FROM board_documents ORDER BY category').all().map(r => r.category);
  
  // Pending ack stats
  const totalRequired = db.prepare("SELECT COUNT(*) as c FROM board_documents WHERE is_required = 1").get().c;
  const totalVolunteers = db.prepare("SELECT COUNT(*) as c FROM member_credentials").get().c;
  const totalDirectors = db.prepare("SELECT COUNT(*) as c FROM board_members WHERE status = 'active'").get().c;

  res.render('doc-library/index', {
    title: 'Document Library',
    docs,
    categories,
    filters: { category, audience, type: docType },
    stats: { totalRequired, totalVolunteers, totalDirectors, totalDocs: docs.length }
  });
});

// ── UPLOAD NEW DOCUMENT ───────────────────────────────────
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  const db = req.app.locals.db;
  const { title, description, category, audience, doc_type, is_required, is_confidential } = req.body;

  if (!req.file) {
    req.session.flash = { type: 'error', message: 'Please select a file to upload.' };
    return res.redirect('/admin/documents');
  }

  try {
    const result = db.prepare(`
      INSERT INTO board_documents (title, description, category, audience, doc_type, filename, original_name, file_size, uploaded_by, is_required, is_confidential, version, version_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Initial version')
    `).run(
      title || req.file.originalname,
      description || null,
      category || 'general',
      audience || 'all',
      doc_type || 'document',
      req.file.filename,
      req.file.originalname,
      req.file.size,
      null, // admin upload, not a board member
      is_required ? 1 : 0,
      is_confidential ? 1 : 0
    );

    // Also save to version history
    db.prepare(`
      INSERT INTO document_versions (document_id, version, filename, original_name, file_size, version_notes, uploaded_by)
      VALUES (?, 1, ?, ?, ?, 'Initial version', NULL)
    `).run(result.lastInsertRowid, req.file.filename, req.file.originalname, req.file.size);

    // Auto-create a board_resource entry so it appears in legacy resource views
    db.prepare(`
      INSERT INTO board_resources (title, description, category, resource_type, document_id, pinned, created_by)
      VALUES (?, ?, ?, 'document', ?, 0, NULL)
    `).run(title || req.file.originalname, description || null, mapDocCategoryToResourceCategory(category), result.lastInsertRowid);

    logActivity(db, { userId: null, userName: 'Admin', action: 'uploaded', entityType: 'document', entityLabel: title || req.file.originalname });
    req.session.flash = { type: 'success', message: 'Document uploaded to library.' };
  } catch (err) {
    console.error('Upload error:', err);
    req.session.flash = { type: 'error', message: 'Failed to upload document.' };
  }
  res.redirect('/admin/documents');
});

function mapDocCategoryToResourceCategory(cat) {
  const map = { bylaws: 'governance', policy: 'governance', compliance: 'compliance', financial: 'financial', legal: 'legal', resolution: 'governance', report: 'reference', general: 'general', minutes: 'governance', form: 'template' };
  return map[cat] || 'general';
}

// ── ACKNOWLEDGMENT DASHBOARD ──────────────────────────────
router.get('/ack/dashboard', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  
  const requiredDocs = db.prepare(`
    SELECT d.*, 
      (SELECT COUNT(*) FROM document_acknowledgments WHERE document_id = d.id
        ${' AND (d.ack_required_after IS NULL OR acknowledged_at >= d.ack_required_after)'}
      ) as current_ack_count
    FROM board_documents d
    WHERE d.is_required = 1
    ORDER BY d.title
  `).all();

  const totalVolunteers = db.prepare("SELECT COUNT(*) as c FROM gardeners WHERE status = 'active'").get().c;
  const totalDirectors = db.prepare("SELECT COUNT(*) as c FROM board_members WHERE status = 'active'").get().c;

  res.render('doc-library/ack-dashboard', {
    title: 'Acknowledgment Tracking',
    requiredDocs,
    totalVolunteers,
    totalDirectors
  });
});

// ── DOCUMENT DETAIL / EDIT ────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const doc = db.prepare(`
    SELECT d.*, b.first_name || ' ' || b.last_name as uploaded_by_name
    FROM board_documents d
    LEFT JOIN board_members b ON d.uploaded_by = b.id
    WHERE d.id = ?
  `).get(req.params.id);
  if (!doc) {
    req.session.flash = { type: 'error', message: 'Document not found.' };
    return res.redirect('/admin/documents');
  }

  // Version history
  const versions = db.prepare(`
    SELECT v.*, b.first_name || ' ' || b.last_name as uploaded_by_name
    FROM document_versions v
    LEFT JOIN board_members b ON v.uploaded_by = b.id
    WHERE v.document_id = ?
    ORDER BY v.version DESC
  `).all(req.params.id);

  // Acknowledgment stats
  const acks = db.prepare(`
    SELECT da.*, 
      CASE da.user_type
        WHEN 'volunteer' THEN (SELECT first_name || ' ' || last_name FROM gardeners WHERE id = da.user_id)
        WHEN 'director' THEN (SELECT first_name || ' ' || last_name FROM board_members WHERE id = da.user_id)
      END as user_name
    FROM document_acknowledgments da
    WHERE da.document_id = ?
    ORDER BY da.acknowledged_at DESC
  `).all(req.params.id);

  // Who hasn't acknowledged (if required)
  let pendingVolunteers = [];
  let pendingDirectors = [];
  if (doc.is_required) {
    if (doc.audience === 'all' || doc.audience === 'volunteer') {
      pendingVolunteers = db.prepare(`
        SELECT g.id, g.first_name, g.last_name FROM gardeners g
        JOIN member_credentials mc ON mc.gardener_id = g.id
        WHERE g.status = 'active'
        AND g.id NOT IN (
          SELECT user_id FROM document_acknowledgments 
          WHERE document_id = ? AND user_type = 'volunteer'
          ${doc.ack_required_after ? "AND acknowledged_at >= '" + doc.ack_required_after + "'" : ''}
        )
      `).all(req.params.id);
    }
    if (doc.audience === 'all' || doc.audience === 'director') {
      pendingDirectors = db.prepare(`
        SELECT id, first_name, last_name FROM board_members
        WHERE status = 'active'
        AND id NOT IN (
          SELECT user_id FROM document_acknowledgments 
          WHERE document_id = ? AND user_type = 'director'
          ${doc.ack_required_after ? "AND acknowledged_at >= '" + doc.ack_required_after + "'" : ''}
        )
      `).all(req.params.id);
    }
  }

  res.render('doc-library/detail', {
    title: doc.title,
    doc,
    versions,
    acks,
    pendingVolunteers,
    pendingDirectors
  });
});

// ── UPDATE DOCUMENT METADATA ──────────────────────────────
router.post('/:id/edit', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const { title, description, category, audience, doc_type, is_required, is_confidential, sort_order } = req.body;

  db.prepare(`
    UPDATE board_documents SET title = ?, description = ?, category = ?, audience = ?, doc_type = ?, 
      is_required = ?, is_confidential = ?, sort_order = ?
    WHERE id = ?
  `).run(
    title, description || null, category || 'general', audience || 'all', doc_type || 'document',
    is_required ? 1 : 0, is_confidential ? 1 : 0, parseInt(sort_order) || 99, req.params.id
  );

  req.session.flash = { type: 'success', message: 'Document updated.' };
  res.redirect('/admin/documents/' + req.params.id);
});

// ── UPLOAD NEW VERSION ────────────────────────────────────
router.post('/:id/new-version', requireAuth, upload.single('file'), (req, res) => {
  const db = req.app.locals.db;
  const { version_notes } = req.body;

  if (!req.file) {
    req.session.flash = { type: 'error', message: 'Please select a file.' };
    return res.redirect('/admin/documents/' + req.params.id);
  }

  const doc = db.prepare('SELECT * FROM board_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.redirect('/admin/documents');

  const newVersion = (doc.version || 1) + 1;

  const tx = db.transaction(() => {
    // Save current version to history (if not already there)
    const existingVersion = db.prepare('SELECT id FROM document_versions WHERE document_id = ? AND version = ?').get(doc.id, doc.version || 1);
    if (!existingVersion) {
      db.prepare(`
        INSERT INTO document_versions (document_id, version, filename, original_name, file_size, version_notes, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(doc.id, doc.version || 1, doc.filename, doc.original_name, doc.file_size, doc.version_notes || 'Previous version', doc.uploaded_by);
    }

    // Save new version to history
    db.prepare(`
      INSERT INTO document_versions (document_id, version, filename, original_name, file_size, version_notes, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(doc.id, newVersion, req.file.filename, req.file.originalname, req.file.size, version_notes || null);

    // Update the main document record
    db.prepare(`
      UPDATE board_documents SET filename = ?, original_name = ?, file_size = ?, version = ?, version_notes = ?
      WHERE id = ?
    `).run(req.file.filename, req.file.originalname, req.file.size, newVersion, version_notes || null, doc.id);
  });

  tx();

  logActivity(db, { userId: null, userName: 'Admin', action: 'updated', entityType: 'document', entityLabel: doc.title + ' (v' + newVersion + ')' });
  req.session.flash = { type: 'success', message: 'New version (v' + newVersion + ') uploaded.' };
  res.redirect('/admin/documents/' + req.params.id);
});

// ── REQUIRE RE-ACKNOWLEDGMENT ─────────────────────────────
router.post('/:id/require-reack', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  db.prepare(`UPDATE board_documents SET ack_required_after = datetime('now'), is_required = 1 WHERE id = ?`).run(req.params.id);
  const doc = db.prepare('SELECT title FROM board_documents WHERE id = ?').get(req.params.id);
  
  // Send notification to member mailboxes
  try {
    db.prepare(`
      INSERT INTO member_messages (subject, body, message_type, sender_name)
      VALUES (?, ?, 'announcement', 'ICAN Admin')
    `).run(
      'Action Required: Review Updated Document',
      'The document "' + (doc ? doc.title : 'Unknown') + '" has been updated and requires your acknowledgment. Please visit the Document Library in your portal to review and acknowledge the updated document.'
    );
  } catch (e) { /* table may not exist */ }

  req.session.flash = { type: 'success', message: 'Re-acknowledgment required. Members will be notified.' };
  res.redirect('/admin/documents/' + req.params.id);
});

// ── DOWNLOAD (any version) ────────────────────────────────
router.get('/:id/download', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const versionNum = req.query.version;
  
  let doc;
  if (versionNum) {
    doc = db.prepare('SELECT filename, original_name FROM document_versions WHERE document_id = ? AND version = ?').get(req.params.id, versionNum);
  }
  if (!doc) {
    doc = db.prepare('SELECT filename, original_name FROM board_documents WHERE id = ?').get(req.params.id);
  }
  if (!doc) {
    req.session.flash = { type: 'error', message: 'Document not found.' };
    return res.redirect('/admin/documents');
  }

  const filePath = path.join(boardUploadsDir, doc.filename);
  if (!fs.existsSync(filePath)) {
    req.session.flash = { type: 'error', message: 'File not found on server.' };
    return res.redirect('/admin/documents');
  }
  res.download(filePath, doc.original_name || doc.filename);
});

// ── DELETE DOCUMENT ───────────────────────────────────────
router.post('/:id/delete', requireAuth, requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const doc = db.prepare('SELECT * FROM board_documents WHERE id = ?').get(req.params.id);
  if (doc) {
    db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(req.params.id);
    db.prepare('DELETE FROM document_acknowledgments WHERE document_id = ?').run(req.params.id);
    db.prepare('DELETE FROM board_resources WHERE document_id = ?').run(req.params.id);
    db.prepare('DELETE FROM board_documents WHERE id = ?').run(req.params.id);
    // Clean up file
    const filePath = path.join(boardUploadsDir, doc.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  req.session.flash = { type: 'success', message: 'Document deleted.' };
  res.redirect('/admin/documents');
});

module.exports = router;
