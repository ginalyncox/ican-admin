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

  // Upcoming events count
  const upcomingEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE event_date >= date('now')").get().count;

  // Newsletter sends count
  const totalNewsletterSends = db.prepare('SELECT COUNT(*) as count FROM newsletter_sends').get().count;

  res.render('dashboard', {
    title: 'Dashboard',
    stats: { totalPosts, publishedPosts, unreadSubmissions, totalSubscribers, activeGardeners, pendingVerifications, upcomingEvents, totalNewsletterSends },
    recentPosts,
    recentSubmissions
  });
});

// Analytics dashboard
router.get('/analytics', requireAuth, (req, res) => {
  const db = req.app.locals.db;

  // Subscriber growth by month (last 12 months)
  const subscriberGrowth = db.prepare(`
    SELECT strftime('%Y-%m', subscribed_at) as month, COUNT(*) as count
    FROM subscribers
    WHERE subscribed_at >= date('now', '-12 months')
    GROUP BY month ORDER BY month ASC
  `).all();

  // Submissions by type
  const submissionsByType = db.prepare(`
    SELECT form_type, COUNT(*) as count FROM submissions GROUP BY form_type
  `).all();

  // Harvest totals by month (current year)
  const harvestByMonth = db.prepare(`
    SELECT strftime('%Y-%m', harvest_date) as month, COALESCE(SUM(pounds), 0) as total_lbs
    FROM garden_harvests
    WHERE harvest_date >= date('now', 'start of year')
    GROUP BY month ORDER BY month ASC
  `).all();

  // Volunteer hours by month (current year)
  const hoursByMonth = db.prepare(`
    SELECT strftime('%Y-%m', work_date) as month, COALESCE(SUM(hours), 0) as total_hrs
    FROM garden_hours
    WHERE work_date >= date('now', 'start of year')
    GROUP BY month ORDER BY month ASC
  `).all();

  // Donation verification breakdown
  const verificationStats = db.prepare(`
    SELECT donation_status, COUNT(*) as count FROM garden_harvests WHERE donated = 1 GROUP BY donation_status
  `).all();

  // Top crops
  const topCrops = db.prepare(`
    SELECT crop, COALESCE(SUM(pounds), 0) as total_lbs, COUNT(*) as entries
    FROM garden_harvests GROUP BY crop ORDER BY total_lbs DESC LIMIT 10
  `).all();

  // Events by type
  const eventsByType = db.prepare(`
    SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type
  `).all();

  // Summary stats
  const totalSubscribers = db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status = 'active'").get().c;
  const totalHarvestLbs = db.prepare('SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests').get().c;
  const totalVolunteerHrs = db.prepare('SELECT COALESCE(SUM(hours), 0) as c FROM garden_hours').get().c;
  const totalDonatedLbs = db.prepare('SELECT COALESCE(SUM(pounds), 0) as c FROM garden_harvests WHERE donated = 1').get().c;
  const totalGardeners = db.prepare('SELECT COUNT(*) as c FROM gardeners').get().c;
  const totalEvents = db.prepare('SELECT COUNT(*) as c FROM events').get().c;

  res.render('analytics', {
    title: 'Analytics',
    subscriberGrowth,
    submissionsByType,
    harvestByMonth,
    hoursByMonth,
    verificationStats,
    topCrops,
    eventsByType,
    summary: { totalSubscribers, totalHarvestLbs, totalVolunteerHrs, totalDonatedLbs, totalGardeners, totalEvents }
  });
});

module.exports = router;
