/**
 * Activity Log helper — records admin actions for audit trail.
 * Usage: logActivity(db, { userId, userName, action, entityType, entityId, entityLabel, details })
 */
function logActivity(db, { userId, userName, action, entityType, entityId, entityLabel, details }) {
  try {
    db.prepare(`
      INSERT INTO activity_log (user_id, user_name, action, entity_type, entity_id, entity_label, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId || null, userName || null, action, entityType, entityId || null, entityLabel || null, details || null);
  } catch (e) {
    console.error('Activity log error:', e.message);
  }
}

function getRecentActivity(db, limit = 20) {
  try {
    return db.prepare(`
      SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  } catch (e) {
    return [];
  }
}

module.exports = { logActivity, getRecentActivity };
