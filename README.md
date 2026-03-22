# ICAN Admin — Iowa Cannabis Action Network

Internal management platform for the Iowa Cannabis Action Network, Inc. — a 501(c)(4) social welfare organization focused on cannabis policy reform, education, and community programs in Iowa.

**Live:** [ican-admin.onrender.com](https://ican-admin.onrender.com) · **Website:** [IowaCannabisAction.org](https://iowacannabisaction.org)

## Architecture

| Component | Technology |
|-----------|-----------|
| **Backend** | Node.js + Express |
| **Database** | SQLite (better-sqlite3) |
| **Views** | EJS + express-ejs-layouts |
| **Auth** | bcryptjs + express-session (+ optional Google OAuth) |
| **CSS** | Custom "Prairie Design System" |
| **Hosting** | Render Starter ($7/mo) |
| **Website** | GitHub Pages (custom domain) |

## Three Portals, One Login

A single login page authenticates users into role-based portals:

| Portal | URL | Who |
|--------|-----|-----|
| **Admin Console** | /admin | Super admins — full org management |
| **Volunteer Portal** | /member | Volunteers — hours, programs, events |
| **Board Portal** | /director | Board of Directors — governance, meetings, votes |

Users with multiple roles (e.g., a board member who also volunteers) see a portal selector after login.

### Org Hierarchy

```
Super Admin
  └── Full access: admin console, all portals
Board Officer (President, VP, Secretary, Treasurer)
  └── Board portal (officer actions) + Volunteer portal
Board Director
  └── Board portal + Volunteer portal
Program Coordinator (future)
  └── Enhanced volunteer portal with team management
Volunteer
  └── Volunteer portal only
Subscriber
  └── No portal access — newsletter only
```

## Features

### Admin Console
- **Dashboard** — org overview, program enrollment, portal stats
- **CRM** — People dashboard, unified contacts, interaction timeline, tags
- **Initiatives** — SDG-aligned program management (maps to UN Sustainable Development Goals)
- **Document Library** — versioned documents with audience tagging and acknowledgment tracking
- **Renewals** — retention tracking for agreements, COI disclosures, certifications
- **Site Manager** — self-service org settings and website deploy
- **Reports** — volunteer hours (annual/YTD), certified hours letters, CSV export
- **Analytics** — subscriber growth, harvest data, volunteer hours trends
- **Communications** — member messaging, newsletter, submission inbox
- **Global Search** — search across volunteers, board, subscribers, posts, events

### Volunteer Portal
- **Onboarding** — 7-step flow: password → personal info → preferences → programs → documents → service agreement → welcome
- **Programs** — apply to initiatives, track enrollment status
- **Hours** — log hours per program, edit/delete within 7 days, export certified reports
- **Harvests** — Victory Garden harvest logging and tracking
- **Events** — calendar with RSVP
- **Milestones** — badge progression (10/25/50/100/250/500 hours)
- **Mailbox** — internal communications from admin
- **Documents** — filtered library with acknowledgment tracking
- **Dark Mode** — toggle with system preference detection

### Board Portal
- **Dashboard** — next meeting, open votes, action items, announcements
- **Meetings** — schedule, RSVP, agenda builder, attendance, printable minutes
- **Votes** — introduce motions, cast votes, auto-numbered resolutions (ICAN-YYYY-NNN)
- **Committees** — create committees, assign members, manage chairs
- **Polls** — create surveys, track responses
- **Documents** — governance documents with acknowledgment
- **COI** — annual Conflict of Interest disclosure filings
- **Calendar** — month view of meetings, votes, action items, events
- **Dark Mode** — toggle with system preference detection

## SDG-Aligned Initiatives

Programs are mapped to UN Sustainable Development Goals:

| SDG | Initiative | Status |
|-----|-----------|--------|
| SDG 2: Zero Hunger | Victory Garden Initiative | Public |
| SDG 16: Peace, Justice & Strong Institutions | Legislative Action | Public |
| SDG 11: Sustainable Cities & Communities | Community Outreach | Public |
| SDG 17: Partnerships for the Goals | Fundraising | Public |
| SDG 4: Quality Education | Communications | Public |
| SDG 10: Reduced Inequalities | Membership | Public |
| SDG 3: Good Health & Well-Being | Health & Wellness Advocacy | Private |
| SDG 8: Decent Work & Economic Growth | Economic Equity | Private |
| SDG 12: Responsible Consumption & Production | Sustainable Cultivation | Private |
| SDG 13: Climate Action | Climate & Regenerative Agriculture | Private |
| SDG 15: Life on Land | Land Stewardship | Private |

## Setup

### Prerequisites
- Node.js 18+
- npm

### Install
```bash
git clone https://github.com/ginalyncox/ican-admin.git
cd ican-admin
npm install
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 4000) |
| `NODE_ENV` | No | Set to `production` on Render |
| `SESSION_SECRET` | Yes (prod) | Session encryption key |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |

### Run
```bash
node server.js
# → http://localhost:4000/login
```

### Default Login
```
Email: hello@iowacannabisaction.org
Password: changeme123
```

### Google OAuth Setup (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select existing
3. Navigate to **APIs & Services → Credentials**
4. Create an **OAuth 2.0 Client ID** (Web application)
5. Add authorized redirect URIs:
   - `http://localhost:4000/auth/google/callback` (dev)
   - `https://ican-admin.onrender.com/auth/google/callback` (prod)
6. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables
7. The "Sign in with Google" button will automatically appear on the login page

Note: Google OAuth only works for email addresses that already have an account in the system. It doesn't create new accounts — it's a convenience login for existing users.

## Database

SQLite with WAL mode. Two database files:

| File | Purpose |
|------|---------|
| `db/ican.db` | Main application database (~50 tables) |
| `db/sessions.db` | Login sessions (separate to avoid locking contention) |

### Key Tables

| Table | Purpose |
|-------|---------|
| `accounts` | Unified auth (email, password, roles JSON) |
| `users` | Admin staff profiles |
| `gardeners` | Volunteer profiles |
| `board_members` | Board member profiles + governance data |
| `member_credentials` | Volunteer portal credentials |
| `initiatives` | SDG-aligned programs (replaces hard-coded programs) |
| `board_documents` | Document library with versioning |
| `signed_agreements` | Electronic signature records |
| `contact_interactions` | CRM interaction timeline |
| `renewal_items` | Retention/renewal tracking |
| `site_settings` | Self-service org configuration |

## Project Structure

```
ican-admin/
├── server.js              # Express app + database setup + migrations
├── lib/
│   ├── constants.js        # Dynamic initiative/program definitions
│   ├── activity-log.js     # Activity logging helper
│   ├── session-store.js    # SQLite session store
│   └── google-auth.js      # Google OAuth configuration
├── middleware/
│   ├── auth.js             # Admin auth middleware
│   ├── member-auth.js      # Volunteer portal middleware
│   └── director-auth.js    # Board portal middleware
├── routes/
│   ├── auth.js             # Unified login/logout/portal-select
│   ├── dashboard.js        # Admin dashboard
│   ├── crm.js              # CRM — contacts, tags, interactions
│   ├── initiatives.js      # SDG initiative management
│   ├── doc-library.js      # Document library + agreements
│   ├── retention.js        # Renewal tracking
│   ├── site-manager.js     # Org settings + deploy
│   ├── member.js           # Volunteer portal routes
│   ├── director.js         # Board portal routes
│   ├── garden.js           # Victory Garden management
│   ├── reports.js          # Volunteer hours reports
│   ├── search.js           # Global search
│   └── ...                 # Posts, pages, events, etc.
├── views/
│   ├── unified-login.ejs   # Single login page
│   ├── portal-select.ejs   # Portal chooser
│   ├── layout.ejs          # Admin layout + sidebar
│   ├── dashboard.ejs       # Admin dashboard
│   ├── member/             # Volunteer portal views
│   ├── director/           # Board portal views
│   ├── crm/                # CRM views
│   ├── doc-library/        # Document library views
│   ├── retention/          # Renewal views
│   ├── site-manager/       # Site manager views
│   ├── initiatives/        # Initiative management views
│   └── ...
├── public/
│   └── admin.css           # Prairie Design System stylesheet
├── uploads/board/          # Uploaded documents
├── db/
│   ├── ican.db             # Main database
│   └── sessions.db         # Session store
└── migrations/
    └── 006-indexes.sql     # Performance indexes
```

## Brand — Prairie Design System

| Element | Light | Dark |
|---------|-------|------|
| Primary | #2D6A3F | #5DA06E |
| Accent | #B8862B | #D4A43A |
| Background | #F5F3ED | #141A12 |
| Text | #1E2418 | #D4D9CF |
| Muted | #5E6B52 | #8A9478 |

**Fonts:** Work Sans (body), Georgia (display fallback)

## Organization

**Iowa Cannabis Action Network, Inc.**
- Type: 501(c)(4) Social Welfare Organization
- EIN: 41-2746368
- Iowa Corp No: 849500
- Founded: November 22, 2025
- Website: [IowaCannabisAction.org](https://iowacannabisaction.org)
- Email: hello@iowacannabisaction.org

## License

Private repository. All rights reserved by Iowa Cannabis Action Network, Inc.
