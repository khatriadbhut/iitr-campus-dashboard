# IITR Campus Dashboard

IITR Campus Dashboard is a visionary, all-in-one digital ecosystem designed to unify the fragmented pulse of IIT Roorkee’s campus life into a single, intuitive interface. By consolidating scattered updates from Slack, WhatsApp, and email into a centralized feed, the platform empowers students with seamless event discovery through smart filtering, real-time RSVP tracking, and an integrated official academic calendar. It bridges the gap between organizer clubs and attendees, transforming chaotic "information overload" into a streamlined experience where high-octane cultural fests, critical recruitment talks, and late-night hackathons coexist in one synchronized view. Built to eliminate the need for constant app switching, it ensures that every member of the IITR community stays organized, informed, and connected to the heartbeat of the campus.

---

## Start here — the Developer Handbook

**Every new developer starts with [docs/ONBOARDING.md](docs/ONBOARDING.md).** It is the complete
handbook for this codebase — 100 pages, written so that the *same pages* work for someone who has
never built a web app, someone who writes React and Node every day, and someone who has to ship a
fix this afternoon.

| | |
|---|---|
| **[docs/ONBOARDING.md](docs/ONBOARDING.md)** | the source. Read it on GitHub. |
| `./scripts/build-handbook.sh` | regenerates the PDF after you edit the markdown. |

How it works for each of the three:

- **"Start here" table and three level checklists.** Tick what you already know and it tells you
  whether you are a Newcomer, a Contributor or a Maintainer *for this app*, and which pages that
  means you should read. The third checklist is deliberately app-specific — an experienced developer
  who has not read the codebase will tick almost none of it, which is the useful signal.
- **A skip line under all 109 sections** — *"Skip if: you can already read a `sequelize.define`
  block"* — so any section can be judged in a glance and read on its own.
- **A "short version" box under every Part heading.** Read only those fourteen boxes and you still
  hold the whole system.
- **[The expert track](docs/ONBOARDING.md#the-expert-track--worth-reading-even-if-you-are-senior)** —
  twenty non-obvious decisions in this codebase, each with the measurement behind it. About an hour,
  and it is the difference between being able to change this app and being able to maintain it.
- **Three appendices** — a cheat sheet, an "I need to…" task index, and every endpoint in the API.

What it covers: the stack from first principles, local setup, the request lifecycle, all ~26 database
tables, all ~84 endpoints, a file-by-file tour of both halves, deep dives on each feature (including
the email-ingestion pipeline), deployment and operations, change recipes, and the traps.

## Live Links

Everything is served from one domain. The marketing landing page owns the root, the app is mounted
under `/app/`, and the API under `/api/` — that split is load-bearing, see the handbook.

| | |
|---|---|
| **Landing page** | <https://campus-dashboard.iitr.ac.in/> |
| **The app** | <https://campus-dashboard.iitr.ac.in/app/> |
| **API** | <https://campus-dashboard.iitr.ac.in/api/> — health check at `/api/health` |

Hosted on AWS in `ap-south-1`: CloudFront in front of S3 (the SPA and posters) and an EC2 instance
running the API against RDS PostgreSQL.

> **The old Vercel and Render deployment is retired.** `campus-dashboard-event-planner.vercel.app`
> still answers, but its backend (`campus-event-planner-backend.onrender.com`) is gone, so it is a
> broken copy of the app. Do not link people to it.

---

## Tech Stack

### **Frontend**
- **Framework:** React 19
- **Build Tool:** Vite
- **Routing:** React Router v8
- **Styling:** Vanilla CSS
- **Icons:** Lucide React
- **Mobile Support:** PWA (Progressive Web App)
- **Deployment:** S3 + CloudFront (AWS `ap-south-1`)

### **Backend**
- **Runtime:** Node.js
- **Framework:** Express 5
- **Database:** PostgreSQL
- **ORM:** Sequelize
- **Authentication:** JWT & Cookie-based sessions
- **Integration:** Channel-i OAuth (IIT Roorkee)
- **Deployment:** EC2 (nginx + Docker) against RDS PostgreSQL

---

## Project Structure

This repository is organized as a monorepo containing both the frontend and the backend development files.

- `/src`: Frontend React application.
- `/temp_backend`: Node.js Express backend and database configurations.

---

## Getting Started

The full walkthrough — including what to do when it does not work — is
[Part 2 of the handbook](docs/ONBOARDING.md#part-2--running-it-on-your-laptop). The short version:

### Prerequisites

- **Node.js 22 or newer** (26 in CI and production)
- **PostgreSQL 14+** — local or hosted, either is fine
- Git

### 1. Backend first

The frontend is useless without it, so start here.

```bash
cd temp_backend
npm install
cp .env.example .env
createdb campus_dashboard          # if you are running Postgres locally
```

Two values in `temp_backend/.env` are genuinely required:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_dashboard
JWT_SECRET=any_long_random_string_will_do_locally
```

You almost certainly do not have Channel-i OAuth credentials, so add these too and use the local
login backdoor instead:

```bash
DEV_LOGIN=true
NODE_ENV=development
FRONTEND_REDIRECT_URL=http://127.0.0.1:5173/app/home
```

```bash
npm run dev        # port 8081
```

**The tables create themselves on first boot** — no migration step needed for a fresh database.
Everything else (Gmail ingestion, the LLMs, S3, Sentry) is optional and stays off until configured.

### 2. Frontend

From the repository root, in a second terminal:

```bash
npm install
npm run dev        # port 5173
```

### 3. Log in and open it

```bash
open http://127.0.0.1:8081/oauth/dev-login    # creates a local admin and signs you in
```

Then open **<http://127.0.0.1:5173/app/>** — note the `/app/`. The bare root will not work: the
router is mounted under that prefix, because the marketing landing page owns `/` in production.

---

## Notes

**There is no frontend `.env` to configure.** The API base is pinned to `/api` in
`src/services/api.js` and proxied to the backend by Vite in dev, nginx in Docker, and CloudFront in
production — so the browser sees one origin everywhere.

`VITE_API_URL` is deliberately **ignored in production builds**. It used to be read first, which
meant a stray value in a local `.env` could redirect every API call — session cookie included — and
that is exactly what happened once: `VITE_API_URL=http://localhost:8081` was baked into a production
bundle, because Vite loads `.env` in every mode. It survives only as a dev-only escape hatch. If you
just want the dev proxy pointed at a different backend, set `VITE_PROXY_TARGET`.

The root `.env.example` is **stale** — it advertises that variable and an ImgBB key for a service
that was removed. Ignore it. See [the handbook](docs/ONBOARDING.md#part-2--running-it-on-your-laptop).


## Contributing

One remote, `origin` — <https://github.com/khatriadbhut/Campus-Dashboard-Event-Planner>.

```bash
git pull origin main          # always start from the latest

# do your work
git add .
git commit -m "..."

git push origin main
```

If you changed anything under `docs/ONBOARDING.md`, regenerate the handbook PDF before committing:

```bash
npm install --no-save marked      # once; it is a docs tool, not a project dependency
./scripts/build-handbook.sh
```
