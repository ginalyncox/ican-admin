const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;

  const totalPosts = db.prepare('SELECT COUNT(*) as count FROM posts').get().count;
  const publishedPosts = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'published'").get().count;
  const unreadSubmissions = db.prepare('SELECT COUNT(*) as count FROM submissions WHERE read = 0').get().count;
  const totalSubscribers = db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE status = 'active'").get().count;

  const recentPosts = db.prepare(`
    SELECT p.*, u.name as author_name
    FROM posts p LEFT JOIN users u ON p.author_id = u.id
    ORDER BY p.updated_at DESC LIMIT 5
  `).all();

  const recentSubmissions = db.prepare(`
    SELECT * FROM submissions ORDER BY created_at DESC LIMIT 5
  `).all();

  // Victory Garden quick stats
  const activeGardeners = db.prepare("SELECT COUNT(*) as count FROM gardeners WHERE status = 'active'").get().count;
  const pendingVerifications = db.prepare("SELECT COUNT(*) as count FROM garden_harvests WHERE donation_status = 'pending' AND donated = 1").get().count;

  res.render('dashboard', {
    title: 'Dashboard',
    stats: { totalPosts, publishedPosts, unreadSubmissions, totalSubscribers, activeGardeners, pendingVerifications },
    recentPosts,
    recentSubmissions
  });
});

module.exports = router;
