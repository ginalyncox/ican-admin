// Dynamic program/initiative definitions loaded from database at startup
// Maintains backward compatibility with PROGRAM_INFO shape used in 70+ files
//
// IMPORTANT: We mutate the same object references (not reassign) so that
// files that destructure with `const { PROGRAM_INFO } = require(...)` at
// module-load time still see updated data after loadInitiatives() runs.

const PROGRAM_INFO = {};
const VALID_PROGRAMS = [];
const INITIATIVES = [];

function loadInitiatives(db) {
  try {
    const rows = db.prepare(`
      SELECT * FROM initiatives WHERE visibility != 'archived' ORDER BY sort_order ASC
    `).all();

    // Clear existing keys (mutate in place, don't reassign)
    for (const key of Object.keys(PROGRAM_INFO)) delete PROGRAM_INFO[key];
    VALID_PROGRAMS.length = 0;
    INITIATIVES.length = 0;
    INITIATIVES.push(...rows);

    for (const row of rows) {
      PROGRAM_INFO[row.slug] = {
        label: row.program_name,
        sdgNumber: row.sdg_number,
        sdgLabel: 'SDG ' + row.sdg_number + ': ' + row.sdg_label,
        sdgColor: row.sdg_color,
        color: row.color,
        description: row.description || '',
        icon: row.icon || '🌱',
        visibility: row.visibility,
        requiresApplication: row.requires_application,
        volunteerInstructions: row.volunteer_instructions || '',
        id: row.id,
        slug: row.slug,
      };
    }

    VALID_PROGRAMS.push(...Object.keys(PROGRAM_INFO));
  } catch (e) {
    // Fallback to hard-coded if table doesn't exist yet
    console.log('Note: initiatives table not found, using defaults');
    const defaults = {
      victory_garden: { label: 'Victory Garden', color: '#2D6A3F', description: 'Grow food for Iowans in need.', sdgLabel: 'SDG 2: Zero Hunger', sdgNumber: 2, sdgColor: '#DDA63A', icon: '🌾', visibility: 'public' },
      legislative: { label: 'Legislative Action', color: '#6366f1', description: 'Help advance cannabis policy.', sdgLabel: 'SDG 16: Peace, Justice & Strong Institutions', sdgNumber: 16, sdgColor: '#00689D', icon: '⚖️', visibility: 'public' },
      outreach: { label: 'Community Outreach', color: '#f59e0b', description: 'Be the face of ICAN.', sdgLabel: 'SDG 11: Sustainable Cities & Communities', sdgNumber: 11, sdgColor: '#FD9D24', icon: '🏘️', visibility: 'public' },
      fundraising: { label: 'Fundraising', color: '#10b981', description: 'Help sustain ICAN.', sdgLabel: 'SDG 17: Partnerships for the Goals', sdgNumber: 17, sdgColor: '#19486A', icon: '🤝', visibility: 'public' },
      communications: { label: 'Communications', color: '#8b5cf6', description: "Shape ICAN's public voice.", sdgLabel: 'SDG 4: Quality Education', sdgNumber: 4, sdgColor: '#C5192D', icon: '📢', visibility: 'public' },
      membership: { label: 'Membership', color: '#ec4899', description: 'Grow our volunteer base.', sdgLabel: 'SDG 10: Reduced Inequalities', sdgNumber: 10, sdgColor: '#DD1367', icon: '🤗', visibility: 'public' },
    };
    Object.assign(PROGRAM_INFO, defaults);
    VALID_PROGRAMS.push(...Object.keys(PROGRAM_INFO));
  }
}

module.exports = { PROGRAM_INFO, VALID_PROGRAMS, INITIATIVES, loadInitiatives };
