#!/usr/bin/env node
/**
 * Seeds board_documents and board_resources with all ICAN organizational documents.
 * Copies files from workspace root to uploads/board/ and inserts DB records.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, 'db', 'ican.db'));
const uploadsDir = path.join(__dirname, 'uploads', 'board');

// Ensure uploads dir exists
fs.mkdirSync(uploadsDir, { recursive: true });

// Clean old board uploads (except any user-uploaded files we want to keep)
const existingFiles = fs.readdirSync(uploadsDir);
existingFiles.forEach(f => {
  fs.unlinkSync(path.join(uploadsDir, f));
});

// Clear existing seed data
db.exec('DELETE FROM board_resources');
db.exec('DELETE FROM board_documents');

// Document definitions
// board_documents categories: general, bylaws, policy, financial, legal, minutes, resolution, report, compliance
// board_resources categories: governance, training, legal, financial, compliance, reference, template, general
const documents = [
  {
    title: 'ICAN Bylaws',
    description: 'Governing bylaws of the Iowa Cannabis Action Network, Inc. Defines organizational structure, membership, board duties, meetings, and amendment procedures.',
    docCategory: 'bylaws',
    resCategory: 'governance',
    sourceFile: 'ican-bylaws.docx',
    pinned: 1
  },
  {
    title: 'Conflict of Interest Policy',
    description: 'Policy requiring board members and key personnel to disclose potential conflicts of interest and recuse from related decisions.',
    docCategory: 'policy',
    resCategory: 'governance',
    sourceFile: 'ican-conflict-of-interest.docx',
    pinned: 1
  },
  {
    title: 'Financial Policies & Procedures',
    description: 'Internal controls, expense approval authority, budgeting process, cash management, and financial reporting requirements.',
    docCategory: 'financial',
    resCategory: 'financial',
    sourceFile: 'ican-financial-policies.docx',
    pinned: 1
  },
  {
    title: 'Board Resolution — Formation',
    description: 'Founding resolution of the Board of Directors establishing ICAN as a 501(c)(4) social welfare organization.',
    docCategory: 'resolution',
    resCategory: 'governance',
    sourceFile: 'ican-board-resolution.docx',
    pinned: 0
  },
  {
    title: 'Compliance Guide',
    description: 'Comprehensive guide covering 501(c)(4) compliance requirements, lobbying rules, political activity limits, record-keeping, and annual filing obligations.',
    docCategory: 'compliance',
    resCategory: 'compliance',
    sourceFile: 'ican-compliance-guide.docx',
    pinned: 0
  },
  {
    title: 'Strategic Plan 2026–2028',
    description: 'Three-year strategic roadmap covering legislative advocacy, public education, organizational growth, and coalition building goals.',
    docCategory: 'report',
    resCategory: 'reference',
    sourceFile: 'ican-strategic-plan.docx',
    pinned: 0
  },
  {
    title: 'Volunteer Handbook',
    description: 'Comprehensive handbook for all ICAN volunteers covering expectations, program descriptions, hour logging, safety guidelines, and code of conduct.',
    docCategory: 'general',
    resCategory: 'reference',
    sourceFile: 'ican-volunteer-handbook.docx',
    pinned: 1
  },
  {
    title: 'Victory Garden Program Plan',
    description: 'Detailed operational plan for the Victory Garden Initiative including site selection, volunteer roles, growing guides, and community distribution procedures.',
    docCategory: 'report',
    resCategory: 'reference',
    sourceFile: 'ican-victory-garden-plan.docx',
    pinned: 0
  },
  {
    title: 'Donor Acknowledgment Templates (DOCX)',
    description: 'Template letters for acknowledging donor contributions including tax-deductible and non-deductible gift language per IRS requirements.',
    docCategory: 'financial',
    resCategory: 'template',
    sourceFile: 'ican-donor-acknowledgment.docx',
    pinned: 0
  },
  {
    title: 'Donor Acknowledgment Templates (PDF)',
    description: 'Print-ready PDF version of donor acknowledgment letter templates.',
    docCategory: 'financial',
    resCategory: 'template',
    sourceFile: 'ican-donor-acknowledgment.pdf',
    pinned: 0
  },
  {
    title: 'ICAN How-To Guide (DOCX)',
    description: 'Step-by-step guide for common organizational tasks including contacting legislators, organizing events, social media advocacy, and volunteer coordination.',
    docCategory: 'general',
    resCategory: 'training',
    sourceFile: 'ican-how-to-guide.docx',
    pinned: 0
  },
  {
    title: 'ICAN How-To Guide (PDF)',
    description: 'Print-ready PDF version of the How-To Guide for offline reference and distribution.',
    docCategory: 'general',
    resCategory: 'training',
    sourceFile: 'ican-how-to-guide.pdf',
    pinned: 0
  }
];

const insertDoc = db.prepare(`
  INSERT INTO board_documents (title, description, category, filename, original_name, file_size, is_confidential)
  VALUES (?, ?, ?, ?, ?, ?, 0)
`);

const insertResource = db.prepare(`
  INSERT INTO board_resources (title, description, category, resource_type, document_id, pinned)
  VALUES (?, ?, ?, 'document', ?, ?)
`);

const workspaceRoot = '/home/user/workspace';

const seedAll = db.transaction(() => {
  for (const doc of documents) {
    const srcPath = path.join(workspaceRoot, doc.sourceFile);
    
    if (!fs.existsSync(srcPath)) {
      console.error(`SKIP: ${doc.sourceFile} not found at ${srcPath}`);
      continue;
    }

    // Generate unique filename for uploads
    const ext = path.extname(doc.sourceFile);
    const timestamp = Date.now() + Math.floor(Math.random() * 1000);
    const destFilename = `board-${timestamp}${ext}`;
    const destPath = path.join(uploadsDir, destFilename);

    // Copy file
    fs.copyFileSync(srcPath, destPath);
    const stats = fs.statSync(destPath);

    // Insert into board_documents
    const result = insertDoc.run(
      doc.title,
      doc.description,
      doc.docCategory,
      destFilename,
      doc.sourceFile,
      stats.size
    );

    const docId = result.lastInsertRowid;

    // Insert matching board_resources entry
    insertResource.run(
      doc.title,
      doc.description,
      doc.resCategory,
      docId,
      doc.pinned
    );

    console.log(`✓ ${doc.title} → ${destFilename} (doc #${docId})`);
  }
});

try {
  seedAll();
  
  // Verify
  const docCount = db.prepare('SELECT COUNT(*) as c FROM board_documents').get();
  const resCount = db.prepare('SELECT COUNT(*) as c FROM board_resources').get();
  const pinnedCount = db.prepare('SELECT COUNT(*) as c FROM board_resources WHERE pinned = 1').get();
  
  console.log(`\n=== Seeding Complete ===`);
  console.log(`Documents: ${docCount.c}`);
  console.log(`Resources: ${resCount.c}`);
  console.log(`Pinned: ${pinnedCount.c}`);
  
  // List all
  console.log('\n--- Board Documents ---');
  db.prepare('SELECT id, title, category, filename FROM board_documents ORDER BY id').all()
    .forEach(d => console.log(`  [${d.id}] ${d.title} (${d.category}) → ${d.filename}`));
  
  console.log('\n--- Board Resources ---');
  db.prepare('SELECT id, title, category, pinned, document_id FROM board_resources ORDER BY id').all()
    .forEach(r => console.log(`  [${r.id}] ${r.title} (${r.category}) pinned=${r.pinned} doc=${r.document_id}`));
    
} catch (err) {
  console.error('Seeding failed:', err.message);
  process.exit(1);
} finally {
  db.close();
}
