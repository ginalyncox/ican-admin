const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'ican.db');
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Seed admin user
const email = 'hello@iowacannabisaction.org';
const password = 'changeme123';
const name = 'ICAN Admin';
const role = 'admin';

const hash = bcrypt.hashSync(password, 10);

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!existing) {
  db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)').run(email, hash, name, role);
  console.log(`Admin user created: ${email} / ${password}`);
} else {
  console.log('Admin user already exists.');
}

// Seed default pages
const pages = [
  { slug: 'about', title: 'About', content: JSON.stringify({ hero_title: 'About ICAN', hero_subtitle: 'Rooted in Iowa. Driven by Community.', sections: [] }) },
  { slug: 'legislative', title: 'Legislative', content: JSON.stringify({ hero_title: 'Legislative Watch', hero_subtitle: 'Tracking cannabis policy in the Iowa Legislature.', sections: [] }) },
  { slug: 'victory-garden', title: 'Victory Garden', content: JSON.stringify({ hero_title: 'Iowa Victory Garden Initiative', hero_subtitle: 'Fighting food insecurity one garden at a time.', sections: [] }) },
  { slug: 'get-involved', title: 'Get Involved', content: JSON.stringify({ hero_title: 'Get Involved', hero_subtitle: 'Join the movement for better cannabis policy in Iowa.', sections: [] }) }
];

const insertPage = db.prepare('INSERT OR IGNORE INTO pages (slug, title, content) VALUES (?, ?, ?)');
for (const page of pages) {
  insertPage.run(page.slug, page.title, page.content);
}
console.log('Default pages seeded.');

db.close();
console.log('Database seeded successfully.');
