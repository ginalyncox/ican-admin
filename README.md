# ICAN Admin Backend

Staff admin panel for **Iowa Cannabis Action Network, Inc.** — Victory Garden program tracker, donation verification, blog management, and member portal.

## Features

- **Victory Garden Tracker** — Manage seasons, garden sites, gardeners, harvest logs, volunteer hours
- **Donation Verification** — Streamlined queue with batch verify/flag, grouped by recipient
- **Donation Reports** — Breakdowns by recipient, crop, and monthly totals
- **Contest Leaderboard** — Ranked by harvest lbs and volunteer hours
- **Awards Management** — For the annual dinner ceremony
- **Member Portal** — Gardeners can log in, view their stats, rankings, and awards
- **Blog & CMS** — Write/publish posts, manage site pages
- **Form Submissions** — View contact/volunteer/newsletter form data
- **Subscriber Management** — CSV export, status tracking

## Tech Stack

Node.js, Express, SQLite (better-sqlite3), EJS templates, bcrypt

## Quick Start

```bash
npm install
node server.js
```

Open `http://localhost:4000/admin`

**Default login:** hello@iowacannabisaction.org / changeme123

## Deploy to Render

1. Go to [render.com](https://render.com) and sign up (free)
2. Click **New → Web Service**
3. Connect this GitHub repo
4. Render auto-detects settings from `render.yaml`
5. Click **Deploy**

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Server port |
| `SESSION_SECRET` | (dev default) | Session encryption key (auto-generated on Render) |
| `NODE_ENV` | `development` | Set to `production` for secure cookies |
