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

  // Volunteer/member stats
  const activeVolunteers = db.prepare("SELECT COUNT(*) as count FROM gardeners WHERE status = 'active'").get().count;
  const totalVolunteers = db.prepare("SELECT COUNT(*) as count FROM gardeners").get().count;
  const pendingVerifications = db.prepare("SELECT COUNT(*) as count FROM garden_harvests WHERE donation_status = 'pending' AND donated = 1").get().count;

  // Pending program applications
  let pendingApplications = 0;
  try {
    pendingApplications = db.prepare("SELECT COUNT(*) as count FROM program_applications WHERE status = 'pending'").get().count;
  } catch (e) { /* table may not exist yet */ }

  // Program enrollment counts
  let programCounts = {};
  try {
    const programs = db.prepare('SELECT program, COUNT(*) as count FROM volunteer_programs GROUP BY program').all();
    for (const p of programs) { programCounts[p.program] = p.count; }
  } catch (e) { /* table may not exist yet */ }

  // Upcoming events count
  const upcomingEvents = db.prepare("SELECT COUNT(*) as count FROM events WHERE event_date >= date('now')").get().count;

  // Newsletter sends count
  const totalNewsletterSends = db.prepare('SELECT COUNT(*) as count FROM newsletter_sends').get().count;

  // Board & Portal stats
  let activeBoardMembers = 0;
  let memberPortalUsers = 0;
  let openBoardVotes = 0;
  let upcomingBoardMeetings = 0;
  try {
    activeBoardMembers = db.prepare("SELECT COUNT(*) as count FROM board_members WHERE status = 'active'").get().count;
    openBoardVotes = db.prepare("SELECT COUNT(*) as count FROM board_votes WHERE status IN ('pending', 'open')").get().count;
    upcomingBoardMeetings = db.prepare("SELECT COUNT(*) as count FROM board_meetings WHERE meeting_date >= date('now') AND status != 'cancelled'").get().count;
  } catch (e) { /* tables may not exist yet */ }
  try {
    memberPortalUsers = db.prepare('SELECT COUNT(*) as count FROM member_credentials').get().count;
  } catch (e) { /* table may not exist yet */ }

  // Total member messages count
  let totalMessages = 0;
  try {
    totalMessages = db.prepare('SELECT COUNT(*) as count FROM member_messages').get().count;
  } catch (e) { /* table may not exist */ }

  res.render('dashboard', {
    title: 'Dashboard',
    stats: { totalPosts, publishedPosts, unreadSubmissions, totalSubscribers, activeVolunteers, totalVolunteers, pendingVerifications, pendingApplications, programCounts, upcomingEvents, totalNewsletterSends, activeBoardMembers, memberPortalUsers, openBoardVotes, upcomingBoardMeetings, totalMessages },
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
