// Shared program definitions used across admin and member portals
const PROGRAM_INFO = {
  victory_garden: {
    label: 'Victory Garden',
    color: '#2D6A3F',
    description: 'Grow food for Iowans in need. Log harvests, track volunteer hours, and compete on the seasonal leaderboard. Our flagship community program.'
  },
  legislative: {
    label: 'Legislative Action',
    color: '#6366f1',
    description: 'Help advance cannabis policy in Iowa. Attend lobby days, write legislators, and support grassroots advocacy campaigns.'
  },
  outreach: {
    label: 'Community Outreach',
    color: '#f59e0b',
    description: 'Be the face of ICAN in your community. Staff event booths, give presentations, and build relationships with local organizations.'
  },
  fundraising: {
    label: 'Fundraising',
    color: '#10b981',
    description: 'Help sustain ICAN\'s mission. Organize events, coordinate donor campaigns, and assist with grant writing.'
  },
  communications: {
    label: 'Communications',
    color: '#8b5cf6',
    description: 'Shape ICAN\'s public voice. Write newsletter content, manage social media posts, and create marketing materials.'
  },
  membership: {
    label: 'Membership',
    color: '#ec4899',
    description: 'Grow our volunteer base. Recruit new members, plan onboarding events, and help with retention outreach.'
  }
};

const VALID_PROGRAMS = Object.keys(PROGRAM_INFO);

module.exports = { PROGRAM_INFO, VALID_PROGRAMS };
