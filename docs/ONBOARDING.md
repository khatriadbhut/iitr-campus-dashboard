# IITR Campus Dashboard — The Complete Developer Handbook

**One document, three readers.** Somebody who has never built a web app, somebody who writes React
and Node every day, and somebody who has to ship a fix this afternoon should all be able to use this
book — without any of them wading through the other two's pages.

---

## Start here

**Find the line that describes you and follow the link.** That is the whole navigation system; you
do not have to read this page.

| You are… | Go straight to | Then read, in order |
|---|---|---|
| **New to web development.** You have not built a web app. Maybe you know a little Python or C. | **[Part 0 — What this app is](#part-0--what-this-app-is-in-five-minutes)** | everything, front to back |
| **A working developer.** You write JavaScript and have shipped something with a framework and a database. | **[Part 2 — Running it on your laptop](#part-2--running-it-on-your-laptop)** | Parts [3](#part-3--the-map-of-the-repository) → [4](#part-4--system-design-the-life-of-a-request) → [6](#part-6--who-is-allowed-to-do-what) → [13](#part-13--traps-that-will-cost-you-an-afternoon) — about 90 minutes, then you can take a ticket |
| **Experienced and busy.** You need to change something today. | **[The fast path](#the-fast-path--thirty-minutes-to-your-first-change)** | the fourteen *short version* boxes, then [Appendix B](#appendix-b--i-need-to-index) |
| **Looking something up.** You already work on this app. | **[Appendix B — "I need to…" index](#appendix-b--i-need-to-index)** | or [Appendix A](#appendix-a--cheat-sheet) for commands, [Appendix C](#appendix-c--endpoint-index) for endpoints |

### What level are you, for *this* app?

Three checklists. Work down them and stop at the first block where you cannot honestly tick
everything — that block names your level and tells you where to start. The point is not the label; it
is that **each level has a different set of pages worth reading**, and reading the wrong set is how
people waste a week.

#### Block 1 — the web, generally

- [ ] You can describe what happens between typing a URL and seeing a page.
- [ ] You know what HTML, CSS and JavaScript each do, and that JS runs in the browser.
- [ ] You know what JSON is and can read one.
- [ ] You know the difference between a `200`, a `401` and a `500`.

**Any box unticked → you are a NEWCOMER here.**
Read the whole book in order, and do not skip Part 1 — it teaches exactly these things using this
app's own code, so nothing stays abstract. Budget a day.
**→ [Part 0](#part-0--what-this-app-is-in-five-minutes)**

#### Block 2 — the stack this app is built on

- [ ] You can write a React component using `useState`, `useEffect` and `useMemo`.
- [ ] You can write an Express route handler and explain what middleware and `next()` do.
- [ ] You can read a `sequelize.define` block and explain what an ORM does for you.
- [ ] You can explain `httpOnly`, `SameSite`, and how a signed JWT is verified.
- [ ] You can get a Node + PostgreSQL app running locally from a README.
- [ ] You know what a service worker does to caching.

**All of Block 1 ticked, any of Block 2 unticked → you are a CONTRIBUTOR-IN-TRAINING.**
Skip the Part 1 sections you *do* know — the ladder in Part 1 tells you which — then join everyone
else at Part 2. You will be taking tickets within a day.
**→ [Part 1's section ladder](#part-1--the-basics-explained-through-this-app)**

**All of Block 1 and Block 2 ticked → you are a CONTRIBUTOR.**
Skip Part 1 entirely. Parts 2 → 3 → 4 → 6 → 13, about ninety minutes, and you can take a ticket.
**→ [Part 2 — Running it on your laptop](#part-2--running-it-on-your-laptop)**

#### Block 3 — *this* app specifically

This block is not about seniority. Every line is something you can only learn from this codebase, and
each is a decision that will bite you if you do not know it. An experienced developer who has never
read this book will tick almost none of them — which is exactly the point.

- [ ] You can say why `is_super_admin` is a **column** and not a row in `admin_permission`.
- [ ] You know the **two** allowlists a new `event` column must be added to, and what happens if you miss one.
- [ ] You can explain what `token_version` is for and why a token *missing* the claim is rejected.
- [ ] You know why the write rate limiter keys on user id rather than IP.
- [ ] You know the four states `venue_mode` distinguishes and why they must not collapse.
- [ ] You can explain why the ingestion pipeline's privacy wall is *structural* rather than a filter.
- [ ] You know what a "monotonic merge" means here, and why an LLM value must be corroborated.
- [ ] You know why `deploy.sh` compares against the last *successful* deploy rather than `HEAD`.
- [ ] You know why the upload guard caps a **dimension** rather than a pixel count.
- [ ] You know why `uuid` is pinned below 12.

**All ticked → you are a MAINTAINER.** You can own this app. Use the appendices; ignore the rest.

**Some unticked → you are an EXPERT WHO HAS NOT READ THE CODEBASE**, which is the most common and
most dangerous position to be in. Every unticked line is a real defect waiting to be reintroduced.
The fastest fix is the twenty-item table in
**[The expert track](#the-expert-track--worth-reading-even-if-you-are-senior)** below: each row is
one non-obvious decision, why it exists, and the two-minute section that explains it.

### Already know some of it? Skip ahead

Read down the left column and stop at the **first row that is not already true of you**. Start where
that row points; everything above it is safe to skip.

| If you can already… | Skip | Start at |
|---|---|---|
| explain what HTML, CSS and JavaScript each do | §1.1–1.2 | **[§1.3 — React](#13-react-in-the-only-way-that-matters-here)** |
| write a React component using `useState` and `useEffect` | §1.3 | **[§1.4 — Node and Express](#14-nodejs-and-express)** |
| write an Express route handler and explain middleware | §1.4 | **[§1.5 — PostgreSQL and Sequelize](#15-postgresql-and-sequelize)** |
| read a `sequelize.define` and say what an ORM buys you | §1.5 | **[§1.6 — Cookies, sessions and JWT](#16-cookies-sessions-and-jwt)** |
| explain `httpOnly`, `SameSite` and how a JWT is verified | §1.6–1.7 | **[Part 2 — Running it](#part-2--running-it-on-your-laptop)** |
| get a Node + Postgres app running from a README | Part 2 | **[Part 3 — The repo map](#part-3--the-map-of-the-repository)** |
| find your way around an unfamiliar monorepo unaided | Part 3 | **[Part 4 — The life of a request](#part-4--system-design-the-life-of-a-request)** |
| describe *this* app's request lifecycle, caching and permission model | Parts 4–6 | **[Part 8 — Backend tour](#part-8--backend-code-tour)** or **[Part 9 — Frontend tour](#part-9--frontend-code-tour)** |
| name the files you need to edit for the ticket in front of you | all of it | **[Appendix B — "I need to…"](#appendix-b--i-need-to-index)** |

---

## How the book is built

Four devices, used consistently from here to the end:

| Device | What it does for you |
|---|---|
| **[Start here](#start-here)** and the [level checklists](#what-level-are-you-for-this-app) | route you to the right page in ten seconds |
| **A skip line under every section heading** | *Skip if: …* or *Read this one — …*, on all 109 of them, so each section can be judged in a glance and entered on its own |
| **A banner under every Part heading** | its level, how long it takes, and exactly when to skip it |
| **"The short version"** box opening every Part | three to six bullets that *replace* the Part if you are skimming. Read only those fourteen boxes and you still hold the whole system. |
| **Three appendices** | a cheat sheet, a task index, and an endpoint index — built for looking up, not reading |

Nothing here is aspirational. Every claim is about code that is in this repo today. Where the code
does something surprising, this document says so rather than tidying it up.

**Also available as a PDF** — `docs/IITR-Campus-Dashboard-Developer-Handbook.pdf`, with bookmarks.
This markdown is the source; regenerate the PDF with `./scripts/build-handbook.sh`.

---

## Pick your track

The three routes from [Start here](#start-here), with the reasoning behind each.

### Track A — Foundations
*You have not built a web application before.*

Read straight through, Part 0 to Part 14, and do Part 2 with your laptop open. Part 1 teaches HTML,
React, Express, SQL and cookies **using this app's own code as the examples**, so nothing stays
abstract. Budget a full day for the first pass and expect to reread Parts 8–10 later, once you have
actually changed something.

Do not try to memorise the API reference or the table list. Those are Parts 5 and 7, and they are
lookup material — skim them once so you know what is in them, then move on.

**→ Start reading at [Part 0 — What this app is, in five minutes](#part-0--what-this-app-is-in-five-minutes).**

### Track B — Working developer
*You write JavaScript. You have shipped something with a framework and a database.*

**Skip Part 1 entirely.** Start at Part 2 (running it), then read Parts 3, 4, 6 and 13 in that order
— repo map, request lifecycle, the permission model, and the traps. That is about ninety minutes and
it is enough to take a ticket.

After that, read Parts 8 and 9 (the code tours) when you first touch that half of the app, and only
the section of Part 10 that covers the feature you are working on. Parts 5, 7 and 12 are references
you come back to, not chapters you read.

**→ Start reading at [Part 2 — Running it on your laptop](#part-2--running-it-on-your-laptop).**

### Track C — Ship today
*You are experienced and you need to be useful within the hour.*

Read **[The fast path](#the-fast-path--thirty-minutes-to-your-first-change)** on the next page —
three pages covering the architecture, the commands, the invariants that are not guessable, and the
traps that cost everyone else an afternoon.

Then read the fourteen **"The short version"** boxes — one under each Part heading, a couple of
hundred words apiece. At that point you know what exists and where it lives. Use
**[Appendix B](#appendix-b--i-need-to-index)** to jump straight to the section covering whatever you
have been asked to change, and **[Appendix A](#appendix-a--cheat-sheet)** for the commands.

**→ Start reading at [The fast path](#the-fast-path--thirty-minutes-to-your-first-change).**

---

## The expert track — worth reading even if you are senior

If you skip the rest of this book, skip it having read these. Every row is a decision that is **not
guessable from the code**, that was made for a measured reason, and that someone will otherwise
undo. Together they take about an hour and they are the difference between someone who can change
this app and someone who can be trusted to maintain it.

They are also, frankly, the interesting part. Several are worth stealing for whatever you build next.

| # | The thing | Why it is worth your time | Read |
|---|---|---|---|
| 1 | **Super admin is a column, not a permission** | A permission is grantable, so a grantable "super admin" can mint more grantors — no gate can close that loop. Moving it outside the grantable set breaks the cycle *by construction* rather than by a check someone must remember. | [§5.2](#52-identity-and-access) |
| 2 | **The privacy wall is structural** | Ingestion drops anything not addressed to a public broadcast list **before the body is ever written**. Personal mail is not filtered out later; it never enters. That is a different and much stronger guarantee. | [§10.7](#107-email-ingestion--the-big-one) |
| 3 | **A monotonic LLM merge** | A model-extracted value only replaces a deterministic one if it passes a format gate, is **corroborated by a matching token in the source text**, and lands in a plausibility window. Invention is structurally blocked, not prompted against. | [§10.7](#107-email-ingestion--the-big-one) |
| 4 | **Refusing to answer beats answering wrong** | If no parsed date is plausible, the pipeline emits **no date**. A blank field costs an admin ten seconds; a wrong one puts students in the wrong room on the wrong day. | [§10.7](#107-email-ingestion--the-big-one) |
| 5 | **The decompression-bomb guard caps a *dimension*** | Peak memory tracks image **width**, not pixel count, because libvips decodes in strips. A 768 KB 200000×1340 PNG peaks at 576 MB and OOMs the host; a legitimate 200 MP photo costs 94 MB. Measured, with the table. | [§10.9](#109-image-uploads) |
| 6 | **`token_version`, and rejecting a missing claim** | Logout increments a counter checked on every request, so it revokes tokens you cannot see. The subtle half: a token *without* the claim is rejected, because otherwise a forger opts out of revocation by omitting a field. | [§4.2](#42-a-request-end-to-end) |
| 7 | **Rate limiting keyed on user, not IP** | The whole institute shares one public address behind campus NAT, so a per-IP budget is a budget for 8,000 people combined. A dozen students onboarding would have locked out everyone else on launch day. | [§8.1](#81-appjs--the-entry-point) |
| 8 | **`trust proxy` hop count** | Wrong by one and `req.ip` becomes a CloudFront edge address, silently collapsing per-IP limiting into a single global bucket. No error, no log line. | [§13.7](#137-trust-proxy) |
| 9 | **Three independent CSRF layers** | Origin/Referer check, `SameSite=Lax`, and a `Content-Type: application/json` requirement — the third works by forcing a CORS preflight that an unknown origin then fails. Each can fail alone. | [§4.2](#42-a-request-end-to-end) |
| 10 | **`stripUnknown` as a security control** | Joi dropping undeclared fields is what makes `is_super_admin` reachable through exactly one schema in the whole app. Validation as a mass-assignment defence, not a convenience. | [§8.3](#83-middlewaresvalidatejs--joi) |
| 11 | **A 2xx carrying HTML is a failure** | CloudFront once rewrote API 403s into "200 + index.html", so refused admin writes reported success while nothing was written. The axios interceptor now rejects any 2xx with an HTML content type. | [§4.2](#42-a-request-end-to-end) |
| 12 | **Sorting, not filtering, for expired items** | A past deadline is the *nearest* deadline, so "important first, soonest first" ranked expired notices highest — the top twelve in production were all dead. Expired now sinks; nothing disappears. | [§8.4](#84-utils) |
| 13 | **Modelling "we do not know"** | `venue_mode` separates *online* (there is no room), *tba* (there is a room, undecided), *physical*, and *never stated*. Three of those have a null venue; collapsing them sends students to a link that does not exist. | [§5.3](#53-the-content-tables) |
| 14 | **Permission ids resolved by name at boot** | Ids come from insertion order, so a rebuilt database renumbers them — observed for real. Names are resolved once at startup, and a missing row **stops the boot** rather than 403-ing a legitimate admin later. | [§8.4](#84-utils) |
| 15 | **The pure/impure split** | `eventIngestion/index.js` touches no database and no network; `runner.js` does everything impure. That single boundary is why a 1,500-line pipeline is testable against fixtures at all. | [§8.7](#87-serviceseventingestion) |
| 16 | **Deploy compares against the last *successful* deploy** | Using `HEAD`-before-pull means a deploy that dies after the pull lets the *next* run conclude "no new migrations", skip the snapshot, and migrate unprotected — the reflexive re-run walking through the guard that just fired. | [§11.2](#112-deploying-the-backend) |
| 17 | **`--force-recreate` is mandatory** | Compose hashes the image and the compose config, **not the contents of `env_file`**. Without it, an edited `.env` leaves the old process running with old values — which is how production served a two-day-old OAuth client id. | [§13.6](#136---force-recreate-on-deploy) |
| 18 | **A gate with false positives gets bypassed** | The frontend deploy script's stated design rule. Every assertion in it is about a string guaranteed present or absent by `api.js`, never a heuristic — because a bypassed gate is worse than no gate. | [§11.3](#113-deploying-the-frontend) |
| 19 | **Crash and hang are different failures** | `restart: unless-stopped` recovers a crash and does nothing for a hang; the `autoheal` sidecar watching the health check covers the second. And `mem_limit` turns a host-wide OOM — which kills whatever looks worst, often dockerd — into a container restart. | [§11.5](#115-health-self-healing-and-alerting) |
| 20 | **Deliberate denormalisation** | A to-do linked to an event stores the event's name, club and date as plain text. When the event is deleted the to-do still reads sensibly. Knowing *when* to break normalisation is the point. | [§10.4](#104-to-dos) |

**Then read the fourteen "short version" boxes** — one under each Part heading — and you have the
system. After that, [Appendix B](#appendix-b--i-need-to-index) routes any ticket to its section, and
[Appendix A](#appendix-a--cheat-sheet) has the commands.

---

## Table of contents

**Front matter**

- **[Start here](#start-here)** — one table; find your line and follow the link
- **[What level are you, for *this* app?](#what-level-are-you-for-this-app)** — three checklists, three routes
- [Already know some of it? Skip ahead](#already-know-some-of-it-skip-ahead) — the section-by-section ladder
- [How the book is built](#how-the-book-is-built)
- [Pick your track](#pick-your-track) — the three routes, with the reasoning
- **[The expert track](#the-expert-track--worth-reading-even-if-you-are-senior)** — twenty things worth reading even if you are senior
- [The fast path — thirty minutes to your first change](#the-fast-path--thirty-minutes-to-your-first-change)

**The book**

| Part | Level | Time |
|---|---|---|
| [0 — What this app is, in five minutes](#part-0--what-this-app-is-in-five-minutes) | Everyone | 5 min |
| [1 — The basics, explained through this app](#part-1--the-basics-explained-through-this-app) | Foundations | 25 min |
| [2 — Running it on your laptop](#part-2--running-it-on-your-laptop) | Everyone | 20 min, hands on |
| [3 — The map of the repository](#part-3--the-map-of-the-repository) | Everyone | 8 min |
| [4 — System design: the life of a request](#part-4--system-design-the-life-of-a-request) | Everyone | 15 min |
| [5 — The database, table by table](#part-5--the-database-table-by-table) | Reference | skim, then look up |
| [6 — Who is allowed to do what](#part-6--who-is-allowed-to-do-what) | Everyone | 12 min |
| [7 — The complete API reference](#part-7--the-complete-api-reference) | Reference | look up |
| [8 — Backend code tour](#part-8--backend-code-tour) | Depth | 15 min |
| [9 — Frontend code tour](#part-9--frontend-code-tour) | Depth | 15 min |
| [10 — Feature deep dives](#part-10--feature-deep-dives) | Depth | read one section at a time |
| [11 — Deployment and operations](#part-11--deployment-and-operations) | Operations | 12 min |
| [12 — Recipes: how to make common changes](#part-12--recipes-how-to-make-common-changes) | Reference | look up |
| [13 — Traps that will cost you an afternoon](#part-13--traps-that-will-cost-you-an-afternoon) | **Everyone, early** | 10 min |
| [14 — Glossary](#part-14--glossary) | Reference | look up |

**Appendices**

- [Appendix A — Cheat sheet](#appendix-a--cheat-sheet)
- [Appendix B — "I need to…" index](#appendix-b--i-need-to-index)
- [Appendix C — Endpoint index](#appendix-c--endpoint-index)

---

# The fast path — thirty minutes to your first change

**Level:** Everyone · **Time:** 30 min · **Skip if:** you are on Track A and have time to read properly.

This page assumes you have shipped web applications before and does not explain anything it does not
have to. Everything on it is expanded elsewhere; the cross-references tell you where.

## 1 · What it is

A campus app for IIT Roorkee: an events feed, a notices tab, the institute academic calendar,
reminders, personal to-dos, and an admin panel. The part that is not obvious from the outside is an
**email-ingestion pipeline** that reads the campus broadcast mailbox and turns each message into a
typed, reviewable *proposal*; a human publishes every one. → [Part 0](#part-0--what-this-app-is-in-five-minutes), [§10.7](#107-email-ingestion--the-big-one)

## 2 · The architecture, whole

```
Browser (React 19 SPA, mounted at /app/)
   │  every environment is SAME-ORIGIN; calls go to /api/*
   ▼
CloudFront ──► S3          static SPA + posters
           └─► EC2 ──► nginx ──► node:8081 (Express 5)  ──►  RDS PostgreSQL
                                    │
                     ┌──────────────┼───────────────┐
                     ▼              ▼               ▼
              Channel-i OAuth   Gmail API      Groq / Gemini
              (identity)        (raw email)    (classification, poster OCR)
```

The `/api` prefix is **stripped** before the request reaches Express, so `app.js` mounts routes
without it. Two applications in one repo: `src/` is the SPA, `temp_backend/` is the API. The name
`temp_backend` is a hackathon leftover; it is permanent. → [§4.1](#41-the-four-environments-and-why-they-all-look-the-same)

## 3 · Running it

```bash
# backend
cd temp_backend && npm install && cp .env.example .env
#   set DATABASE_URL, JWT_SECRET, DEV_LOGIN=true, NODE_ENV=development
npm run dev                                  # :8081, tables auto-create on first boot

# frontend (repo root, second terminal)
npm install && npm run dev                   # :5173

open http://127.0.0.1:8081/oauth/dev-login   # logs you in as an admin, no Channel-i needed
open http://127.0.0.1:5173/app/              # the /app/ is not optional
```

There is **no frontend `.env`**; `/api` is proxied by Vite. The root `.env.example` is stale — ignore
it. → [Part 2](#part-2--running-it-on-your-laptop)

## 4 · The nine things that are not guessable

1. **The SPA lives at `/app/`.** Vite `base`, the router `basename`, the PWA `scope` and
   `navigateFallback` must all agree or deep links 404 on reload. → [§13.2](#132-the-app-prefix)
2. **A new column on `event` needs adding to *two* allowlists** in `routes/event.js` plus the
   handler's destructuring, or the API silently never returns it. → [§13.4](#134-the-two-api-allowlists)
3. **Permissions resolve by name, never by id.** `permissionId(PERM.MANAGE_CLUBS)`. Ids come from
   insertion order and a rebuilt database renumbers them. → [§6.3](#63-the-permission-middlewares)
4. **Super admin is a column (`user.is_super_admin`), not a permission** — because a permission is
   grantable and that made the role self-minting. → [§5.2](#52-identity-and-access)
5. **`toISOString().slice(0,10)` is wrong in IST** between 00:00 and 05:30. Use the `localDay()` /
   `istToday()` helpers. → [§13.3](#133-timezone)
6. **The parser never writes an event.** It writes an `event_proposal`; a human publishes it.
   → [§10.7](#107-email-ingestion--the-big-one)
7. **Frontend and backend deploy separately.** `./deploy.sh` runs on the EC2 and ships the backend
   only; `./scripts/deploy-frontend.sh` runs locally. → [§11.2](#112-deploying-the-backend)
8. **"My change isn't showing"** is the service worker, on `localhost` too. Unregister it.
   → [§13.1](#131-my-change-isnt-showing-up)
9. **`GET /clubs` is cached in-process for an hour.** A direct database edit is invisible until you
   save a club through the admin panel. → [§13.5](#135-the-clubs-cache)

## 5 · Where things live

| You want | It is in |
|---|---|
| an HTTP endpoint | `temp_backend/routes/<prefix>.js` |
| a table definition | `temp_backend/database/schemas/<model>.js`; relationships in `schemas/index.js` |
| a permission gate | `temp_backend/middlewares/permissions/` |
| a schema change | a **new file** in `temp_backend/migrations/` — never `initializeSchema.js` |
| the email pipeline's rules | `temp_backend/services/eventIngestion/institutions/iitr.config.js` |
| a screen | `src/pages/` |
| any network call | `src/services/` — components never call axios directly |
| the session | `src/context/AuthContext.jsx` |

## 6 · House rules

1. **Deterministic first, AI second.** Every LLM call is optional, guarded, and fails safe to a
   deterministic answer. It may never overwrite something the rules read correctly.
2. **A human publishes.** Nothing extracted by machine reaches students without approval.
3. **Fail closed, fail loud.** A misconfiguration should refuse to boot, not run insecurely.
4. **Write down why.** The comments in this codebase are long because most of them record a real
   failure and the measurement that settled it.

---

# Part 0 — What this app is, in five minutes

**Level:** Everyone · **Time:** 5 min · **Skip if:** you already know what the product does.

> **The short version**
> - A campus app for IIT Roorkee: an **events feed**, a **notices** tab, the institute **academic calendar**, **reminders**, personal **to-dos**, and an **admin panel**.
> - Two applications in one repository that share nothing but HTTP: `src/` is a React 19 SPA, `temp_backend/` is an Express + PostgreSQL API. The name `temp_backend` is a hackathon leftover; it is permanent.
> - The distinguishing feature is an **email-ingestion pipeline**: it reads the campus broadcast mailbox and turns each message into a typed *proposal* — event, notice, calendar change, or an update to an existing item. **A human approves every one.**
> - Live at `campus-dashboard.iitr.ac.in`: the marketing landing page owns `/`, the app is mounted at `/app/`, the API at `/api/`.

## The problem

*Skip if:* you have used the app, or you already know why it exists.

IIT Roorkee has roughly 8,000 students, ~100 clubs and sections, four annual fests, and a dozen
administrative offices. Every one of them announces things by email to a broadcast list
(`students-notices@iitr.ac.in` and friends), plus WhatsApp groups and Slack. A student gets dozens
of mails a week. The mail about the hackathon you cared about is three screens below a mail about a
water-supply shutdown. The academic calendar is a PDF on a website. Nothing is searchable, nothing
is sorted by "is this soon", and nothing tells you *your* clubs.

## The product

*Skip if:* you can list the six things the app does.

One app. It shows:

- a **feed of events** — talks, workshops, competitions, fests — sorted by when they happen, filtered
  by category, searchable, with the clubs you don't care about hidden;
- a **notices tab** — the things that are not events but have a deadline: scholarships, fee payments,
  recruitment calls, facility closures;
- an **academic calendar** — holidays, exam windows, registration dates — imported from the official
  institute PDF rather than typed by hand;
- **reminders** — get a browser notification 30 minutes before an event you marked;
- a **personal to-do list**, which can optionally overlay onto the feed and calendar;
- an **admin panel** for club coordinators and institute admins to create and edit events, manage
  clubs, and review the machine-extracted proposals.

And the interesting bit:

- an **email ingestion pipeline** that reads the broadcast mailbox, decides whether each mail is an
  event / an opportunity / a plain notice / an academic-calendar change, extracts the title, date,
  time, venue, registration link and deadline, works out which club sent it, and files a
  **proposal**. A human then reviews the proposal in the admin panel and publishes it with one
  click. Nothing reaches students without a person approving it.

## The shape of the system

*Read this one* — two pages, one diagram, and it is the whole system.

```
┌────────────────────┐          ┌──────────────────────┐         ┌──────────────┐
│  Browser / PWA     │  HTTPS   │  Node + Express API  │   SQL   │  PostgreSQL  │
│  React 19 SPA      │ ───────► │  (temp_backend/)     │ ──────► │              │
│  (src/)            │  /api/*  │                      │         │  ~26 tables  │
└────────────────────┘          └──────────┬───────────┘         └──────────────┘
                                           │
                    ┌──────────────────────┼───────────────────────┐
                    ▼                      ▼                       ▼
             Channel-i OAuth        Gmail API (poll)         Groq / Gemini
             (who are you)          (the raw emails)         (classification,
                                                              poster reading)
```

**Two applications in one repository.** `src/` is the browser app. `temp_backend/` is the server.
They talk over HTTP and share nothing else — no shared code, no shared types. The name
`temp_backend` is a historical accident from a hackathon weekend; it is the permanent backend.

## Live URLs

*Skip if:* you know the landing page owns `/` and the app is at `/app/`.

| What | Where |
|---|---|
| Landing page | `https://campus-dashboard.iitr.ac.in/` |
| The app itself | `https://campus-dashboard.iitr.ac.in/app/` |
| API | `https://campus-dashboard.iitr.ac.in/api/` |

The marketing landing page owns the root path. The React app is mounted at `/app/`. That prefix is
load-bearing — see [Part 13](#part-13--traps-that-will-cost-you-an-afternoon).

---

# Part 1 — The basics, explained through this app

**Level:** Foundations · **Time:** 25 min · **Skip if:** you write React and Node comfortably — **skip the whole Part**.

> **The short version**
> - This Part teaches HTML/CSS/JS, single-page apps, React, Node/Express, PostgreSQL/Sequelize, cookies and JWT, and the build step — each one explained with code taken from this repository rather than a toy example.
> - If you are on Track B or C there is exactly one thing in here you need: `temp_backend/` is the **permanent** backend despite the name, and `src/` is the frontend. Go straight to [Part 2](#part-2--running-it-on-your-laptop).
> - If you are on Track A, read it slowly with the files it names open beside you. Everything after this Part assumes these words mean something to you.

**You do not have to read this Part in full.** Each section stands alone — find the first row below
that you could *not* confidently explain to someone else, and start there.

| Section | Teaches | Skip if you can already… |
|---|---|---|
| [1.1](#11-what-actually-happens-when-you-open-a-website) | requests, responses, HTML/CSS/JS | describe what happens when you type a URL |
| [1.2](#12-single-page-app-spa) | single-page apps, JSON | explain why this app ships one HTML file |
| [1.3](#13-react-in-the-only-way-that-matters-here) | components, JSX, props, state, effects, hooks | write a React component with `useState` |
| [1.4](#14-nodejs-and-express) | Node, Express, routes, middleware, `async`/`await` | write an Express handler and explain `next()` |
| [1.5](#15-postgresql-and-sequelize) | tables, foreign keys, ORMs, Sequelize models | read a `sequelize.define` block |
| [1.6](#16-cookies-sessions-and-jwt) | cookies, sessions, JWT, `httpOnly`, `SameSite` | explain how a signed token is verified |
| [1.7](#17-the-build-step) | Vite, bundling, PWAs, service workers | explain what a service worker does to caching |

If every row is true of you, go to **[Part 2 — Running it on your laptop](#part-2--running-it-on-your-laptop)**.

## 1.1 What actually happens when you open a website

*Skip if:* you can describe a request/response cycle and what HTML, CSS and JS each do.

You type a URL. Your browser sends an **HTTP request** to a server. The server sends back an **HTTP
response** — a status code (200 = fine, 404 = no such thing, 500 = the server broke) and a body.

For a traditional website the body is **HTML**: the text and structure of the page. **CSS** is a
separate language that says how that structure should look — colours, spacing, fonts. **JavaScript**
is a programming language that runs *inside the browser* and can change the page after it has
loaded: react to a click, fetch more data, animate something.

Three languages, three jobs: HTML is the skeleton, CSS is the skin, JavaScript is the muscle.

## 1.2 Single-page app (SPA)

*Skip if:* you can explain why this app ships one nearly-empty HTML file.

The old way: every click asks the server for a whole new HTML page. Slow, and the screen flashes.

The way this app works: the server sends **one** nearly-empty HTML file plus a big JavaScript
bundle. That JavaScript draws the entire interface and, when you click "Calendar", it redraws the
screen itself and updates the address bar without asking the server for a new page. It only asks the
server for *data* — "give me the events" — as **JSON**.

That is a **single-page application**. Our one HTML file is `index.html` at the repo root. It
contains almost nothing:

```html
<div id="root"></div>
<script type="module" src="/src/main.jsx"></script>
```

`src/main.jsx` is the entry point. It hands the `<div id="root">` over to React and React fills it.

**JSON** (JavaScript Object Notation) is just a text format for structured data:

```json
{ "id": 42, "name": "Hackathon", "club_name": "PAG", "duration_minutes": 180 }
```

Every API call in this app sends and receives JSON.

## 1.3 React, in the only way that matters here

*Skip if:* you write components with `useState`, `useEffect` and `useMemo`.

React is a JavaScript library for building interfaces out of **components**. A component is a
function that returns a description of what to draw. Example — a real one from this codebase,
simplified:

```jsx
const EventCard = ({ event }) => {
    return (
        <div className="event-card">
            <h3>{event.name}</h3>
            <p>{event.club_name}</p>
        </div>
    );
};
```

That HTML-looking syntax inside JavaScript is **JSX**. It is not HTML — it compiles down to
JavaScript function calls. `className` instead of `class`, because `class` is a reserved word in
JavaScript. `{event.name}` drops a JavaScript value into the output.

Three React concepts you need:

**Props** — the `{ event }` above. Data passed *into* a component by its parent. Read-only.

**State** — data a component owns and can change. When state changes, React redraws that component.

```jsx
const [searchQuery, setSearchQuery] = useState('');
// searchQuery is the current value; setSearchQuery('abc') changes it and triggers a redraw.
```

**Effects** — code that runs *after* a draw, for things that are not drawing: fetching data, setting
a timer, subscribing to a browser event.

```jsx
useEffect(() => {
    eventReminderService.scheduleStoredReminders();
}, []);   // the [] means "run this once, when the component first appears"
```

`useMemo` is a fourth one you will see everywhere in this codebase: it caches an expensive
calculation so it is not redone on every redraw. `src/pages/Home.jsx` uses it heavily to filter and
merge the feed.

Anything starting with `use` is a **hook**. Hooks can only be called at the top level of a
component, never inside an `if` or a loop. If you break that rule React throws a confusing error.

## 1.4 Node.js and Express

*Skip if:* you write Express handlers and can explain what `next()` does.

**Node.js** runs JavaScript outside the browser — on a server. Same language, no DOM, but with file
access and network sockets.

**Express** is the framework we use on top of Node to handle HTTP. The whole idea is one line
repeated:

```js
router.get('/all', userLoggedIn, async (req, res) => {
    const events = await Event.findAll();
    res.json({ events });
});
```

Read it as: *when a GET request arrives for this path, first run `userLoggedIn`, then run this
function, which gets events from the database and sends them back as JSON.*

- `req` — the incoming request: `req.params` (bits of the URL path), `req.query` (the `?page=2`
  part), `req.body` (the JSON that was posted), `req.cookies`, `req.headers`.
- `res` — how you reply: `res.json({...})`, `res.status(404).json({...})`, `res.redirect(url)`.
- **Middleware** — a function that runs *before* the handler and either calls `next()` to continue
  or replies itself to stop the chain. `userLoggedIn` is middleware: it checks the login cookie and
  either lets you through or replies 401.

`async` / `await` is how JavaScript handles things that take time. `await Event.findAll()` means
"start this database query, let other work happen, and continue this function when the answer
arrives". Without `await` you would get a **Promise** — a placeholder for a future value — instead
of the actual events. Forgetting `await` is the single most common bug in this kind of code.

## 1.5 PostgreSQL and Sequelize

*Skip if:* you can read a `sequelize.define` block and say what an ORM buys you.

**PostgreSQL** ("Postgres") is a relational database: data lives in **tables** with fixed
**columns**, and rows in one table point at rows in another through **foreign keys**.

Our `event` table has a `club_id` column that points at the `club` table's `id`. That is a foreign
key. It means an event cannot exist without a club, and if you delete a club its events go too
(`ON DELETE CASCADE`).

Writing raw SQL everywhere is tedious and easy to get wrong, so we use **Sequelize**, an **ORM**
(Object-Relational Mapper). You describe a table once in JavaScript:

```js
const Event = sequelize.define('Event', {
    id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false },
    club_id: { type: DataTypes.BIGINT, allowNull: false,
               references: { model: 'club', key: 'id' }, onDelete: 'CASCADE' },
}, { tableName: 'event', timestamps: false });
```

…and then you write `Event.findAll(...)`, `Event.create(...)`, `Event.update(...)` instead of SQL.
Sequelize generates the SQL. Critically, it **parameterises** every query, which is what stops SQL
injection attacks. Those model files live in `temp_backend/database/schemas/`.

## 1.6 Cookies, sessions, and JWT

*Skip if:* you can explain `httpOnly`, `SameSite` and how a signed token is verified.

HTTP is stateless: the server does not remember you between requests. So after you log in, the
server gives your browser a **cookie** — a small string the browser automatically attaches to every
subsequent request to that site.

Our cookie is called `auth_token` and it holds a **JWT** (JSON Web Token). A JWT is three
base64 chunks separated by dots: a header, a payload of claims (`user_id`, permissions, an expiry),
and a **signature**. The signature is computed with a secret only the server knows (`JWT_SECRET`),
so anyone can *read* a JWT but nobody can *forge* one.

Two flags matter on our cookie:

- `httpOnly: true` — JavaScript in the page cannot read it. So a cross-site scripting bug cannot
  steal the session.
- `sameSite: 'lax'` — the browser will not send it on most cross-site requests, which blocks a class
  of attack called CSRF.

## 1.7 The build step

*Skip if:* you know what Vite does and what a service worker does to caching.

Browsers do not understand JSX, and shipping 400 separate files would be slow. **Vite** is the build
tool: in development it serves your source with instant hot reload; for production `npm run build`
compiles everything into a handful of minified files in `dist/`.

`vite.config.js` also configures the **PWA** (Progressive Web App) layer — a `manifest` so the app
can be installed to a phone home screen, and a **service worker** that caches assets so it works
offline. The service worker is a background script the browser keeps even after you close the tab.
It is extremely useful and it is also responsible for about a third of the confusing bugs in this
project. See [Part 13](#part-13--traps-that-will-cost-you-an-afternoon).

---

# Part 2 — Running it on your laptop

**Level:** Everyone · **Time:** 20 min, hands on · **Skip if:** your environment is already running.

> **The short version**
> - **Backend:** `cd temp_backend && npm install && cp .env.example .env`; set `DATABASE_URL` and `JWT_SECRET`; add `DEV_LOGIN=true`; `npm run dev` → port 8081. **Tables create themselves on first boot** — no manual migration needed for a fresh database.
> - **Frontend:** from the repo root, `npm install && npm run dev` → port 5173. Open **`http://127.0.0.1:5173/app/`** — the `/app/` is not optional.
> - **Log in** by visiting `http://127.0.0.1:8081/oauth/dev-login`. It exists only outside production and only with `DEV_LOGIN=true`; production refuses to boot if that flag is set.
> - There is **no frontend `.env` to configure** — `/api` is proxied by Vite. The root `.env.example` is stale and should be ignored.
> - Everything else — real Channel-i login, Gmail ingestion, Groq, Gemini, S3, Sentry — is **optional** and off unless configured.
> - Tests are plain Node scripts with no test runner. CI runs three backend tests plus a frontend build.

## 2.1 What you need installed

*Skip if:* you have Node 22+, npm and Postgres already.

| Tool | Version | Why |
|---|---|---|
| Node.js | **22 or newer** (26 in CI and production) | runs both halves |
| npm | ships with Node | installs packages |
| PostgreSQL | 14+ | the database. A free cloud one (Neon, Supabase) also works |
| Git | any | you know why |

Check: `node -v && npm -v && psql --version`.

## 2.2 Backend first

*Read this one* — the backend has to be up before anything else works.

The backend is the harder half, and the frontend is useless without it.

```bash
cd temp_backend
npm install
cp .env.example .env
```

Now open `temp_backend/.env` and fill in the two things that are genuinely required:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_dashboard
JWT_SECRET=any_long_random_string_will_do_locally
```

Create the database if you are running Postgres locally: `createdb campus_dashboard`.

Then, because you almost certainly do not have Channel-i OAuth credentials, turn on the dev login
backdoor:

```bash
DEV_LOGIN=true
NODE_ENV=development
FRONTEND_REDIRECT_URL=http://127.0.0.1:5173/app/home
```

Start it:

```bash
npm run dev      # node --watch app.js — restarts on file change
```

You should see the boot sequence:

```
PostgreSQL connected via Sequelize.
Checking and initializing database schema...
... table initialized
Database schema initialized successfully!
Gmail ingestion disabled (set GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN to enable).
Listening to Port:8081
```

**The tables create themselves on first boot.** `database/initializeSchema.js` runs
`sequelize.sync()` plus a long list of idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
statements, and two seed scripts populate the event categories, the fest clubs, the "Institute"
catch-all club, and the academic calendar. You do not need to run migrations by hand for a fresh
local database.

## 2.3 Frontend

*Read this one* — short, and it contains the `/app/` gotcha that catches everyone.

From the repo root, in a second terminal:

```bash
npm install
npm run dev      # vite, on http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173/app/** — note the `/app/`. The bare root will 404 locally because the
router's basename is `/app`.

There is **no frontend `.env` to configure**. The API base is hard-pinned to `/api` in
`src/services/api.js`, and `vite.config.js` proxies `/api/*` through to `http://127.0.0.1:8081`
with the `/api` prefix stripped. So the browser only ever sees one origin, in every environment.

> **Warning.** The root `.env.example` is **stale**. It advertises `VITE_API_URL` pointing at an old Render
> host and `VITE_IMGBB_API_KEY`. ImgBB was removed (uploads now go through our own backend to S3),
> and `VITE_API_URL` is ignored in production builds on purpose — a stray value in a local `.env`
> once got baked into a production bundle and redirected every API call, session cookie included.
> Ignore that file. If you need to point a local frontend at a *deployed* backend, set
> `VITE_PROXY_TARGET` instead.

## 2.4 Log in

*Read this one* — without `dev-login` you cannot see a single screen locally.

Visit **http://127.0.0.1:8081/oauth/dev-login** directly in your browser.

That route only exists when `NODE_ENV !== 'production'` *and* `DEV_LOGIN=true`. It creates a user
called "Dev Admin" (`user_id` 999000001), grants them the `manage_admins` permission (which makes
them an admin for most purposes), sets the `auth_token` cookie, and redirects you into the app.

In production the route is not merely disabled — it is **never registered**, and the app refuses to
boot at all if `DEV_LOGIN=true` is set with `NODE_ENV=production`. That fail-closed pattern appears
several times; see `temp_backend/app.js` lines 20–31.

## 2.5 The optional extras

*Skip if:* you only need the app running, not ingestion or the LLMs.

Everything below is off unless you configure it, and the app runs fine without any of it.

| Feature | Env vars | Without them |
|---|---|---|
| Real login | `client_id`, `client_secret_id`, `authoriseURL`, `token_URL`, `get_user_data_url`, `redirectURL` | use `/oauth/dev-login` |
| Email ingestion | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | the poller no-ops and logs "Gmail ingestion disabled" |
| LLM classification | `GROQ_API_KEY` (+ `LLM_PROVIDER=groq`) | the pipeline runs 100% on regex rules |
| Poster reading | `GEMINI_API_KEY` | posters are attached but never read for dates/venues |
| Image uploads to S3 | `POSTER_S3_BUCKET`, `POSTER_PUBLIC_BASE`, `AWS_REGION` | falls back to local disk under `temp_backend/uploads/` (dev only — production **refuses** to do this) |
| Error alerting | `SENTRY_DSN` | Sentry calls become no-ops |

## 2.6 Tests

*Skip if:* you are not changing the ingestion pipeline or the calendar parser.

There is no test *runner* — no Jest, no Vitest. Tests are plain Node scripts that throw on failure.
That is deliberate: zero dependencies, runs anywhere, and the CI just executes them.

```bash
cd temp_backend
node services/eventIngestion/__tests__/pipeline.test.js      # the ingestion pipeline
node services/eventIngestion/source/__tests__/gmail.test.js  # the Gmail adapter
node services/academicCalendar/__tests__/parser.test.js      # the PDF parser (snapshot-based)
npm test                                                      # == the parser test
```

Frontend tests are `.test.mjs` files run the same way:

```bash
node src/utils/notice.test.mjs
node src/utils/updateDraft.test.mjs
```

`.github/workflows/ci.yml` runs exactly those three backend tests plus `npm run build` on the
frontend. Lint runs but is `continue-on-error: true` — there is pre-existing lint debt and it does
not block a merge.

The `__tests__/` directory also holds a couple of dozen **harness scripts** (`liveRun.js`,
`fullSweep.cjs`, `evalAccuracy.js`, `venueTaxonomy.js`…). Those are not tests — they are one-off
measurement tools that hit the real Gmail inbox or a real database. Do not run them in CI and do not
assume they still work.

## 2.7 Docker, if you want the whole thing at once

*Skip if:* you are happy running the two processes directly.

```bash
docker compose up --build
# frontend on :5173, backend on :8081
```

`docker-compose.yml` builds both images, runs an `autoheal` sidecar that restarts the backend if its
health check goes unhealthy, and caps the backend at 512 MB of memory. In production only the
`backend` and `autoheal` services run — the frontend is static files on S3 behind CloudFront.

---

# Part 3 — The map of the repository

**Level:** Everyone · **Time:** 8 min · **Skip if:** nothing — this is the cheapest Part in the book to read.

> **The short version**
> - `src/` = frontend (pages, components, services, context, utils). `temp_backend/` = backend (routes, middlewares, database, services, utils). `docs/`, `scripts/` and `deploy.sh` at the root.
> - **Ignore** every `landing-*` directory except `landing-v8/`, all the root `test*` scratch files, and the root-level `*_AUDIT*.md` / `OPTIMIZATION_*.md` reports (superseded by the copies in `docs/`).
> - **Dead code inside `src/`**, imported by nothing: `pages/Clubs.jsx`, `pages/Map.jsx`, `components/Layout/Navbar.jsx`, `components/Widgets/TodoList.jsx`. Do not use them as a pattern reference.
> - **Two frozen files:** `database/initializeSchema.js` (schema changes are migrations now) and the baseline migration `20260728000000-baseline.js` (never edit, never roll back).

```
Campus-Dashboard-Event-Planner/
├── index.html                 the single HTML file the SPA boots from
├── package.json               FRONTEND dependencies (react, vite, swr, axios…)
├── vite.config.js             build config, PWA/service-worker, dev proxy
├── src/                       ── THE FRONTEND ──
│   ├── main.jsx               entry point: mounts <App/> into #root
│   ├── App.jsx                router + providers + the route table
│   ├── index.css, App.css     global styles and the app shell
│   ├── pages/                 one file per screen
│   ├── components/            reusable pieces (EventCard, BottomNav, admin panels)
│   ├── services/              every network call lives here, nowhere else
│   ├── context/AuthContext.jsx  who is logged in, app-wide
│   ├── utils/                 pure helpers (+ the two .test.mjs files)
│   └── assets/                logos
│
├── temp_backend/              ── THE BACKEND ──
│   ├── app.js                 entry point: middleware stack, route mounting, boot sequence
│   ├── package.json           BACKEND dependencies (express, sequelize, pg…)
│   ├── routes/                one file per URL prefix
│   ├── middlewares/           auth + permission gates + request validation
│   ├── database/
│   │   ├── connection.js      the Sequelize instance and connection pool
│   │   ├── schemas/           one file per table + index.js with all the relationships
│   │   ├── initializeSchema.js  boot-time table creation (frozen — see below)
│   │   ├── initConstraints.js   the no-double-booking exclusion constraint
│   │   └── seed*.js           idempotent reference data
│   ├── migrations/            sequelize-cli migrations (the way to change schema NOW)
│   ├── services/
│   │   ├── academicCalendar/  the PDF → calendar-entries parser
│   │   └── eventIngestion/    the email → proposals pipeline (the big one)
│   ├── utils/                 logger, cache, permissions, S3, Sentry, audit
│   └── uploads/               dev-only local file storage (gitignored)
│
├── docs/                      you are here
├── deploy.sh                  the production deploy script, run ON the EC2 box
├── scripts/                   deploy-frontend.sh, smoke-test.sh, chrome-debug.sh
├── Dockerfile / nginx.conf    frontend container (static files + /api proxy)
├── docker-compose.yml         local all-in-one, and the production backend definition
└── brand/                     the institute logo mark in three sizes
```

## What you should ignore

*Read this one* — the repo root has eight abandoned directories in it — worth two minutes.

The repo root is littered with abandoned work. None of the following is part of the product:

- `landing/`, `landing-v2/` … `landing-v8/`, `landing-deploy*/`, `landing-dist/`,
  `landing-experiment/` — eight iterations of a 3D marketing page. **`landing-v8/` is the live
  one**; every other `landing-*` directory is dead.
- `test.html`, `test2.html`, `test3.js`, `test4.cjs`, `test5.html`, `test-script.js`,
  `test-puppeteer.js`, `test.cjs`, `inspect_glb.py`, `process_phone.py`, `scene.glb` — scratch files.
- `mobile/` — the Capacitor Android app (see 11.8). `playstore-assets/` — store listing artwork.
- `dev-dist/`, `dist/` — build output, gitignored.
- The dozen `*_AUDIT*.md` / `OPTIMIZATION_*.md` files at the root — point-in-time reports from
  April/July 2026, superseded by the copies in `docs/`.

## Dead code inside `src/`

*Read this one* — four files compile, are imported by nothing, and read like live code.

These files exist, compile, and are imported by nothing. Do not "fix" them; do not assume they run.

| File | Status |
|---|---|
| `src/pages/Clubs.jsx` + `.css` | a full club browser. **Not routed.** Club management lives in the Admin panel's *Manage Clubs* tab; club *following* lives in Profile. |
| `src/pages/Map.jsx` + `.css` | a campus map page. **Not routed.** |
| `src/components/Layout/Navbar.jsx` + `.css` | a top navbar from an earlier design. Superseded by `BottomNav`. Still contains a link to `/map`, which does not exist. |
| `src/components/Widgets/TodoList.jsx` + `.css` | superseded by `src/pages/Todo.jsx`. |

## Two files that are frozen

*Read this one* — editing either is the most common way to make a schema change that does not stick.

**`temp_backend/database/initializeSchema.js`** — this creates and patches tables at boot. It is
marked **FROZEN**. Do **not** add new schema changes here. Every new column or table is a migration
file in `temp_backend/migrations/` now. The file survives only as belt-and-braces for the first AWS
deploy and will be reduced to a connectivity check.

**`temp_backend/migrations/20260728000000-baseline.js`** — the baseline snapshot of the schema as it
stood in July 2026. It is guarded: on a database that already has an `event` table it does nothing
but mark itself applied; on a fresh database it creates everything. Never edit it, never roll it
back.

---

# Part 4 — System design: the life of a request

**Level:** Everyone · **Time:** 15 min · **Skip if:** nothing — for an experienced developer this is the highest-value Part in the book.

> **The short version**
> - Every environment is **same-origin**: the browser always calls `/api/*`, and the prefix is stripped before Express sees it. Dev proxies through Vite, Docker through nginx, production through CloudFront.
> - A write passes **thirteen** middleware layers before the handler, including three independent CSRF defences: an Origin/Referer check, `SameSite=Lax`, and a `Content-Type: application/json` requirement that forces a CORS preflight.
> - The session is a JWT in an `httpOnly` cookie. Every request re-checks `token_version` against the database, so logout genuinely revokes every token the account holds — including copies we cannot see.
> - Three caches stack: the service worker, CloudFront, and an in-process `node-cache` (events 30 s, clubs **1 hour**).
> - Boot **fails closed**: a missing `JWT_SECRET`, `DEV_LOGIN=true` in production, or a missing permission row each stop the process rather than let it run insecurely.

## 4.1 The four environments, and why they all look the same

*Read this one* — the same-origin `/api` invariant explains most of the codebase's shape.

| Environment | Browser talks to | `/api/*` is served by |
|---|---|---|
| Local dev | `http://127.0.0.1:5173` | Vite's dev proxy → `127.0.0.1:8081` |
| Docker compose | `http://localhost:5173` | nginx in the frontend container → `backend:8081` |
| Production | `https://campus-dashboard.iitr.ac.in` | CloudFront behaviour → EC2 → nginx → Node |

In **every** environment the browser sees exactly one origin and calls `/api/...`. This is not a
tidiness preference; it is a correctness decision. Cross-origin requests follow different cookie
rules, so if dev were cross-origin and production same-origin, a session bug could reproduce in one
and not the other. `src/services/api.js` has a long comment explaining why `VITE_API_URL` is
deliberately not honoured in production builds.

The `/api` prefix is **stripped** before the request reaches Express. `/api/events/all` arrives at
the Node process as `/events/all`. That is why `app.js` mounts routes without the prefix.

## 4.2 A request, end to end

*Read this one* — thirteen middleware layers, and three of them are not guessable.

Take "load the feed". Here is every layer it passes through.

**1 — The component asks.** `src/pages/Home.jsx` uses SWR to call:

```js
eventService.getAllEventsPage(targetPage, PAGE_SIZE, istToday())
```

**2 — The service builds the call.** `src/services/events.js` turns that into
`GET /api/events/all?page=1&limit=10&from=2026-08-26` through the shared axios instance in
`src/services/api.js`, which sets `withCredentials: true` so the `auth_token` cookie rides along.

**3 — The edge.** CloudFront matches the `/api/*` behaviour and forwards to the EC2 instance's
nginx, which proxies to `http://127.0.0.1:8081/` — stripping `/api`.

**4 — Express middleware, in order** (`temp_backend/app.js`, top to bottom):

| # | Middleware | What it does |
|---|---|---|
| 1 | `cors(corsOptions)` | Is this Origin allowed? Local, configured origins, optional Vercel previews. |
| 2 | `cookieParser()` | parses `Cookie:` into `req.cookies` |
| 3 | `pinoHttp` | structured JSON access log (skips `/health`) |
| 4 | Content-Type gate | any POST/PUT/PATCH/DELETE must be `application/json` — else **415**. Multipart is allowed on exactly two paths. |
| 5 | `bodyParser.json({limit:'1mb'})` | parses the JSON body |
| 6 | `hpp()` | collapses `?id=1&id=2` to a single value |
| 7 | static `/uploads` | serves dev-mode local posters |
| 8 | `helmet(...)` | security headers: `X-Frame-Options: DENY`, `nosniff`, HSTS, referrer policy |
| 9 | CSRF Origin/Referer check | writes must carry an allowed `Origin` or `Referer` — else **403** |
| 10 | rate limiters | 5 failed logins / 5 min; 100 writes / 15 min keyed on **user id**, falling back to IP |
| 11 | the route's own middleware | `userLoggedIn`, then a permission gate |
| 12 | the handler | |
| 13 | terminal error handler | anything thrown becomes clean JSON with a correlation id — never a stack trace |

The **415 gate at step 4 deserves a note**, because it looks like pedantry and is not. A cross-site
HTML `<form>` can only send `text/plain`, `x-www-form-urlencoded`, or `multipart/form-data`. Those
are "simple requests" — the browser sends them, cookie attached, *without* asking us for permission
via a CORS preflight. Requiring `application/json` forces a preflight, which CORS then refuses for an
unknown origin. It is a third independent layer under the Origin check and `SameSite=Lax`.

**5 — Auth.** `middlewares/userAuth.js` → `verifySession(token)`:
- verify the signature with `JWT_SECRET`, algorithm pinned to `HS256`;
- **reject any token with no `tv` claim**;
- read `token_version` from the `user` row and compare it to `tv`.

That second check is the revocation kill switch. Logging out increments `token_version`, which
invalidates every token that account has ever been issued — including copies we cannot see. A token
without `tv` is rejected outright, because previously a *missing* claim skipped the check, which
meant a forged token could opt out of revocation just by omitting a field.

**6 — The handler.** `temp_backend/routes/event.js` → `GET /all`:
- read `page` / `limit` / `from` / `to`, clamp `limit` to 50;
- check a 30-second in-process cache keyed on those params;
- run `Event.count()` and `Event.findAll()` in parallel with `Promise.all`;
- the `findAll` flattens the joined club and location into `club_name`, `location_name` etc. via
  `sequelize.col()`, so the response is flat JSON with no nested objects;
- fetch the category join rows for exactly those event ids and stitch them on;
- cache and return `{ events, currentPage, pageSize, totalEvents, totalPages }`.

**7 — Back in the browser.** The axios response interceptor does one unusual thing: if a `2xx`
response has `Content-Type: text/html`, it **rejects it**. CloudFront used to rewrite API 403s and
404s into "200 + index.html", which sailed through every `catch` block and made refused admin writes
report *"Published to the feed."* while nothing was written. That rewrite is fixed; this check
ensures a future proxy misconfiguration cannot reintroduce the failure silently.

**8 — SWR caches it.** `<SWRConfig>` in `App.jsx` sets a 30-second refresh interval and revalidation
on window focus and reconnect, so the feed self-updates.

## 4.3 Where state lives

*Skip if:* you can already name the six places state lives in a React + cookie app — but check the table anyway.

There are five distinct places state lives in this app, and knowing which is which saves a lot of
confusion.

| Store | Holds | Lifetime |
|---|---|---|
| PostgreSQL | everything that matters | forever |
| The JWT cookie | user id, permissions, club-admin ids, preference ids | 30 days (`SESSION_TTL_HOURS`) |
| `AuthContext` (React) | the logged-in user object + derived `canManageX` booleans | until page reload |
| SWR cache (React) | server responses, keyed by string | until reload or revalidation |
| `localStorage` | reminder subscriptions, "already fired" markers, the show-todos-in-feed toggle | forever, per browser |
| `sessionStorage` | `returnTo` (where you were heading before login), one redirect guard | per tab |

**The JWT is a cache, not the truth.** Permissions are stamped into it at login so the UI can decide
what to *show*, but every write is re-checked against the database. `middlewares/permissions/superAdmin.js`
spells this out: super-admin status is read from the `user` table on every gated request, never from
the token, so revoking someone bites on their next call rather than whenever their session expires.

## 4.4 The boot sequence

*Skip if:* you are not touching startup — return here the first time the server refuses to boot.

`temp_backend/app.js` → `startServer()` runs these in order and **exits the process** if any fail:

1. `initializeSchema()` — create/patch tables, add indexes, apply the exclusion constraint.
2. `loadPermissionIds()` — read `admin_permission` and build a name→id map in memory. Throws if any
   of the six permissions is missing, so a misconfigured database refuses to start rather than
   silently 403-ing admins who genuinely hold the permission.
3. `seedAcademicCalendar()` — populate the calendar from the legacy hardcoded file if empty.
4. `seedEventIngestion()` — categories, fest clubs, the "Institute" catch-all, the sender→club map.
5. `startPolling()` — begin the Gmail ingestion loop (no-ops if unconfigured).
6. `app.listen(PORT)`.

Before any of that, two **fail-closed guards** run at the very top of the file: in production, refuse
to start if `DEV_LOGIN=true`, and refuse to start if `JWT_SECRET` is unset. There are also
`uncaughtException` and `unhandledRejection` handlers that log, alert Sentry, flush, and exit — so a
stray error dies cleanly and Docker's restart policy brings a fresh process, rather than leaving a
half-alive zombie.

## 4.5 Caching layers, in order

*Read this one* — three stacked caches, and one of them will confuse you within a week.

1. **Service worker** (browser) — caches the JS/CSS bundle and, `NetworkFirst`, `/api/*` responses
   for an hour. `/api/oauth/*` is excluded, because replaying a cached token exchange would fail the
   CSRF state check.
2. **CloudFront** — caches static assets; `/api/*` is pass-through.
3. **`node-cache`** (`temp_backend/utils/cache.js`) — in-process, in the Node heap.
   - `events_all_page_N_limit_M_from_X_to_Y` → **30 seconds**
   - `all_clubs` → **1 hour**, explicitly invalidated by `cache.del('all_clubs')` on club
     create/update/delete.

The clubs cache is a live trap: if you change a club row directly in the database, the app will not
notice for an hour. Save any club through the admin panel to clear it.

---

# Part 5 — The database, table by table

**Level:** Reference · **Time:** skim 10 min, then look up · **Skip if:** you are not touching data — but read §5.3 before you touch `event`.

> **The short version**
> - ~26 tables. One file per table in `temp_backend/database/schemas/`; **all** the relationships are declared in `schemas/index.js` — read that one file and you have the data model.
> - **Content:** `event`, `notice`, `club`, `location`, `event_category` (+ join tables). **Identity:** `user`, `admin_permission(_alloted)`, `club_admin`, `privilege_audit`. **Personal:** four preference tables, `reminder`, `user_todo`. **Ingestion:** `ingested_email` → `event_proposal`. **Calendar:** `academic_calendar_import` → `academic_calendar_entry`.
> - `user.is_super_admin` is a **column, not a permission** — deliberately, because a permission is grantable, and that made the role able to mint itself.
> - `event` has **two** venue fields (`location_id` for curated venues, `venue_text` for freeform) and a `venue_mode` distinguishing four states that must never collapse. Multi-day events are a start plus `duration_minutes`; there is no end column.
> - On `notice`, `deadline` means *apply by* and `event_date` means *when it happens*. Different columns, different meanings, and only `deadline` drives expiry.
> - Only the `not_preferred` half of the preference tables does anything today; the `preferred` half is built and unwired, pending a product decision.

Every table is defined by one file in `temp_backend/database/schemas/`. The relationships between
them are declared in one place, `schemas/index.js` — read that file if you want the shape of the
data in 140 lines.

Two conventions apply everywhere:
- `timestamps: false` on every model. Sequelize's automatic `createdAt`/`updatedAt` are off; where a
  timestamp is wanted the column is declared explicitly as `created_at`.
- Table names are singular and snake_case (`event`, `user_todo`, `admin_permission_alloted`).

## 5.1 The overall shape

*Read this one* — one diagram that replaces reading twenty-six model files.

```
                    ┌──────┐
                    │ user │ ◄──────── the only source of identity
                    └──┬───┘
        ┌──────────────┼──────────────┬─────────────┬────────────┐
        ▼              ▼              ▼             ▼            ▼
 admin_permission  club_admin   user_preferred_*  reminder   user_todo
   _alloted            │        user_not_pref_*      │
        │              │              │             │
        ▼              ▼              ▼             │
 admin_permission    club ◄───────────┘             │
                       │                            │
        ┌──────────────┼───────────────┐            │
        ▼              ▼               ▼            │
      event         notice     sender_entity_map    │
        │  ▲                                        │
        │  └────────────────────────────────────────┘
        ├──► location            (where it happens, curated)
        ├──► event_category_alloted ──► event_category
        └──► event_update

  ingested_email ──► event_proposal ──► (published) event | notice | academic_calendar_entry
  academic_calendar_import ──► academic_calendar_entry
  classification_override, ingestion_state, privilege_audit   (standalone)
```

## 5.2 Identity and access

*Read this one* — contains the single best design decision in the app (and why it is a column).

### `user`

The only table with no auto-increment id: `user_id` is **Channel-i's** id, copied verbatim. That
means we never mint identities — a user exists here only because Channel-i said they exist.

| Column | Type | Notes |
|---|---|---|
| `user_id` | BIGINT PK | from Channel-i |
| `full_name` | VARCHAR(255) NOT NULL | |
| `email` | VARCHAR(255) UNIQUE NOT NULL | institute webmail |
| `phone_number` | VARCHAR(20) | |
| `display_picture` | TEXT | usually a Channel-i-relative path, hence the `https://channeli.in` prefixing in the UI |
| `enrolment_number` | VARCHAR(255) UNIQUE | how admins identify a person when granting rights |
| `branch`, `current_year`, `branch_department_name` | | |
| `token_version` | INT NOT NULL DEFAULT 0 | **the session kill switch.** Bumped on logout; stamped into the JWT as `tv` and compared on every request. |
| `is_super_admin` | BOOL NOT NULL DEFAULT false | **deliberately a column, not a permission** — see below |
| `created_at`, `updated_at` | | |

Rows are written by `User.upsert(...)` in the OAuth callback, so a user's profile refreshes on every
login. Note what the upsert does **not** touch: `token_version` and `is_super_admin`.

**Why `is_super_admin` is a column and not a row in `admin_permission`.** A permission is grantable.
If super-admin were a permission, then anyone who could grant permissions could mint another super
admin — the power to grant would be the power to create grantors, and no gate could ever close that
loop. As a column outside the grantable set the loop is broken by construction. It is settable
through exactly one route (`PATCH /admins/:userId`, itself super-admin-only) and by nothing else:
Joi's `stripUnknown` means the field is silently dropped from every other request body in the app.

### `admin_permission` / `admin_permission_alloted`

Six rows, seeded with fixed ids by migration `20260805000000`:

| id | name | grants |
|---|---|---|
| 1 | `event_crud` | create/edit/delete **any** event; see all events in the admin panel |
| 2 | `location_crud` | manage the Locations table |
| 3 | `event_category_crud` | manage event categories |
| 4 | `manage_admins` | *read* the admin list; also the gate for the academic calendar |
| 5 | `manage_club_admins` | manage which students admin which club |
| 6 | `manage_clubs` | create/edit/delete clubs |

`admin_permission_alloted` is the many-to-many join: `(admin_permission_id, user_id)` composite
primary key.

**Never compare against raw ids in code.** `temp_backend/utils/permissions.js` reads the table once
at boot and resolves names to ids: `permissionId(PERM.MANAGE_CLUBS)`. The ids come from insertion
order, and a database rebuilt from scratch numbers them differently — this was observed for real,
where a fresh test database put `manage_admins` at 2 instead of 4 and a super admin was denied an
upload as a result.

### `club_admin`

`(club_id, user_id)` composite PK. A student who is a coordinator for one club and nothing else. They
can create and edit events **for that club only**, and review ingestion proposals attributed to it.

### `privilege_audit`

Append-only. Every grant and revoke writes a row here *and* raises a Sentry alert. Never updated,
never deleted by application code — if a row is wrong, the fix is another row.

The reasoning is worth internalising: granting admin is rare, high-impact and hard to notice.
Previously someone gaining admin looked identical to someone who always had it. With a handful of
admins, **detection beats prevention** — an unexpected "X granted admin to Y" alert is instantly
recognisable as wrong, and this table is what lets you unwind it.

## 5.3 The content tables

*Read this one* — before you touch `event`. The two venue fields and `venue_mode` are not obvious.

### `club`

| Column | Notes |
|---|---|
| `id` | serial PK |
| `name` | TEXT UNIQUE NOT NULL |
| `email` | TEXT UNIQUE, **nullable** |
| `description`, `logo_url` | |
| `is_fest` | BOOL — Cognizance, Srishti, Thomso, Sangram are club rows shown in a "Fests" group |

`email` was made nullable on purpose. Not every club owns a broadcast mailbox — sections that only
ever go out through a general-secretary relay (BlocSoc, ArIES, Esports, Comedy Section) have no
address of their own, and a NOT NULL column meant they could not be added without inventing one,
which would then be shown to students as a `mailto:` link that bounces. Postgres permits many NULLs
under a UNIQUE constraint, so uniqueness for the clubs that *do* have an address is unaffected.

There is always a club called **"Institute"** — the catch-all for anything not tied to one club.

### `event`

The centre of the app.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | TEXT NOT NULL | |
| `club_id` | BIGINT NOT NULL → `club.id` ON DELETE CASCADE | every event has an owner |
| `location_id` | INT → `location.id` ON DELETE SET NULL | the *curated* venue |
| `tentative_start_time` | **TIMESTAMPTZ** NOT NULL | timezone-aware; see below |
| `duration_minutes` | INT NOT NULL | also how multi-day events are expressed |
| `actual_start_time` | TIMESTAMPTZ | rarely used |
| `description` | TEXT | |
| `image_url` | TEXT | poster |
| `is_all_day` | BOOL | true ⇒ render no clock time |
| `source` | VARCHAR(16) `'manual'` \| `'email'` | where the row came from |
| `status` | VARCHAR(16) | `scheduled` \| `updated` \| `cancelled` \| `rescheduled` \| `completed` |
| `source_sender`, `source_message_id` | | provenance for ingested rows |
| `registration_link` | TEXT | |
| `registration_deadline` | DATE | "register by", distinct from the start |
| `audience` | VARCHAR(24) | display-only badge |
| `venue_text` | TEXT | **freeform** venue |
| `venue_mode` | VARCHAR(8) | `online` \| `physical` \| `tba` \| null |

Three things about this table trip people up.

**Two venue fields.** `location_id` points at a curated `location` row; `venue_text` is free text off
an email ("APJ-205", "LBS Ground"). In production the `location` table is effectively **empty**, so
`venue_text` is the real venue for almost every event. `locationLabel()` in
`src/components/Event/EventCard.jsx` is the single function that decides what to print.

**`venue_mode` is not decoration.** Four states must never collapse into each other:
- `online` → "Online". It happens on Meet/Zoom; there is no room and never will be.
- `tba` → "Venue to be announced". A real room exists, it just is not decided yet — the student
  should come to campus and watch for a follow-up.
- `physical` → print the room.
- null with no venue → "Location TBA" — the email never mentioned one. That is a gap in our
  information, not a stated promise.

**Multi-day events have no end column.** A three-day fest is stored as a start plus a
`duration_minutes` spanning to the end. `EventCard` renders a date range from any duration ≥ 1 day.

There is a Postgres **exclusion constraint** on this table, `no_overlapping_events_at_location`
(`database/initConstraints.js`): two events cannot occupy the same `location_id` at overlapping
times. It uses the `btree_gist` extension. Violating it surfaces as SQL error `23P01`, which
`routes/event.js` translates into a **409 Conflict** with a human message. Because `location_id` is
almost always null in production, the constraint rarely fires.

### `location`

Curated venues: `name` (unique), `location_url`, `latitude`, `longitude`, `description`, and
`images` (JSONB array). Managed from the admin panel. Largely unpopulated in production — see above.

### `event_category` / `event_category_alloted`

Six categories, seeded at boot:

`Talks & Lectures` · `Competitions & Hackathons` · `Workshops & Courses` · `Recruitments & PORs` ·
`Sports & Fitness` · `Cultural & Fests`

`event_category_alloted` is the many-to-many join with composite PK `(event_id, event_category_id)`.
An event may have several categories or none.

> **Warning — do not add categories through the admin panel's Category tab.** The category list is
> *configuration*, not data: it appears in `services/eventIngestion/institutions/iitr.config.js`
> (`categories` + `categoryRules`), in the Groq classifier's prompt, and in the seed script. Adding a
> row to the table alone gives you a category nothing can ever assign. See
> [Recipes §12.6](#126-add-an-event-category).

### `event_update`

`(id, event_id, update)`. A free-text changelog line attached to an event. Written by the ingestion
lifecycle path. Not currently surfaced prominently in the UI.

### `notice`

Everything that is **not** something you attend. Announcements, deadlines, opportunities.

| Column | Notes |
|---|---|
| `id` | BIGINT PK |
| `title`, `body`, `link` | |
| `priority` | `important` \| `general` — drives the pinned band |
| `deadline` | DATE — **apply-by**. Drives expiry. |
| `deadline_time` | VARCHAR(5) "HH:MM" IST — when the mail said "apply by 21 Aug, 6 PM". Null ⇒ end of day. |
| `event_date`, `time_start` | when the thing *happens*, kept distinct from apply-by |
| `venue`, `venue_mode` | same semantics as `event` |
| `open_ended` | BOOL — "until further notice" items never expire |
| `audience` | display badge |
| `kind` | `scholarship`\|`recruitment`\|`competition`\|`fee`\|`registration`\|`resource`\|`facility`\|`deadline`\|`notice` |
| `is_opportunity` | BOOL — surfaced by the "Opportunities" filter |
| `club_id` | BIGINT → `club.id` ON DELETE SET NULL, **nullable** |
| `source`, `source_message_id` | provenance; **stripped before the API responds** |
| `published_at`, `expires_at`, `created_at` | |

`deadline` vs `event_date` is the distinction the table exists to make. *"Applications close 15 Aug"*
is a deadline. *"Library reopens 1 Aug, 10:30 AM"* is an `event_date`. A notice can have either,
both, or neither.

`club_id` was added later. The table was built for office announcements which genuinely have no club
— but measurement on 50 real club emails showed **62% of club mail is deadline-shaped** (recruitment,
PoR calls, competitions) and lands here. Without a club those were orphaned: reviewed by global
admins instead of the club's own coordinators, and missing from the club's page. `Institute` is
stored as **NULL**, not as the Institute club's id, so "no club" stays distinguishable from "the
Institute club".

## 5.4 Per-user tables

*Skip if:* you are not touching preferences, reminders or to-dos.

### `user_preferred_club` / `user_not_preferred_club` / `user_preferred_category` / `user_not_preferred_category`

Four tables, identical shape, composite PK of `(user_id, club_id | event_category_id)`.

**Only the `not_preferred` half is actually used.** The feed's filter is
`notPreferredClubIds.has(Number(ev.club_id))` — "hide the clubs I un-followed". The `preferred`
tables are written and read but nothing acts on them, because a product decision was never made
between *pin-to-top* and *strict whitelist*. The category preference UI was never built at all; the
backend, the endpoints and the AuthContext plumbing are all in place and waiting. There is a comment
block in `src/pages/Home.jsx` marking exactly where the missing filter clause goes.

Writes go through `PATCH /user/preferences`, which deletes all four sets and re-inserts, inside a
transaction, then re-issues the JWT with the new ids baked in.

### `reminder`

| Column | Notes |
|---|---|
| `event_id`, `user_id`, `offset_minutes` | **composite PK — all three** |
| `reminder_time` | TIMESTAMPTZ, computed as `event start − offset` |

`offset_minutes` being part of the primary key is what allows several reminders per user per event
(30 minutes before *and* 5 minutes before). `initializeSchema.js` contains a guarded `DO $$` block
that rebuilds the primary key only if its columns are wrong — dropping and re-adding a correct PK on
every boot would take an `ACCESS EXCLUSIVE` lock for no reason.

The server stores reminders so they survive a device change. The *firing* is entirely client-side —
see [§10.5](#105-reminders-and-notifications).

### `user_todo`

A personal checklist. `text`, `notes`, `due_date`, `due_time`, `completed`, plus four
`linked_event_*` columns that **denormalise** a snapshot of an event ("Register for X" remembers the
event's name, club, and date as plain text). Deliberate: a to-do should keep reading sensibly after
the event it referenced is deleted.

## 5.5 Academic calendar

*Skip if:* you are not touching the calendar import.

### `academic_calendar_import`

One row per PDF upload — the audit trail that makes rollback possible. `parsed_snapshot` (JSONB)
holds the complete committed entry set, so a bad import can be reverted **without the original PDF**.
We deliberately do not store raw PDF bytes.

### `academic_calendar_entry`

`id` is a **string** primary key, a slug like `iitr-autumn-2026-general-mid-term-exams`, not a
serial. That makes an import idempotent: re-uploading the same calendar upserts the same rows rather
than duplicating them.

`start_date` / `end_date` are `DATEONLY` — a plain `'YYYY-MM-DD'` string with no timezone conversion
at all. Both are **nullable**, because a genuinely undecided ("TBD") date stays null until an admin
fills it in. `source` is `'pdf'` or `'email'`; `tentative` flags a row the parser was unsure about;
`raw_date_text` keeps the original string for debugging; `source_import_id` links back for rollback.

## 5.6 Email ingestion

*Skip if:* you are not touching ingestion — but §5.6's `event_proposal` is the app's central idea.

### `ingested_email`

One row per Gmail message: `message_id` (unique), `thread_id`, `internal_date`, `from_addr`,
`to_addrs`, `subject`, `body_text`, `raw_snapshot` (JSONB), `state`, `error`, `dedup_key`.

This is the **Inbox Replay** net. Keeping the normalised email means you can re-run the pipeline
after improving the parser, replay a bug-reported message, and regression-test against a saved
corpus — without touching Gmail again.

`dedup_key` is a normalised subject. The same announcement genuinely arrives as separate messages via
`ug@`, `pg@` and `students-notices@`, plus `Fwd:` and reminder copies; message-id dedup misses all of
those.

### `event_proposal`

The heart of the human-in-the-loop design. **The parser never writes an event.** It proposes a typed
mutation and a human publishes it.

| Column | Notes |
|---|---|
| `id` | BIGINT PK |
| `ingested_email_id` | → `ingested_email.id` |
| `mutation_type` | see below |
| `target_event_id`, `club_id` | |
| `payload` | JSONB — the extracted fields |
| `evidence` | JSONB — per-field confidence, attribution route, rule version, the LLM-vs-regex verdict, and the human's eventual correction |
| `state` | `proposed` \| `published` \| `dismissed` |

`mutation_type` is the vocabulary:

| Type | Meaning |
|---|---|
| `CREATE_EVENT` | a new thing to attend |
| `CREATE_NOTICE` | a new announcement or opportunity |
| `CALENDAR_ENTRY` | a holiday / working-day change to the academic calendar |
| `PATCH_EVENT` | this event moved (new date, time, or venue) |
| `CANCEL_EVENT` | this event is off |
| `PATCH_NOTICE` | this deadline was extended |
| `DISMISS` | the gates rejected this mail — recorded, not shown |

### `sender_entity_map`

Admin-taught "this sender is that club", so attribution is not a regex buried in code. Only
content-**homogeneous** senders and fests get rows; a mixed sender intentionally has none and falls
through to "Institute". Self-extending: an admin can promote an unknown sender with one click.

### `classification_override`

A super-admin-taught rule: `(sender_addr [+ subject_pattern]) → target_type`. Applied *before* the
LLM, so it wins over everything. `hit_count` and `last_hit_at` track whether a rule is earning its
keep. A subject pattern is **required** for relay senders so one rule cannot blanket many clubs.

Scoped by construction: it only ever runs on proposals that already exist, so a PII-gated email —
which never becomes a proposal — is structurally unreachable by any rule.

### `ingestion_state`

A tiny key/value store. Three keys in practice: `gmail_history_id` (the incremental cursor),
`last_sync` (the heartbeat, JSON), `auth_status` (so an expired refresh token is visible rather than
making the feed silently go stale).

## 5.7 Indexes and performance

*Skip if:* you are not writing a query that runs on the feed path.

Added after a Docker stress test loaded 20,000 events and found the feed query doing a full sequential
scan (~11.7 ms). With these it is an index scan (~0.09 ms) — about 130× — and holds 7,000+
queries/sec at 20 concurrent clients.

```sql
idx_event_start_time    ON event (tentative_start_time)   -- the feed orders by this
idx_event_club          ON event (club_id)
idx_event_status        ON event (status)
idx_unpref_club_user    ON user_not_preferred_club (user_id)
idx_pref_club_user      ON user_preferred_club (user_id)
idx_eca_category        ON event_category_alloted (event_category_id)
idx_notice_priority / idx_notice_published / idx_notice_deadline
idx_user_email / idx_user_enrolment_number
idx_ingested_email_msgid (unique) / idx_ingested_email_date / idx_ingested_email_dedup
idx_acal_entry_key (institution, semester, program) / idx_acal_entry_start
idx_event_proposal_club / _state / _email
```

The connection pool caps at 10 (`DB_POOL_MAX`) with `acquire: 15000` so an exhausted pool fails fast
instead of hanging for a minute. Two Postgres-side timeouts guard against a single runaway query
cascading into a whole-app freeze: `statement_timeout` and `idle_in_transaction_session_timeout`,
both 30 s by default and both env-tunable.

---

# Part 6 — Who is allowed to do what

**Level:** Everyone · **Time:** 12 min · **Skip if:** nothing, if you will touch any endpoint.

> **The short version**
> - Identity comes from **Channel-i**, IIT Roorkee's student portal, over OAuth. We never see a password and never mint a user id.
> - **Four tiers:** student → club admin (a row in `club_admin`) → institute admin (one or more of six permissions) → **super admin** (the `is_super_admin` column, the only tier that may grant rights).
> - The six permissions are `event_crud`, `location_crud`, `event_category_crud`, `manage_admins`, `manage_club_admins`, `manage_clubs`. Code resolves them **by name** at boot — never compare a raw id.
> - The JWT is a **cache, not the truth**. It carries permissions so the UI knows what to render; every write is re-checked against the database, and super-admin status is read fresh on every gated request.
> - Fourteen distinct defensive layers are listed in [§6.6](#66-the-layers-of-defence-listed). The one worth internalising is Joi's `stripUnknown` — it is why `is_super_admin` can only reach a model write through the single schema that names it.

## 6.1 Logging in: the Channel-i OAuth dance

*Skip if:* you can explain an OAuth authorisation-code flow and what `state` prevents.

Channel-i is IIT Roorkee's own student portal. It is our identity provider. We never see or store a
password.

```
 Browser              Our backend                    Channel-i
   │                       │                             │
   │ GET /api/oauth/login  │                             │
   ├──────────────────────►│  mint random `state`,       │
   │                       │  set oauth_state cookie     │
   │  302 redirect ────────┼────────────────────────────►│
   │                                                     │  user approves
   │  302 back to redirectURL?code=…&state=…             │
   │◄────────────────────────────────────────────────────┤
   │ GET /api/oauth/token  │                             │
   ├──────────────────────►│ compare state vs cookie     │
   │                       │ POST code ─────────────────►│
   │                       │◄──────────── access_token   │
   │                       │ GET user data ────────────►│
   │                       │◄──────────── profile        │
   │                       │ User.upsert(...)            │
   │                       │ read permissions + clubs    │
   │                       │ sign JWT, set auth_token    │
   │  302 → /app/home ◄────┤                             │
```

`state` is a 32-byte random nonce stored in a short-lived `oauth_state` cookie and compared on the
way back. Without it an attacker could feed you their own authorisation code and log you into *their*
account. Mismatch ⇒ **403**.

The JWT payload carries `user_id`, `enrolmentNumber`, `branch`, `currentYear`, `displayPicture`,
`permission_names`, `club_admin_club_ids`, the four preference arrays, and `tv`. Lifetime is
`SESSION_TTL_HOURS` hours, default **720** (30 days).

> Why 30 days and not 24 hours: until the Channel-i IP whitelist is in place nobody can
> re-authenticate from the cloud, so cutting the lifetime would strand every existing session. The
> value is env-driven precisely so it can be shortened without a redeploy the moment login is
> reliable.

**Logout** (`POST /oauth/logout`) does two things: increments `token_version` — which kills every
token this account holds, in every browser — and clears the cookie.

## 6.2 The four tiers

*Read this one* — twelve lines, and every permission decision in the app follows from it.

| Tier | Determined by | Can do |
|---|---|---|
| **Student** | any valid session | read everything, set preferences, reminders, to-dos |
| **Club admin** | a row in `club_admin` | create/edit/delete events **for their clubs**; review and publish proposals attributed to their clubs; edit their clubs' notices; edit their own club's details |
| **Institute admin** | one or more rows in `admin_permission_alloted` | whatever their permissions say — events anywhere, clubs, locations, categories |
| **Super admin** | `user.is_super_admin = true` | everything above **plus** granting and revoking rights, classification override rules |

An institute admin holding `event_crud` is treated as a club admin of **every** club: the OAuth
handler expands `club_admin_club_ids` to all club ids for them.

## 6.3 The permission middlewares

*Read this one* — the table tells you which file to open for any gate.

All in `temp_backend/middlewares/`. Each one first runs `userData` (which verifies the session), then
checks a permission, and most fall back to a club-admin check.

| File | Export | Logic |
|---|---|---|
| `userAuth.js` | `userLoggedIn`, `userData` | valid session, else 401. (`userData` is just an alias.) |
| `permissions/event.js` | `checkEventPermission` | `event_crud`, else club admin **of that event's club** |
| `permissions/location.js` | `checkLocationPermission` | `location_crud`, else any club admin |
| `permissions/eventCategory.js` | `checkEventCategoryPermission` | `event_category_crud`, else any club admin |
| `permissions/manageClubs.js` | `checkManageClub` | `manage_clubs`; on PATCH also allows the club's own admin |
| `permissions/manageClubAdmins.js` | `checkManageClubAdminsPermission` | `manage_club_admins`, else club admin of that club |
| `permissions/manageAdmins.js` | `checkManageAdminsPermission` | `manage_admins` only — no fallback |
| `permissions/academicCalendar.js` | `checkAcademicCalendarPermission` | `manage_admins` only. The calendar is institution-wide; a club admin must not overwrite it. |
| `permissions/adminPermissionsManage.js` | `checkAdminPermissionsManage` | `manage_admins`. Gates editing the permission *definitions* themselves. |
| `permissions/superAdmin.js` | `requireSuperAdmin`, `isSuperAdmin` | reads `user.is_super_admin` **from the database**, every time |
| `clubAdminAuth.js` | `checkClubAdmin`, `checkClubAdminForClub` | the club-admin fallbacks used by the above |

`checkEventPermission` does something subtle: when the caller lacks `event_crud`, it looks up the
event's `club_id`, writes it into `req.body.club_id`, and hands off to `checkClubAdminForClub`. So
"can you edit event 42" becomes "do you admin the club that owns event 42".

> **Note the inconsistency.** `routes/eventIngestion.js` defines its *own* `requireSuperAdmin` that
> checks the `manage_club_admins` permission, not the `is_super_admin` column. It is used for the
> classification-override routes and `/drift`. That is a leftover from before the column existed; the
> column version in `middlewares/permissions/superAdmin.js` is the canonical answer. If you touch
> that file, unify them.

## 6.4 Review scope

*Skip if:* you are not touching ingestion or notices.

Ingestion has its own scoping function, `reviewScope(userId)` in `routes/eventIngestion.js`:

```js
// global event admin OR super-permission → { all: true }
// otherwise                              → { all: false, clubIds: [...] }
```

Every proposal, candidate-lookup, publish and notice edit re-checks against it. The publish route
goes further with an **IDOR guard**: a club-scoped admin's `payload.club` is overwritten with their
own club's name, so they cannot re-attribute a published event to a club they do not manage even by
editing the request body.

*IDOR* = Insecure Direct Object Reference: passing an id for something you should not be allowed to
touch and having the server obey. The pattern to copy is: never trust a client-supplied id; always
re-check it against the caller's scope in the handler.

## 6.5 Two lockout guards worth knowing

*Skip if:* you are not touching the admin routes — it is four sentences either way.

`PATCH /admins/:userId` refuses to:
1. let you remove **your own** super-admin flag — you would lose the very right needed to undo it;
2. remove the **last** super admin — the app would have no route back at all and recovery would mean
   SSH and raw SQL.

## 6.6 The layers of defence, listed

*Read this one* — fourteen numbered lines. The fastest security orientation in the book.

Because they are spread across files, here is the whole set in one place:

1. **Origin/Referer check** on every write (`app.js`) — blocks cross-site form posts.
2. **`SameSite=Lax` cookie** — the browser will not attach the session to most cross-site requests.
3. **Content-Type must be `application/json`** on writes — forces a CORS preflight, which then fails
   for an unknown origin.
4. **`httpOnly` cookie** — a XSS bug cannot read the token.
5. **JWT signature with `HS256` pinned** — no algorithm-confusion trick.
6. **`token_version` revocation** — logout genuinely kills sessions.
7. **Joi `stripUnknown`** — undeclared fields are removed, so nothing can be smuggled into a model
   write. This is what makes `is_super_admin` unreachable from every route but one.
8. **Sequelize parameterisation** — no SQL injection.
9. **Rate limits** — 5 failed logins / 5 min, 100 writes / 15 min per *user*.
10. **`helmet`** — frame-deny, nosniff, HSTS, referrer policy, no `X-Powered-By`.
11. **`hpp`** — parameter-pollution collapse.
12. **1 MB body cap**, 20 MB image cap, 8 MB PDF cap, 20000px image-dimension cap.
13. **Generic error responses** with a correlation id — no stack traces, no paths, no constraint
    names reach the browser (`utils/httpError.js`).
14. **`safeHref` / `safeCssUrl`** on the frontend — ingested content can contain a `javascript:` URL.

---

# Part 7 — The complete API reference

**Level:** Reference · **Time:** look up · **Skip if:** you already know the endpoint you need — jump to [Appendix C](#appendix-c--endpoint-index).

> **The short version**
> - Base URL is `/api` in every environment. Roughly 80 endpoints, all JSON, one router per prefix.
> - The three you will use most: `GET /events/all` (the feed — paginated, cached 30 s), `GET /ingestion/notices` (the notices tab), `GET /ingestion/proposals` (the review queue).
> - Errors are `{ error, message }`; server errors add an `errorId` you can grep for in the logs.
> - **The trap:** a new column on `event` must be added to `standardFlatAttributes` *and* the attribute list inside `GET /:eventId`, *and* the handler's destructuring in `POST /add` and `PATCH`. Miss one and the API silently drops it.
> - Only the `/academic-calendar` GETs, `/health` and `/` are reachable without a session.

Base URL is **`/api`** in every environment. Add it to every path below.

Every endpoint returns JSON. Errors are `{ error, message }` and, for 500s that go through
`utils/httpError.fail()`, `{ error, errorId }` — quote that `errorId` when reporting a bug and it can
be grepped in the logs.

**Auth column key:** `—` none · `user` any valid session · `perm:X` requires permission X (usually
with a club-admin fallback) · `super` requires `is_super_admin` · `scope` requires the caller's review
scope to cover the target.

## 7.1 Auth — `/oauth`

*Skip if:* you know the shape of `GET /oauth/user` — it drives the entire frontend permission model.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/oauth/login` | — | mint `state`, redirect to Channel-i |
| GET | `/oauth/token` | — | OAuth callback: exchange code, upsert user, set `auth_token`, redirect into the app |
| GET | `/oauth/user` | user | current profile + `authContext` (permissions, club ids, preferences, `is_super_admin`) |
| POST | `/oauth/logout` | user | bump `token_version`, clear cookie |
| GET | `/oauth/dev-login` | — | **dev only.** Not registered in production. Requires `DEV_LOGIN=true`. |

`GET /oauth/user` response shape — this drives the entire frontend permission model:

```jsonc
{
  "userData":   { "user_id": 12345, "full_name": "…", "email": "…", "is_super_admin": false, … },
  "authContext": {
    "is_admin": true,
    "is_super_admin": false,
    "permission_names": ["event_crud"],
    "club_admin_club_ids": [3, 7],
    "preferred_clubs": [], "not_preferred_clubs": [12],
    "preferred_categories": [], "not_preferred_categories": []
  }
}
```

## 7.2 Events — `/events`

*Read this one* — the feed contract, plus the two-allowlist trap.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/events/all` | user | **the feed.** `?page`, `?limit` (max 50), `?from=YYYY-MM-DD`, `?to=`. Cached 30 s. |
| GET | `/events/admin/all` | user | club-scoped listing for the admin panel. `event_crud` sees everything; a club admin sees only their clubs'. |
| GET | `/events/count` | user | total events |
| GET | `/events/venue/:venue_id` | user | upcoming events at a curated location |
| GET | `/events/date/:date` | user | events on an IST day (`YYYY-MM-DD`; bad format ⇒ 400) |
| GET | `/events/:eventId` | user | one event with club, location and categories |
| GET | `/events/clubs/preferred` | user | events from clubs you follow |
| GET | `/events/clubs/not-preferred` | user | events from clubs you hid |
| GET | `/events/categories/preferred` | user | events in your preferred categories |
| GET | `/events/categories/not-preferred` | user | the inverse |
| POST | `/events/add` | `perm:event_crud` or club admin | create |
| PATCH | `/events/:eventId` | `perm:event_crud` or that club's admin | partial update |
| DELETE | `/events/:eventId` | `perm:event_crud` or that club's admin | delete |

**List response:**

```jsonc
{
  "events": [{
    "id": 42, "name": "…", "club_id": 3, "club_name": "PAG", "club_logo_url": "…",
    "tentative_start_time": "2026-08-30T14:30:00.000Z", "duration_minutes": 120,
    "is_all_day": false, "status": "scheduled",
    "location_id": null, "location_name": null, "venue_text": "APJ-205", "venue_mode": "physical",
    "registration_link": "https://…", "registration_deadline": "2026-08-28",
    "description": "…", "image_url": "…",
    "category_ids": [1, 3], "categories": "Talks & Lectures, Workshops & Courses"
  }],
  "currentPage": 1, "pageSize": 10, "totalEvents": 137, "totalPages": 14
}
```

Note `categories` is a **comma-joined string** in list responses and an **array of objects** in the
single-event response. `src/services/events.js` normalises both shapes; that is what
`normalizeListEvent` and `normalizeSingleEvent` are for.

> **Warning — the two allowlists.** A column added to the `event` model will not appear in the API unless
> you also add it to `standardFlatAttributes` (the list/feed queries) **and** to the explicit
> attribute array inside `GET /events/:eventId`. This has silently swallowed real columns:
> `registration_link` existed and was written by the publisher for months, and no student ever saw a
> registration link, because it was in neither list. Handlers also destructure an explicit field list
> in `POST /add` and `PATCH`, so a field must be added there too.

`POST /events/add` body:

```jsonc
{
  "name": "…",                       // required
  "club_id": 3,                      // required
  "tentative_start_time": "2026-08-30T14:30",   // required; naive values are read as IST
  "duration_minutes": 120,           // required
  "location_id": null, "description": "…", "image_url": "…", "is_all_day": false,
  "category_ids": [1, 3],
  "venue_text": "APJ-205", "venue_mode": "physical",
  "registration_link": "…", "registration_deadline": "2026-08-28"
}
```

`PATCH` takes the same fields, all optional, plus `status`. It uses `!== undefined` checks so an
explicit empty string **clears** a value while an untouched field is left alone.

Time handling: `normalizeEventTimestamp()` accepts `YYYY-MM-DDTHH:MM` (interpreted as IST for
backward compatibility), a fully-zoned ISO string, or a `Date`, and always stores UTC.

**409 Conflict** means the location/time exclusion constraint fired.

## 7.3 Notices and ingestion — `/ingestion`

*Skip if:* you are not touching notices or the review queue.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/ingestion/notices` | user | **the Notices tab.** Sorted: important → soonest deadline → expired last. |
| GET | `/ingestion/notices/:id` | user | one notice |
| PATCH | `/ingestion/notices/:id` | scope | correct a live notice |
| DELETE | `/ingestion/notices/:id` | scope | remove a live notice |
| GET | `/ingestion/proposals` | scope | the review queue (`state='proposed'`) |
| POST | `/ingestion/proposals/:id/publish` | scope | publish (with the reviewer's edits) |
| POST | `/ingestion/proposals/:id/dismiss` | scope | reject |
| GET | `/ingestion/proposals/:id/event-candidates` | scope | live events a PATCH/CANCEL might target |
| GET | `/ingestion/proposals/:id/notice-candidates` | scope | live notices a deadline extension might target |
| GET | `/ingestion/proposals/:id/calendar-candidates` | scope | calendar entries an amend might target |
| GET | `/ingestion/status` | user | is Gmail wired, auth status, last-sync heartbeat |
| POST | `/ingestion/verify` | global admin | prove the Gmail credentials work |
| POST | `/ingestion/run` | global admin | pull now. `?days=N` clamped to 365, default 30. |
| GET | `/ingestion/overrides` | reviewer | list classification rules |
| GET | `/ingestion/overrides/preview` | super | blast-radius check before saving a rule |
| POST | `/ingestion/overrides` | super | create a rule |
| DELETE | `/ingestion/overrides/:id` | super | delete a rule |
| GET | `/ingestion/drift` | super | proposed-vs-approved agreement stats |
| POST | `/ingestion/dev-seed` | super | seed sample proposals for UI work |

Publish body:

```jsonc
{
  "payload": { /* the reviewer's corrections, merged over the proposal's own payload */ },
  "approvedType": "event" | "opportunity" | "info",   // optional reclassification
  "targetId": 42,                                      // required for PATCH/CANCEL/amend
  "mode": "add" | "amend"                              // calendar proposals only
}
```

`/ingestion/run` clamping is not cosmetic. Unbounded, `?days=99999` becomes a `newer_than:99999d`
Gmail query that walks years of mail in one request, holds the event loop for minutes, and burns the
entire daily Groq allowance — after which the pipeline silently degrades to the regex fallback for
every email that day. A quality failure with no error anywhere.

Notices strip `source` and `source_message_id` before responding (`publicNotice()`); `club_name` is
attached because that is who is organising, not internal metadata.

## 7.4 Academic calendar — `/academic-calendar`

*Skip if:* you are not touching the calendar.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/academic-calendar` | — | current semester (`?semester=` to pick). Returns `{total, data, teachingDays}`. |
| GET | `/academic-calendar/semesters` | — | the semester picker list |
| GET | `/academic-calendar/:id` | — | one entry |
| GET | `/academic-calendar/imports` | `perm:manage_admins` | import history, for rollback |
| GET | `/academic-calendar/current` | `perm:manage_admins` | the current calendar in editable form |
| POST | `/academic-calendar/import/preview` | `perm:manage_admins` | **multipart.** Parse a PDF, write nothing. |
| POST | `/academic-calendar/import/commit` | `perm:manage_admins` | publish the reviewed entries |
| POST | `/academic-calendar/import/:id/rollback` | `perm:manage_admins` | restore a previous import |

Those three GETs, plus `/health` and `/`, are the only unauthenticated endpoints in the app. Entries are returned in a legacy
shape — `{id, title, category, startDate, endDate, description, isHoliday}` — plus an optional
`clubId`/`clubName` when the title names a real club ("Thomso 2026").

Preview outcomes, all as `status`: `ok` · `coming_soon` (an MBA or other-format calendar) ·
`no_text` (a scan) · `unrecognized` · `uncertain`. Only `ok` yields entries.

## 7.5 Clubs — `/clubs`

*Skip if:* you are not touching clubs — note only the 1-hour cache.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/clubs` | user | all clubs. **Cached 1 hour** in-process. |
| GET | `/clubs/:id` | user | one club |
| POST | `/clubs/create` | `perm:manage_clubs` | invalidates the cache |
| PATCH | `/clubs/update/:id` | `perm:manage_clubs` or that club's admin | invalidates the cache |
| DELETE | `/clubs/delete/:id` | `perm:manage_clubs` | **cascades to the club's events** |

Note the non-REST paths (`/create`, `/update/:id`, `/delete/:id`). Historical; left alone because
changing them would break clients for no benefit.

## 7.6 Locations — `/locations`

*Skip if:* almost certainly — the table is effectively empty in production.

| Method | Path | Auth |
|---|---|---|
| GET | `/locations/all` | user |
| GET | `/locations/:locationId` | user |
| POST | `/locations/add` | `perm:location_crud` or club admin |
| PATCH | `/locations/:locationId` | `perm:location_crud` or club admin |
| DELETE | `/locations/:locationId` | `perm:location_crud` or club admin |

Responses use the key `locations` (plural) even for a single row — `misc.js` does
`response.data.locations[0]`.

## 7.7 Event categories — `/event-categories`

*Skip if:* you are not adding a category (and if you are, read §12.6 first).

| Method | Path | Auth |
|---|---|---|
| GET | `/event-categories/all` | user |
| GET | `/event-categories/:categoryId` | user |
| POST | `/event-categories/add` | `perm:event_category_crud` or club admin |
| PATCH | `/event-categories/:categoryId` | same |
| DELETE | `/event-categories/:categoryId` | same |

## 7.8 Admins — `/admins` and `/admin-permissions`

*Skip if:* you are not touching privilege granting.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admins/all` | `perm:manage_admins` | list admins + their permissions |
| GET | `/admins/:userId` | `perm:manage_admins` | one admin |
| POST | `/admins/add` | **super** | grant. Identify by `user_id` **or** `enrolment_number`. |
| PATCH | `/admins/:userId` | **super** | replace permissions; optionally set `is_super_admin` |
| DELETE | `/admins/:userId` | **super** | strip all permissions |
| GET | `/admin-permissions/all` | `perm:manage_admins` | the six definitions |
| GET | `/admin-permissions/:permissionId` | `perm:manage_admins` | |
| PATCH | `/admin-permissions/:permissionId` | **super** | rename a permission |
| DELETE | `/admin-permissions/:permissionId` | **super** | **cascades** — strips it from every holder |

Reads stay on `manage_admins` so the panel still loads for ordinary admins; only the writes are
super-admin. Every write here calls `recordPrivilegeChange()`.

## 7.9 Club admins — `/club-admins`

*Skip if:* you are not touching club coordinators.

| Method | Path | Auth |
|---|---|---|
| GET | `/club-admins/club/:clubId` | `perm:manage_club_admins` or that club's admin |
| GET | `/club-admins/club/:clubId/:userId` | same |
| POST | `/club-admins/club/:clubId/add` | **super** — body `{ enrolment_number }` |
| DELETE | `/club-admins/club/:clubId/:userId` | **super** |

## 7.10 Personal — `/user`, `/todos`, `/reminders`

*Skip if:* you are not touching preferences, to-dos or reminders.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PATCH | `/user/preferences` | user | replace all four preference sets; re-issues the JWT |
| GET | `/todos` | user | your to-dos, newest first |
| POST | `/todos` | user | create |
| PATCH | `/todos/:id` | user | update (scoped to your own rows) |
| DELETE | `/todos/:id` | user | delete |
| GET | `/reminders` | user | your reminders, grouped by event with an `offsetsMinutes` array |
| PUT | `/reminders/:eventId` | user | replace the offsets for one event. Body `{ offsetsMinutes: [30, 5] }` |
| DELETE | `/reminders/:eventId` | user | remove all reminders for that event |
| DELETE | `/reminders` | user | bulk remove. Body `{ eventIds: [...] }` |

`PUT /reminders/:eventId` returns 400 if the event has already started.

## 7.11 Uploads — `/upload`

*Skip if:* you are not touching images.

| Method | Path | Auth | Limits |
|---|---|---|---|
| POST | `/upload/poster` | any upload permission or any club admin | 20 MB, ≤20000 px/side, resized to 1600 px wide |
| POST | `/upload/logo` | same | 5 MB, resized to 512 px wide |

**Multipart**, field name `image`. Returns `{ url }`.

## 7.12 Health

*Skip if:* you are not doing ops.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ok:true}` after a real `SELECT 1`, or **503**. UptimeRobot and the Docker healthcheck use it. |
| GET | `/` | database connectivity banner |

---

# Part 8 — Backend code tour

**Level:** Depth · **Time:** 15 min · **Skip if:** you are working on the frontend only.

> **The short version**
> - `app.js` is the whole server in one readable file: crash handlers, fail-closed boot guards, the middleware stack, thirteen route mounts, the terminal error handler, and a boot sequence that exits on any failure.
> - `routes/` — one file per URL prefix, all the same shape. `middlewares/permissions/` — one file per gate. `utils/` — logger, cache, permissions, S3, Sentry, audit, and the pure `noticeOrder` sort.
> - Validation is Joi at the edge with `stripUnknown`, `abortEarly: false`, `convert: true`. It is not the injection defence — Sequelize's parameterisation is — it is about failing early and legibly.
> - Two services carry the real logic: `academicCalendar/` (PDF → entries) and `eventIngestion/` (email → proposals).
> - In `eventIngestion/`, **`index.js` is pure** (no database, no network) and **`runner.js` is the impure half**. That split is the only reason the pipeline is testable.

## 8.1 `app.js` — the entry point

*Read this one* — if you read one backend file, read this one — the section tells you what to look for.

Roughly 330 lines, and worth reading top to bottom once. In order:

1. `dotenv` loads `.env`.
2. Sentry init (a no-op without `SENTRY_DSN`).
3. **Crash safety** — `uncaughtException` / `unhandledRejection` handlers that log, capture, flush,
   and `process.exit(1)`, so Docker restarts a *fresh* process rather than leaving a zombie.
4. **Fail-closed boot guards** — in production, refuse to start on `DEV_LOGIN=true` or a missing
   `JWT_SECRET`.
5. `app.set('trust proxy', TRUST_PROXY_HOPS)` — see the trap below.
6. CORS configuration.
7. The middleware stack described in [§4.2](#42-a-request-end-to-end).
8. `/health`.
9. Route mounting — thirteen `app.use('/prefix', require('./routes/x.js'))` lines.
10. The terminal error handler.
11. `startServer()` — the boot sequence from [§4.4](#44-the-boot-sequence).

> **`trust proxy` is environment-specific and getting it wrong is silent.** On the EC2 the chain is
> CloudFront → nginx → node, which is **2** hops; a value of 1 made `req.ip` resolve to a CloudFront
> *edge* address. Every student in India routes through a handful of edges, so the per-IP write
> limiter became a single global bucket. Self-hosted docker-compose is nginx → node, i.e. 1 hop.
> Set `TRUST_PROXY_HOPS` per environment.

The write rate limiter keys on **user id** first, IP second, for the same class of reason: the whole
institute shares one public address behind campus NAT, so 100 writes/15 min was a budget for all
8,000 students combined. A student setting up (following four clubs, two reminders) spends 6–10
writes, so a dozen people onboarding at once would lock out everyone else — on launch day, with no
attacker involved.

## 8.2 `routes/` — one file per prefix

*Skip if:* you have seen an Express router before — but note the route-ordering rule.

Every route file follows the same shape:

```js
const express = require('express');
const router = express.Router();
const { Model, … } = require('../database/schemas');
const { userData } = require('../middlewares/userAuth');
const { checkXPermission } = require('../middlewares/permissions/x');
const { Joi, validateBody, validateParams, id } = require('../middlewares/validate');

const bodySchema = Joi.object({ … });

router.get('/', userData, async (req, res) => { … });
router.post('/', checkXPermission, validateBody(bodySchema), async (req, res) => { … });

module.exports = router;
```

**Route ordering matters in Express.** A literal path must be registered before a parameterised one
that could match it. `routes/academicCalendar.js` has an explicit comment on this: `GET /:id` is
last so it does not shadow `/imports`, `/semesters` and `/current`.

| File | Lines | What lives here |
|---|---|---|
| `event.js` | 1099 | the feed, the admin listing, filtered lists, event CRUD. The **allowlists** live at the top. |
| `eventIngestion.js` | 827 | the notices feed, the review queue, publishing, candidate matching, override rules |
| `auth.js` | 411 | the OAuth dance, `/oauth/user`, logout, dev-login |
| `admin.js` | 315 | grant/revoke institute admin, with the lockout guards |
| `upload.js` | 230 | image upload, resize, sanitise, store |
| `clubAdmin.js` | 217 | who admins which club |
| `reminder.js` | 213 | reminder offsets per user per event |
| `academicCalendar.js` | 204 | preview / commit / rollback + the public reads |
| `location.js`, `adminPermissions.js`, `eventCategory.js`, `club.js`, `todo.js`, `user.js` | 115–197 | straightforward CRUD |

## 8.3 `middlewares/validate.js` — Joi

*Read this one* — `stripUnknown` is a security control, not a convenience.

`joi` was a dependency for a long time before anything imported it; every endpoint hand-rolled its
own checks, so coverage was inconsistent and malformed input surfaced as a 500 from deep inside a
handler instead of a 400 at the edge.

Three options carry the weight:

```js
{ abortEarly: false,    // report every problem at once, not one per round trip
  stripUnknown: true,   // DROP undeclared fields rather than forwarding them
  convert: true }       // "12" -> 12, because params arrive as strings
```

`stripUnknown` is the security-relevant one. It is why `is_super_admin` can only ever reach a model
write through the one schema that names it.

`validateBody` **replaces** `req.body` with the sanitised value. `validateParams` and `validateQuery`
only validate — they do not reassign, because Express 5 makes `req.params` and `req.query`
read-only.

Shared building blocks: `id` (accepts an integer or a digit-string, because BIGINTs arrive both
ways), `idList`, `isoDate` (`YYYY-MM-DD`), `hhmm` (`00:00`–`23:59`).

Joi is deliberately **not** the injection defence — Sequelize's parameterisation is. Joi is about
failing early and legibly.

## 8.4 `utils/`

*Skip if:* you would rather find these by grep — the `noticeOrder` story is worth the minute though.

| File | Purpose |
|---|---|
| `permissions.js` | `PERM` name constants, `loadPermissionIds()` at boot, `permissionId(name)`. Read the header comment — it is the best short essay in the repo on why magic numbers in env vars are wrong. |
| `logger.js` | pino. JSON to stdout so Docker ships it to CloudWatch. **Redacts** auth headers, cookies, and anything named `password`/`token`/`secret`. Use `logger.info/warn/error`, not `console.*`. |
| `cache.js` | a single shared `node-cache` instance, 10-minute default TTL |
| `httpError.js` | `fail(res, status, publicMessage, err)` — logs the real error with a short id, alerts Sentry on 5xx, returns only the generic message + id |
| `s3.js` | poster/logo upload to S3. Opt-in on `POSTER_S3_BUCKET`. Pins Content-Type to a safe raster type — an attacker-declared `image/svg+xml` served from our own origin would become a script running with the auth cookie. |
| `sentry.js` | init, capture, flush, and the poller cron check-in |
| `privilegeAudit.js` | write a `privilege_audit` row **and** raise a Sentry warning. Never throws, never blocks the request. |
| `noticeOrder.js` | pure sort/expiry logic for the notices feed — extracted specifically so it can be unit-tested without opening a database connection |

`noticeOrder.js` earns a paragraph. The feed originally sorted "important first, then nearest
deadline". A *past* deadline is the nearest one there is, so **expired notices ranked highest of
all**. Measured against production on 2026-08-22, the first twelve notices served were every one of
them expired — a July fee-waiver extension, a recruitment that closed three weeks earlier. The top of
the tab was a graveyard. Expired now sinks below everything regardless of priority, and it **sorts**
rather than filters, so nothing disappears.

Note the `istToday()` helper: `deadline` is `DATEONLY` meaning end-of-day IST, so it must be compared
against the current *IST* date. Comparing against UTC expires everything five and a half hours early.

## 8.5 `database/`

*Read this one* — the association rule here has caused four production 500s.

`connection.js` builds the one `Sequelize` instance: pool of 10, `acquire: 15000` to fail fast,
30-second statement and idle-in-transaction timeouts, SSL in production, and query logging only in
development. It self-tests with `authenticate()` at require time and exits on failure.

`schemas/index.js` is where all the associations are declared — `belongsTo`, `hasMany`,
`belongsToMany ... through`. **Both directions must be declared.** A comment records a real bug:
only `belongsTo` was declared on the preference tables, so `routes/event.js`'s attempt to include
`Club → UserPreferredClub` threw *"UserPreferredClub is not associated to Club!"* and four endpoints
returned 500.

`migrations/` is the way to change schema now. `npm run migrate` / `migrate:undo` / `migrate:status`
from `temp_backend/`. The container entrypoint runs `db:migrate` automatically on deploy.

## 8.6 `services/academicCalendar/`

*Skip if:* you are not touching the PDF parser.

A pure, testable PDF parser. `parsePdf(buffer)` performs no database writes; the commit lives in the
route layer.

| File | Role |
|---|---|
| `index.js` | the orchestrator — stages, sanity checks, coverage, the LLM sandbox |
| `extractText.js` | `pdfjs-dist` → per-page text |
| `registry.js` | three-way document classification: general / MBA-or-other / not-a-calendar |
| `institutions/iitr.config.js` | the IITR-specific patterns, anchors and sanity bounds |
| `strategies/iitrDeterministic.js` | the actual row extraction |
| `strategies/ExtractionStrategy.js` | the interface a second institution would implement |
| `teachingDays.js` | pulls the teaching-day totals the calendar states about itself |
| `llmAssist.js` | the optional Groq tie-breaker and outlier suggester |
| `store.js` | commit / rollback / serve — the only file here that touches the database |

The LLM is **sandboxed**: it can attach an `aiSuggestion` to a flagged row but never overwrites a
parsed date, and every suggestion must be a valid ISO date within the calendar's own date window
± 60 days or it is discarded.

## 8.7 `services/eventIngestion/`

*Read this one* — the pure/impure split is the most reusable idea in this codebase.

The largest and most interesting subsystem — [§10.7](#107-email-ingestion--the-big-one) covers how it
works. The file layout:

| File | Lines | Role |
|---|---|---|
| `index.js` | 1520 | the **pure** pipeline: gates → de-thread → dates → attribute → classify → extract → proposals. No database, no Gmail. |
| `runner.js` | 545 | the impure orchestration: poll Gmail, persist, call the LLM, write proposals |
| `source/gmail.js` | — | the Gmail adapter (`googleapis`, `html-to-text`), with retry/backoff |
| `review/groq.js` | — | LLM classification + field extraction, with a multi-key pool |
| `review/gemini.js` | — | vision model that reads event posters for missing dates/venues |
| `venue.js` | 150 | venue-string normalisation |
| `institutions/iitr.config.js` | — | **all** the IITR-specific knowledge: domains, lists, deny rules, cues, categories, club aliases |
| `__tests__/` | — | `pipeline.test.js` and friends are real tests; most other files are measurement harnesses |

The separation between `index.js` (pure) and `runner.js` (impure) is the reason the pipeline is
testable at all. `index.js` takes an email object and returns proposals; you can feed it a fixture
and assert on the output with no network and no database.

---

# Part 9 — Frontend code tour

**Level:** Depth · **Time:** 15 min · **Skip if:** you are working on the backend only.

> **The short version**
> - One architectural rule: `pages`/`components` → `services/` → `services/api.js` → the network. **No component ever calls axios directly.**
> - `App.jsx` holds the router, the SWR config and the route table; `AuthContext` holds the session and the derived `canManageX` booleans; SWR holds all server data with a 30-second refresh.
> - `RequireAuth` guards every route but the landing page and the 404, and stashes the intended destination in `sessionStorage` so a shared link survives the round trip through Channel-i.
> - `EventCard.jsx` is the workhorse — four render variants — and exports `locationLabel()`, the single function deciding what is printed where a venue goes.
> - `Admin.jsx` is 1919 lines and thirty-odd `useState` calls. **Do not grow it**; add new admin surfaces as their own component under `components/Admin/`, which is what the last three tabs did.
> - Styling is vanilla CSS, one file per component. The `CATEGORY_COLORS` maps have drifted across three files.

## 9.1 The layered rule

*Read this one* — one rule, and every frontend review comment enforces it.

There is one architectural rule on the frontend and it is worth enforcing:

```
pages/  and  components/     ──►  services/  ──►  services/api.js  ──►  the network
```

**No component ever calls axios directly.** Every network call goes through a module in
`src/services/`. That is why the response interceptor, the credential handling and the API base are
in exactly one place, and why changing them is a one-line job.

`src/utils/` holds pure functions with no imports from either — the only things unit-tested on this
side.

## 9.2 `main.jsx` and `App.jsx`

*Skip if:* you can read a React Router route table unaided.

`main.jsx` is four lines: mount `<App/>` into `#root` inside `<React.StrictMode>`.

> **StrictMode double-invokes effects in development.** If a `useEffect` looks like it runs twice
> locally and once in production, that is why. It is a deliberate hint that the effect is not
> idempotent.

`App.jsx` composes the whole app:

```jsx
<Router basename="/app">          // ← must match vite's `base`
  <SWRConfig value={{ refreshInterval: 30000, revalidateOnFocus: true, revalidateOnReconnect: true }}>
    <AuthProvider>
      <Routes> … </Routes>
      <InstallPrompt />
      <ToastViewport />
    </AuthProvider>
  </SWRConfig>
</Router>
```

The route table:

| Path | Component | Guard |
|---|---|---|
| `/` | `LandingPage` | public |
| `/home` | `Home` | `RequireAuth` |
| `/calendar` | `Calendar` | `RequireAuth` |
| `/todo` | `Todo` | `RequireAuth` |
| `/profile` | `Profile` | `RequireAuth` |
| `/notifications` | `Notifications` | `RequireAuth` |
| `/admin` | `Admin` | `RequireAuth` |
| `/event/:eventId` | `EventDetail` | `RequireAuth` |
| `/notices/:id` | `NoticeDetail` | `RequireAuth` |
| `*` | `NotFound` | **deliberately public** |

`AppShell` wraps the guarded pages with `<BottomNav>`. The 404 is deliberately outside `RequireAuth`:
a logged-out visitor following a dead link should see a 404, not be bounced to a login they did not
ask for.

## 9.3 `AuthContext` — the app-wide session

*Read this one* — every `canManageX` flag in the UI comes from here.

`src/context/AuthContext.jsx` runs `authService.getCurrentUser()` once on mount and exposes:

```js
{ user, loading, backendSlow, login, logout, notifications, toggleNotification, updateUserPreferences }
```

`user` is the profile plus a set of derived booleans — `canManageEvents`, `canManageClubs`,
`canManageLocations`, `canManageEventCategories`, `canManageAdmins`, `canManageClubAdmins`,
`canManageAcademicCalendar`, `isSuperAdmin` — and four arrays of preference ids plus `managedClubIds`.

`backendSlow` flips true after 8 seconds so the UI can say "the backend is waking up" instead of
looking frozen. A leftover from the Render free tier, still useful on a cold container.

`src/services/auth.js` does the permission-name normalisation, accepting `manage_clubs`,
`manage-clubs` and `manage clubs` as the same thing, because the name has been written all three ways
in different places over time.

Note `canManageAcademicCalendar` is derived from `manage_admins` — matching the backend gate exactly.
When you change one, change the other.

## 9.4 `RequireAuth`

*Skip if:* you are not touching routing — the `returnTo` reasoning is a nice pattern though.

Three states, in order:

1. `loading` → render "Loading…". Deciding during the first async tick would bounce logged-in users
   on every hard refresh.
2. no `user` → `rememberReturnTo(path)` then `<Navigate to="/" replace/>`.
3. otherwise → render the children.

`rememberReturnTo` uses **sessionStorage**, not router state, because logging in leaves the site
entirely (to Channel-i) and comes back to a freshly booted app — in-memory state does not survive the
trip. This is what makes a shared `/notices/17` link work: someone posts it in a hostel group,
everyone who clicks it lands on that notice after logging in rather than on a generic home page.
`src/utils/returnTo.js` refuses to store anything that is not a same-site path, so it cannot become
an open redirect.

## 9.5 The pages

*Read this one* — the feed's four-source merge is the frontend's one genuinely tricky idea.

### `Home.jsx` (577 lines) — the feed

The most complex page. It has two tabs (Events / Notices) and merges **four** different sources into
one events list:

| Source | Where from | Shape trick |
|---|---|---|
| Real events | `useSWRInfinite` over `/events/all` | paginated, 10 per page |
| Academic calendar entries | `/academic-calendar` | mapped to `{ id: "academic-…", isAcademicCalendar: true }` |
| Your to-dos (opt-in) | `/todos` | mapped to `{ id: "todo-…", isTodoEvent: true }` |
| Notices due **today** | `/ingestion/notices` filtered on `deadline === today` | `{ id: "deadline-…", isDeadlineItem: true }` |

The prefixed synthetic ids are how `EventCard` knows which variant to render, and how the reminder
service knows which items can be persisted server-side (`isServerPersistableEventId` only accepts
pure digits).

The last row is the interesting one. An opportunity — a club recruitment, a PoR call, a scholarship —
has a *deadline*, not a start time. Publishing it as a real event would invent a date. So it stays a
notice and only **borrows** the feed on the day it actually matters.

Then, in order: filter out anything that ended more than an hour ago, sort by start time, filter by
selected categories, hidden clubs, search, and date range.

**Search** is token-based: every word must appear *somewhere* across the item's fields, in any order.
The old single-`includes()` test meant "cinema screening" found nothing unless those two words were
adjacent in that order — "Screening by Cinema Club" did not match. The haystack includes
`venue_text`, because for ingested events that is the venue a student can actually see on the card.

Infinite scroll is an `IntersectionObserver` on a sentinel div with a 300 px root margin.

The whole feed asks for `?from=<today>` because the endpoint returns oldest-first: without it the
first pages fill with past events that the feed then discards, and once the table holds a few hundred
rows the feed looks **empty** until you page through all of history.

### `Calendar.jsx` (571 lines)

Month grid and agenda views (`viewMode` is `'grid'` or `'strip'`), with category filter chips. Merges
the same four sources as Home.

The chips are **derived from the events on screen**, never hardcoded. They used to be a fixed array
containing 'Technical', 'Cultural' and 'Sports' — none of which is a real category, so those chips
could never match anything, and there was no chip for any of the six real categories.

### `Admin.jsx` (1919 lines)

Nine tabs, each shown only if the current user's permissions allow it:

| Tab | Needs | Does |
|---|---|---|
| Events | `canManageEvents` or club admin | create / edit / delete events |
| Locations | `canManageLocations` | CRUD locations |
| Categories | `canManageEventCategories` | CRUD categories — see the warning in §5.3 |
| Admins | `canManageAdmins` | grant / revoke institute admin |
| Club Admins | `canManageClubAdmins` | assign coordinators to clubs |
| Manage Clubs | `canManageClubs` or club admin | CRUD clubs, upload logos |
| Academic Calendar | `canManageAcademicCalendar` | → `AcademicCalendarManager` |
| Review | `canManageEvents` | → `ProposalReviewManager` |
| Notices | `canManageEvents` | → `NoticeManager` |

If the active tab becomes unavailable the page falls back to the first one the user can see.

This file is a genuine refactor candidate: it is one component holding thirty-plus `useState` calls.
Do not expand it — put new admin surfaces in `components/Admin/` as their own component, which is
what the last three tabs did.

### The rest

| Page | Notes |
|---|---|
| `LandingPage.jsx` | logo, "Sign in with Channel-i". If already logged in, redirects to `takeReturnTo() \|\| '/home'`. |
| `Profile.jsx` | your details, logout, and the **club-follow list** — the only preference UI that exists |
| `Todo.jsx` | the checklist, plus the "show in feed" toggle (which lives in `localStorage` and broadcasts a custom DOM event so Home picks it up) |
| `Notifications.jsx` | your reminders and their offsets (5 / 15 / 30 / 60 min) |
| `EventDetail.jsx` | one event, share buttons, reminder toggle. Handles the `academic-…` synthetic ids too. |
| `NoticeDetail.jsx` | one notice, full body |
| `NotFound.jsx` | the 404 |

## 9.6 Components

*Skip if:* you will find these by filename anyway.

| Component | Notes |
|---|---|
| `Event/EventCard.jsx` | the workhorse. Renders four variants keyed off `isAcademicCalendar` / `isTodoEvent` / `isDeadlineItem`. Exports **`locationLabel(event)`**, imported by Calendar, EventDetail and the backend's reminder route logic mirrors it. |
| `Layout/BottomNav.jsx` | Feed / Calendar / Personal / (Admin) / Profile. The Admin tab appears if `isAdmin` or `managedClubIds.length > 0`. |
| `Admin/ProposalReviewManager.jsx` | the review queue: five buckets (Events, Opportunities, Info, Calendar, Updates), edit-then-publish cards |
| `Admin/NoticeManager.jsx` | edit and delete live notices |
| `Admin/AcademicCalendarManager.jsx` | PDF upload → preview → month-grid review → commit, plus a re-upload diff and rollback |
| `Common/ToastViewport.jsx` | renders toasts published by `services/toast.js` |
| `Widgets/InstallPrompt.jsx` | the "add to home screen" banner. Handles Android's `beforeinstallprompt` and shows manual iOS instructions; dismissal is remembered for 12 hours. |
| `Icons/WhatsAppIcon.jsx` | an inline SVG, because lucide has no brand icons |

## 9.7 Services

*Skip if:* it is a lookup table — come back when you need a service.

| Service | Wraps |
|---|---|
| `api.js` | the shared axios instance + both interceptors. Read it once, properly. |
| `auth.js` | login redirect, `getCurrentUser()`, logout |
| `events.js` | event endpoints + the two response normalisers |
| `notices.js` | `/ingestion/notices` |
| `clubs.js`, `misc.js` (locations + categories), `admins.js`, `clubAdmins.js` | admin CRUD |
| `academicCalendar.js` | reads + the preview/commit/rollback flow |
| `ingestion.js` | proposals, publish, dismiss, candidates, overrides, status, run |
| `todo.js`, `reminders.js`, `user.js` | personal data |
| `upload.js` | multipart poster/logo upload |
| `eventReminders.js` | **540 lines** — the client-side reminder scheduler. See [§10.5](#105-reminders-and-notifications). |
| `shareEvent.js` | Web Share API with a clipboard fallback, plus a WhatsApp deep link |
| `toast.js` / `notify.js` | a tiny pub-sub toast bus. `notify(msg)` guesses the severity from the wording unless you pass one. |

## 9.8 Utils

*Skip if:* unless you are touching notice display, update merging or untrusted URLs.

| Util | Purpose |
|---|---|
| `notice.js` | notice display helpers: `noticeKind`, `noticeSnippet`, `deadlineChip`, `fmtDate`, `daysLeftText`, `bodyPoints`. Prefers the server's `kind`, falls back to keyword derivation for legacy rows. Tested. |
| `updateDraft.js` | `mergeTargetIntoDraft(base, candidate)` — merges a live event's current values *underneath* a reply email's new ones for the Updates review card. One-directional: whatever the reply said wins. Tested. |
| `safeUrl.js` | `safeHref` (http(s) only, else `#`) and `safeCssUrl` (percent-encoded, cannot break out of `url("…")`). React escapes text nodes but **not** href schemes or CSS url values, and ingested email content is untrusted. |
| `returnTo.js` | the login round-trip destination, with an open-redirect guard |

## 9.9 Styling

*Skip if:* you are not writing CSS here.

Vanilla CSS, one `.css` file per component, imported directly by the `.jsx`. No Tailwind, no
CSS-in-JS, no preprocessor. Global variables and resets live in `src/index.css`; the app shell layout
is in `src/App.css`.

The palette is the institute's: deep purple `#713364`, gold `#FFD700`, with per-category accents
defined as `CATEGORY_COLORS` maps inside `EventCard.jsx`, `Calendar.jsx` and `EventDetail.jsx`.

> Those three maps have **drifted apart**. `EventCard` and `EventDetail` still carry keys like
> `Technical` and `Workshop` that are not real categories, while `Calendar` has the correct six. If
> you touch category colours, unify them into one shared module.

---

# Part 10 — Feature deep dives

**Level:** Depth · **Time:** read one section at a time · **Skip if:** you are not touching that feature — read only the section you need.

> **The short version**
> - **The feed** merges four sources into one list — real events, academic-calendar entries, your to-dos, and notices whose deadline falls today — using prefixed synthetic ids (`academic-…`, `todo-…`, `deadline-…`) so the card knows which variant to render.
> - **Notices** sort important → soonest deadline → expired last. Expired *sinks* rather than disappearing; before that fix, the top twelve notices production served were all expired.
> - **The academic calendar** is parsed from the official PDF: preview writes nothing, a human reviews a month grid, commit upserts and stores a full snapshot so rollback works without the original file.
> - **Reminders** are a hybrid — the server stores the subscription so it survives a device change, but the notification fires entirely in your browser from a `setTimeout` plus a 20-second catch-up poller. **There is no server-side push.**
> - **Email ingestion** runs gates (the privacy wall is structural — non-broadcast mail is never stored) → dedup → attribution → classification → extraction → an `event_proposal` a human publishes.
> - **LLMs are caged everywhere.** Groq classifies but the deterministic result is the fallback; a Groq field value only wins if corroborated by text in the email; Gemini reads posters only to fill gaps. All fail safe to `null`.

**Read only the section for the feature you are touching.** Nothing here depends on anything else
here; each section names its own files.

| Working on… | Go to | Files |
|---|---|---|
| the feed, search, filters, infinite scroll | **[§10.1](#101-the-events-feed)** | `src/pages/Home.jsx`, `EventCard.jsx`, `routes/event.js` |
| the notices tab, ordering, expiry | **[§10.2](#102-the-notices-tab)** | `src/utils/notice.js`, `utils/noticeOrder.js` |
| the academic calendar or its PDF import | **[§10.3](#103-the-academic-calendar)** | `services/academicCalendar/`, `AcademicCalendarManager.jsx` |
| to-dos | **[§10.4](#104-to-dos)** | `src/pages/Todo.jsx`, `routes/todo.js` |
| reminders or notifications | **[§10.5](#105-reminders-and-notifications)** | `src/services/eventReminders.js`, `routes/reminder.js` |
| clubs, following, preferences | **[§10.6](#106-clubs-and-preferences)** | `src/pages/Profile.jsx`, `routes/user.js` |
| **email ingestion** — gates, attribution, classification, the LLMs | **[§10.7](#107-email-ingestion--the-big-one)** | `services/eventIngestion/` |
| the admin review queue | **[§10.8](#108-the-review-workflow-from-an-admins-chair)** | `ProposalReviewManager.jsx` |
| image upload, resizing, the bomb guard | **[§10.9](#109-image-uploads)** | `routes/upload.js`, `utils/s3.js` |
| the PWA, install prompt, service worker | **[§10.10](#1010-the-pwa)** | `vite.config.js`, `InstallPrompt.jsx` |

## 10.1 The events feed

*Skip if:* you are not touching the feed — but the IST paragraph applies everywhere.

**Files:** `src/pages/Home.jsx` · `src/components/Event/EventCard.jsx` · `temp_backend/routes/event.js`

Covered structurally in [§9.5](#95-the-pages). Three behaviours worth understanding at the code
level:

**Everything is IST, and that is not free.** `toISOString()` returns UTC. In IST (UTC+5:30) that means
between 00:00 and 05:30 local, `new Date().toISOString().slice(0,10)` gives you **yesterday**. The
codebase has a `localDay()` or `istToday()` helper in at least five files for exactly this. Symptoms
when it is missed: today's events vanish before dawn; an all-day event stored at local midnight
renders as "Fri, 14 Aug" while a timed event on the same day correctly says "Today"; notices expire
five and a half hours early.

**All-day is a stored fact, not an inference.** `is_all_day` is a real column, set by the publisher
when no clock time was extracted. `formatTime()` in `EventCard` also treats a literal `T00:00:00` in
the string as all-day, which is a belt-and-braces fallback for synthetic items.

**Multi-day is duration, not an end column.** `formatEventDateRange(startTime, durationMinutes)`
renders `18-19 Apr` or `30 Apr - 2 May` from a duration ≥ 1 day.

## 10.2 The notices tab

*Skip if:* you are not touching notices.

**Files:** `src/utils/notice.js` · `temp_backend/utils/noticeOrder.js` · `routes/eventIngestion.js`

A notice is anything not attendable. The tab has three filters: **All**, **Opportunities**
(`is_opportunity = true` — things you apply to), and **Info**.

Sort order, from `compareNotices()`:

1. **Not expired + `priority = 'important'`**
2. **Not expired + general** — soonest deadline first, dateless last, then newest published
3. **Expired** — everything, most-recently-closed first

`open_ended` notices ("until further notice") never expire.

The `important` band itself was re-derived once already: a first pass marked 60% of notices important,
which makes the band meaningless. It is now consequence-based — does missing this actually cost you
something.

## 10.3 The academic calendar

*Skip if:* you are not touching the calendar — the caged-LLM design is reusable, though.

**Files:** `temp_backend/services/academicCalendar/` · `routes/academicCalendar.js` ·
`src/components/Admin/AcademicCalendarManager.jsx`

The institute publishes the semester calendar as a PDF. It used to be hardcoded in a JavaScript file
that someone re-typed every semester. Now a super admin uploads the PDF and the app parses it.

### The pipeline

```
PDF buffer
   │
   ├─ extractText()         pdfjs-dist → per-page text. No text layer (a scan)? → status 'no_text'
   │
   ├─ classifyDocument()    general calendar / MBA-or-other / not a calendar / uncertain
   │                        └─ optional Groq tie-break, ONLY when deterministic is unsure
   │
   ├─ strategy.extract()    iitrDeterministic → { entries, flags, meta }
   │
   ├─ applyAiSuggestions()  optional; attaches suggestions to FLAGGED rows only, never overwrites
   │
   ├─ runSanity()           row-count bounds + required anchor entries → soft warnings
   ├─ buildCoverage()       totals: entries, tentative, flagged, holidays, aiSuggested
   └─ extractTeachingDays() the totals the PDF states about itself
        │
        ▼
   Report { status:'ok', entries, flags, warnings, coverage, meta }
```

### Preview → review → commit

`POST /import/preview` **writes nothing.** It returns the parsed report; the admin sees a month grid,
fixes any flagged or TBD dates by hand, and only then `POST /import/commit` upserts the entries and
records an `academic_calendar_import` row holding the full snapshot.

`POST /import/:id/rollback` restores from that snapshot. This is why we store `parsed_snapshot` rather
than the PDF: rollback must work even if nobody can find the original file.

The manager component also computes a **re-upload diff** entirely in the browser: parse a new PDF,
compare it against the currently published calendar for the same semester, and mark only the *changed*
rows. Purely additive — it never blocks the preview.

### Why the LLM is caged

The parser must be deterministic. A calendar is authoritative and a hallucinated exam date is worse
than no date. So the Groq assist can do exactly two things:
- break a tie when deterministic classification is *uncertain* (and fail safe to "uncertain" if the
  model is unavailable or non-committal);
- suggest a date for a row already **flagged** as unparseable — validated as a real ISO date inside
  the calendar's own window ± 60 days, or discarded.

It can never change a date the parser read.

### The club-name attachment

A few calendar rows genuinely name a club: "Thomso 2026", "Cognizance-2026 Tentative". `attachClub()`
in the route does a conservative **whole-word** match of club names against entry titles, longest name
first, never matching "Institute". This exists because the feed's hide-club test is
`notPreferredClubIds.has(Number(ev.club_id))` — with no `club_id` that is `has(NaN)`, always false, so
un-following Thomso left "Thomso 2026" sitting in the feed with no way to remove it.

## 10.4 To-dos

*Skip if:* you are not touching to-dos. Two paragraphs either way.

**Files:** `src/pages/Todo.jsx` · `temp_backend/routes/todo.js`

Plain per-user CRUD. Two touches worth noting:

**Feed overlay.** A `localStorage` flag `iitr_show_feed_todos` decides whether incomplete to-dos are
merged into the feed and calendar as synthetic items. `Todo.jsx` writes the flag and dispatches a
custom DOM event `iitr:todo-feed-toggle-changed`; `Home.jsx` listens for it (plus `focus` and
`storage`) so the two pages stay in sync without a shared store.

**Linked events are denormalised.** "Register for the hackathon" stores `linked_event_id` *and* the
event's name, club, and date as plain text. If the event is later deleted the to-do still reads
sensibly. This is a deliberate exception to normalisation.

## 10.5 Reminders and notifications

*Skip if:* you are not touching reminders — note only that there is **no** server-side push.

**Files:** `src/services/eventReminders.js` (540 lines) · `src/pages/Notifications.jsx` ·
`temp_backend/routes/reminder.js`

This is a **hybrid**: the server stores your subscription so it survives a device change, but the
notification fires **entirely in your browser**. There is no server-side push. No web-push keys, no
service-worker push handler, no cron that sends anything.

```
 You tap the bell
        │
        ├─► Notification.requestPermission()
        ├─► localStorage['event-reminder-subscriptions-v1'][eventId] = { …, offsetsMinutes:[30,5] }
        ├─► PUT /reminders/:eventId  { offsetsMinutes:[30,5] }     (numeric event ids only)
        └─► setTimeout for each offset
                │
                ▼
        registration.showNotification(...)   ← via the service worker if there is one,
                                               falling back to `new Notification(...)`
        markSent(eventId, offset) → localStorage['event-reminder-sent-v1']
```

Four mechanisms cooperate to make this survive real browser behaviour:

1. **`setTimeout`** for anything within `2147483647` ms (~24.8 days — the 32-bit signed limit). Beyond
   that, no timer is set at all.
2. **A 20-second polling monitor** that fires anything due, including anything missed while the tab
   was suspended — within a 2-minute `DUE_WINDOW_MS` grace window.
3. **`focus` and `visibilitychange` listeners** that run the same check the moment you return.
4. **A "sent" map** in `localStorage`, keyed `eventId-offsetMinutes`, so a reminder cannot fire twice
   from two different paths.

On login, `scheduleStoredReminders()` fetches the server list and **merges** it with local state, so a
reminder set on your phone appears on your laptop.

Only numeric event ids are persisted server-side (`isServerPersistableEventId`) — the synthetic
`academic-…`, `todo-…` and `deadline-…` items are local-only by construction.

Notification permission is only requested when you actually tap the bell, never on page load.

## 10.6 Clubs and preferences

*Skip if:* you are not touching preferences.

**Files:** `src/pages/Profile.jsx` · `routes/user.js` · `routes/club.js`

Profile shows every club with a follow/hide toggle. Saving `PATCH /user/preferences` replaces all four
preference sets inside a transaction and re-issues the JWT with the new ids.

Only the **hide** direction does anything today. See [§5.4](#54-per-user-tables) and the marked comment
block in `Home.jsx` for exactly what is missing and where it goes.

## 10.7 Email ingestion — the big one

*Read this one* — the reason this app is interesting. Read it even if you never touch the code.

**Files:** `temp_backend/services/eventIngestion/` · `routes/eventIngestion.js` ·
`src/components/Admin/ProposalReviewManager.jsx`

The feature the app was really built for. A backend Gmail account subscribes to
`students-notices@iitr.ac.in`; the runner polls it, and every mail is turned into a **proposal** a
human then approves.

### The whole flow

```
Gmail poll (every INGEST_POLL_MINUTES, default 15)
   │
   ├─ listHistory(cursor) → new message ids     [or a backfill on the first run / a stale cursor]
   ├─ reverse to OLDEST-FIRST                   ← so a reply never becomes the anchor for its original
   │
   └─ for each message:  processMessage()
        │
        ├─ getMessage + normalizeMessage         (html-to-text)
        ├─ already in ingested_email?  → skip
        │
        ├─ ══ GATES ══  (BEFORE any body is stored)
        │     · sender is on iitr.ac.in?                        else gate0_offdomain
        │     · addressed to a PUBLIC broadcast list?           else gate1_not_broadcast   ← THE PRIVACY WALL
        │     · Gmail says DKIM/SPF/DMARC pass?                 else gate_spoofed_sender
        │     · contains personal data?                         → gate_sensitive           (hard, non-overridable)
        │     · hard governance/commercial deny?                → gate_governance
        │     · soft deny sender/subject, unless a positive student signal rescues it
        │           ↓ any failure
        │       recordDropped(email, body_text=null)  ← the body is NEVER persisted
        │
        ├─ Groq privacy screen (drop-only backstop for anything the regex wall missed)
        │
        ├─ ══ DEDUP ══  same normalised subject, same sender, ≤21 days
        │     · says nothing new                       → state 'duplicate', no proposal
        │     · adds a date/time/venue the original lacked → goes through, LINKED to the prior
        │     · is a cancel/reschedule                 → goes through as a lifecycle mutation
        │
        ├─ persist ingested_email (state 'parsed')
        │
        ├─ ══ runPipeline() ══  (pure, no DB)
        │     de-thread → parse dates → attribute → classify → extract → proposal[]
        │
        ├─ maybeAttachPoster()   image attachment → S3/disk; Gemini reads it for MISSING fields only
        │
        └─ ══ reviewProposals() ══
              · a super-admin classification_override wins outright, or
              · Groq decides the type and extracts fields, merged GUARDED over the deterministic ones, or
              · the deterministic result stands
              → write event_proposal rows, state 'proposed'
```

### The gates, and why they are ordered that way

`passesGates()` in `index.js`. The critical one is the **broadcast-list check**. Anything sent to you
individually — grades, a mail from a professor, an OTP — is not on a list, so it dies at gate 1 and
its body is **never written to the database**. That is the privacy wall, and it is structural rather
than a filter you have to trust.

Sender authenticity is enforced because the institute publishes DMARC `p=quarantine; sp=none`, which
means anyone can send as `x@anything.iitr.ac.in` and it is neither quarantined nor rejected. Gmail
already evaluated SPF/DKIM at delivery; we honour its verdict rather than redoing the DNS work.

Soft denies (muted governance senders, junk subjects) can be **rescued** by a positive student signal,
so a muted office still gets through when it actually sends a holiday, fee, scholarship or exam
notice.

### De-threading

`topMessage(body)` decides whether to keep only the text above a quote block, or the whole thing.
The threshold is `TOP_MIN = 900` characters, tuned on a 435-mail corpus. Campus forwards routinely
carry a thin covering note ("Dear all, please see below" + a signature) over the actual announcement —
at the original threshold of 200 that cut 58 mails, one from 2998 characters down to 273, taking its
date with it.

### Dates

`parseDates()` handles `DD.MM.YYYY`, `12 Aug 2026`, `August 12, 2026`, and ranges
(`12-14 August 2026`, `12 to 14 Aug`, `12 & 13 August`). Then a **plausibility window**: anything more
than 35 days before or 400 days after the send date is discarded, because *"Shaheed Diwas … 23 March
1931"* once yielded a 1931 event date for a 2026 painting competition.

If nothing plausible survives, the result is **no date at all** rather than a date known to be wrong.
A blank field costs the admin ten seconds; a wrong one puts students in the wrong room on the wrong
day.

Two fallbacks run after: `yearlessDate()` ("12 August" with no year) and `relativeDate()`
("tonight/today/tomorrow" against the send date). The relative resolver is deliberately conservative:
of 13 mails in the corpus containing such a word with no absolute date, most were *not* event dates
("Join us today using the link", "the Constitution we celebrate today"). Gating on a **time sitting
next to the word** accepted 3 of the 13 with zero false positives.

### Attribution — which club sent this?

`attribute()` tries six routes in strict order:

| # | Route | Note |
|---|---|---|
| 1 | the club's **own email address** from the roster | exact; 24% of a year's mail on its own. Relay addresses excluded. |
| 2 | the admin-taught `sender_entity_map` | but **not** for a relay |
| 3 | the **subject** names a club | |
| 4 | the club **signs off** above the forwarder's block | |
| 5 | a club named in the body **as the organiser** | requires an organiser cue |
| 6 | a relay whose text named nobody → the map's forwarder | |
| — | fallback | **"Institute"** |

Two hard-won details:

*Relays are special.* `gensec.cult@` is stored as "Cultural Council" but forwards for every cultural
club. Letting the sender map win there collapsed every cultural club into the council — measured over
a year, 18 of 39 relay mails had the real club named right there in the subject.

*Bare body mentions are worthless.* Plain body matching produced "Cognizance" from *"please take
cognizance of"*, "Fine Arts" from *"students from fine arts, design and architecture"*, and "Thomso"
from a date in the academic calendar. Roughly half its hits were wrong. Requiring an organiser cue
keeps the real ones.

Current measured state: **~39% attributed to a real club, ~61% Institute** — which is near the ceiling
for what the mail actually states.

### Classification

`classify()` returns one of four types:

| Type | Test |
|---|---|
| `calendar` | the subject matches holiday / teaching-day / timetable-change cues. **Checked first.** |
| `event` | attend-intent **or** a venue, plus a date **or** a venue |
| `opportunity` | scholarship, recruitment, or a deadline cue — an announcement you *apply to* |
| `notice` | everything else |

Then `runPipeline()` applies the overrides on top:

- a **lifecycle** cue (cancelled / postponed / deadline extended) beats everything and emits
  `CANCEL_EVENT`, `PATCH_EVENT` or `PATCH_NOTICE`;
- a **club's own** hackathon, competition or recruitment is promoted from opportunity/notice to
  `CREATE_EVENT` — students turn up to it on campus. The *same* club merely circulating somebody
  else's national contest stays a notice. This needs a resolved club that is a real student club, not
  an institute office.

That last rule has an amusing failure it had to be taught around: the Institute Sports Council's own
on-campus triathlon was read as external purely because a later line mentioned "the National Triathlon
Championship, organized by the Triathlon Federation of India". The external test is now scoped to the
subject plus the first 400 characters of the body, and the club's own name is neutralised before the
test so "hosted by the SocBiz" cannot read as outsourcing.

### The LLM layer

Groq is **primary for classification** and the deterministic result is the **fallback**, never a
default. Every proposal's `evidence` records a dual verdict — `{ deterministic_type, llm_type, agreed }`
— so the disagreement rate is a drift alarm. Current agreement is around 70%.

Field extraction is a **guarded, monotonic merge** (`mergeFields`). A Groq value only replaces the
deterministic one when it (a) passes a format gate, (b) is **corroborated by a matching token
somewhere in the email** — which blocks pure invention — and (c) for dates, lands inside the
plausibility window around the send date.

Gemini reads **posters**, and only to fill gaps the text did not supply. It can never overwrite a
text-extracted value.

Both fail safe: no key, a timeout, or malformed JSON returns `null` and the deterministic answer
stands.

> **Cost is a real constraint here.** Groq's free tier caps at ~100,000 tokens **per day per account**
> (the figure recorded in `review/groq.js`; Groq changes it periodically, so trust the 429 body over any
> number written down).
> When it is hit, every call 429s, which correctly becomes `null`, which correctly becomes the regex
> fallback — **silently**, for the rest of the day. `review/groq.js` therefore runs a pool of keys on
> separate accounts and retires an exhausted one. Backfills are paced (`INGEST_PACE_MS`, default 20 s
> between messages) so a bulk run does not burst past the per-minute cap.

### Publishing

`POST /ingestion/proposals/:id/publish` in `routes/eventIngestion.js` is where a proposal becomes real:

- `publishEvent()` — creates an `event`. No time ⇒ `is_all_day: true` at `T00:00` (never a fake 9 AM).
  No date at all ⇒ a placeholder a week out, because `tentative_start_time` is NOT NULL and the item
  must still surface for an admin to fix. An `endDate` beyond the start becomes `duration_minutes`.
- `publishNotice()` — creates a `notice`. "Institute" is stored as `club_id = NULL`.
- `publishCalendar()` — adds or amends an `academic_calendar_entry`.
- `applyLifecycle()` — patches or cancels a live event the admin **explicitly picked**. We never
  auto-match a lifecycle mutation onto an event.
- `applyNoticeLifecycle()` — moves a live notice's deadline. **Refuses to move a deadline backwards**,
  because that is the signature of having matched the wrong notice.

The admin may correct any pre-filled field before publishing, and may **reclassify** across Event /
Opportunity / Info. Both are recorded in `evidence.feedback` — `{original_type, approved_type, changed,
edited}` — which is what `GET /ingestion/drift` reports on. That is the feedback loop: it tells you
where the classifier is wrong without anyone filing a bug.

## 10.8 The review workflow, from an admin's chair

*Skip if:* you have used the Review tab yourself.

`src/components/Admin/ProposalReviewManager.jsx`, the *Review* tab. Five buckets:

| Bucket | Contents | Actions |
|---|---|---|
| **Events** | `CREATE_EVENT` | edit fields → Publish, or Dismiss |
| **Opportunities** | `CREATE_NOTICE` with `is_opportunity` | same |
| **Info** | plain `CREATE_NOTICE` | same |
| **Calendar** | `CALENDAR_ENTRY` | choose *add new* or *amend* a listed candidate |
| **Updates** | `PATCH_EVENT` / `CANCEL_EVENT` / `PATCH_NOTICE` | pick the target from candidates, then apply |

Candidates are keyword-overlap matches against live rows, scored, top 5, with stopwords removed. The
Updates card fetches the chosen target's **current values** and merges them *underneath* the reply
email's new ones via `mergeTargetIntoDraft` — so the reviewer approves the finished item, not a bare
diff. Whatever the reply actually said wins; the live event only fills in what the reply was silent
about.

## 10.9 Image uploads

*Read this one* — the decompression-bomb measurement is worth the four minutes on its own.

**Files:** `temp_backend/routes/upload.js` · `utils/s3.js` · `src/services/upload.js`

This replaced a browser→ImgBB path that (a) shipped a real API key in the public JS bundle, (b) never
captured ImgBB's delete handle so nothing uploaded could ever be taken down, and (c) put content we
are responsible for on a free third-party host while the URL lived in our database for years.

Now the browser holds no credentials: it POSTs the file to us, and we authorise, sanitise and store.

One `sharp()` call does three jobs, which is why it earns its place:

1. **Resize** — a 4 MB phone photo of a printed poster becomes ~150 KB. Students are on mid-range
   Android over congested campus wifi; this is the difference between a feed that loads and one that
   does not.
2. **Validate** — sharp throws on anything that is not a real image, so this *is* the magic-byte
   check. Never trust the client's `Content-Type` or filename.
3. **Sanitise** — re-encoding drops EXIF (phone photos carry GPS) and destroys polyglot files that are
   simultaneously a valid image and a valid script.

### The decompression-bomb guard

Byte size does not bound decode cost. libvips decodes in strips, so peak memory tracks image **width**,
not pixel count — which makes the cheap attack a long thin image, not a big square one. Measured on
this exact pipeline:

| Input | File size | Peak memory |
|---|---|---|
| 16000×12500 (200 MP) JPEG — a real 200 MP phone shot | 1.1 MB | 94 MB |
| 16000×16000 (256 MP) PNG | 758 KB | 227 MB |
| **200000×1340 (268 MP) PNG** | **768 KB** | **576 MB** |

That last one passes sharp's default `limitInputPixels` and OOMs the host — a t3.micro has ~315 MB
free and no swap. So the guard caps a **dimension** (20000 px per side) rather than a pixel count,
which is what lets the legitimate 200 MP photo through while the bomb needs an edge an order of
magnitude longer. `metadata()` reads the header only and does not decode, so the probe is safe to run
on a bomb — and it must therefore run before any pixels are touched.

### Two other details

Keys are **server-generated** (`posters/<prefix>-<uuid>.webp`), never the client's filename — path
traversal, collisions, and it is what makes the immutable cache header honest.

Everything, including logos, uses the `posters/` prefix. CloudFront has exactly one behaviour pointing
at that bucket (`/posters/*`), so a `logos/` key would 403 — and because CloudFront rewrites errors to
`index.html`, an `<img>` would receive HTML with a 200 status. A silent, invisible break with a dead
URL persisted to Postgres.

In production, if `POSTER_S3_BUCKET` is unset the route **throws** rather than falling back to local
disk. Falling back would return 200 with a URL pointing at an ephemeral container layer the next
deploy destroys — and that dead URL would be written to the database permanently. A 500 is
recoverable; silent data corruption is not.

## 10.10 The PWA

*Skip if:* you are not touching the manifest or the service worker.

Configured in `vite.config.js` via `vite-plugin-pwa`:

- `registerType: 'autoUpdate'` — the worker updates itself
- scope and `start_url` are both `/app/`
- `navigateFallback: '/app/index.html'` with **`navigateFallbackDenylist: [/^\/api\//]`**
- runtime caching: `NetworkFirst` on `/api/*` with a 10 s network timeout and a 1-hour expiry,
  **excluding** `/api/oauth/*`

That denylist is not optional. Without it the service worker answers *every* navigation with the
cached `index.html` — including `/api/oauth/login`, so clicking "log in" just re-rendered the SPA and
the Channel-i redirect never happened. It only reproduces in a browser that has the worker registered,
which is why `curl` looked fine.

`InstallPrompt.jsx` handles the "add to home screen" banner: Android's `beforeinstallprompt` event,
and manual instructions on iOS which has no such event. Dismissal is remembered for 12 hours.

---

# Part 11 — Deployment and operations

**Level:** Operations · **Time:** 12 min · **Skip if:** you are not deploying — but read §11.3, everyone forgets it.

> **The short version**
> - Production is CloudFront in front of two origins: S3 (the SPA and posters) and an EC2 t3.micro (nginx → node → RDS PostgreSQL), in `ap-south-1`.
> - **Backend and frontend deploy separately.** `./deploy.sh` runs *on the box* and ships the backend; `./scripts/deploy-frontend.sh` runs *locally* and syncs S3. Running only the first changes nothing visible.
> - Migrations run automatically — the container's command is `npx sequelize-cli db:migrate && exec node app.js`. `deploy.sh` snapshots RDS first whenever a deploy brings a new migration.
> - `--force-recreate` is **mandatory**: compose compares the image and config, *not* the contents of `env_file`, so without it an edited `.env` leaves the old process running with the old values.
> - Self-healing: `restart: unless-stopped` catches a crash, an `autoheal` sidecar catches a *hang*, `mem_limit: 512m` turns a host-wide OOM into a container restart, and capped logging stops a full root volume.
> - Verify with `./scripts/smoke-test.sh` — read-only and safe against production at any time.

## 11.1 The production architecture

*Read this one* — one diagram; you need it before reading anything else in this Part.

```
                        campus-dashboard.iitr.ac.in
                                   │
                          ┌────────▼────────┐
                          │   CloudFront    │  one distribution, three behaviours
                          └───┬─────────┬───┘
              /*  and /app/*  │         │  /api/*
                              ▼         ▼
                       ┌──────────┐   ┌──────────────────────┐
                       │    S3    │   │  EC2  t3.micro       │
                       │ SPA +    │   │   nginx :80          │
                       │ posters  │   │     └─► node :8081   │  docker compose
                       └──────────┘   │         (+ autoheal) │
                                      └───────────┬──────────┘
                                                  │
                                          ┌───────▼────────┐
                                          │  RDS Postgres  │
                                          └────────────────┘
```

- **Region** `ap-south-1` (Mumbai)
- The **frontend is static files on S3**, not a container. The `frontend` service in
  `docker-compose.yml` is local convenience only.
- On the EC2 only two services run: `backend` and `autoheal`.

## 11.2 Deploying the backend

*Skip if:* you will not run a deploy — the three `deploy.sh` decisions are good reading regardless.

SSH (or SSM) to the box and run `./deploy.sh` from the repo directory. Six steps:

| Step | What |
|---|---|
| 1 | `git pull --ff-only`. If `deploy.sh` itself changed, **re-exec** the new version once. |
| 2 | Diff `temp_backend/migrations/` since the last *successful* deploy. If anything changed, take an **RDS snapshot** and prune to the 5 most recent. |
| 3 | `docker compose build backend` |
| 4 | Register a Sentry release named after the commit SHA; write it to `/opt/campus/.release.env` |
| 5 | `docker compose up -d --force-recreate backend autoheal` |
| 6 | Poll `/health` for up to 2 minutes. **Only on success** write the SHA to `.last-deployed-sha`. |

Migrations run automatically — the container's `CMD` is
`npx sequelize-cli db:migrate && exec node app.js`.

Three non-obvious decisions in that script, each of which came from something going wrong:

**`--force-recreate` is required, not cosmetic.** Compose compares the image and the compose config,
**not the contents of `env_file`**. Without it, editing `temp_backend/.env` and redeploying leaves the
old process running with the old values — which is exactly how production once served a two-day-old
Channel-i client id, and why a freshly-set `SENTRY_DSN` appeared to do nothing.

**`BEFORE` is the last *successful* deploy, not `HEAD` before the pull.** If a deploy dies after the
pull, the next run would otherwise see `BEFORE == AFTER`, conclude "no new commits", skip the
snapshot, and let the entrypoint migrate an unprotected database — the reflexive re-run walking
straight through the guard that just fired.

**`SENTRY_RELEASE` is written to a file, not passed as a shell variable.** An interpolated variable is
part of compose's config hash, so a manual `docker compose up -d` from a shell without it would
compute different config, silently recreate the container, and strip the release off the running app.

## 11.3 Deploying the frontend

*Read this one* — this is the step everyone forgets, and forgetting it looks like a broken change.

```bash
./scripts/deploy-frontend.sh              # build, verify, sync to S3, invalidate CloudFront
./scripts/deploy-frontend.sh --check-only # build + verify only — safe any time
```

`deploy.sh` does **not** touch the frontend. If you change something in `src/` and only run
`deploy.sh`, nothing visible changes and you will lose twenty minutes working out why.

The verify step refuses to upload a bundle that contains a `localhost` API base. This nearly shipped
once: a local `.env` with `VITE_API_URL=http://localhost:8081` was baked into a production build,
because **Vite loads `.env` in every mode, including production**. Every visitor would have got a site
that could not reach the API.

The script's design rule is worth copying: *these checks must never fail a working build. A gate with
false positives gets bypassed, and a bypassed gate is worse than no gate.* Every assertion is about a
string guaranteed present or absent by `src/services/api.js`, not a heuristic.

## 11.4 Verifying a deploy

*Skip if:* you are not deploying.

```bash
./scripts/smoke-test.sh                                # against production
BASE=http://127.0.0.1:5173 ./scripts/smoke-test.sh     # against local docker-compose
```

Read-only, safe against production at any time. Not a test suite — every check is something that, if
it fails, means users are affected right now.

## 11.5 Health, self-healing, and alerting

*Skip if:* you are not on call — the crash-versus-hang distinction is the takeaway.

| Layer | Mechanism |
|---|---|
| Liveness | `GET /health` does a real `SELECT 1` and returns **503** if the database is unreachable — "can actually serve", not "process alive" |
| Crash | `restart: unless-stopped` |
| **Hang** | the `autoheal` sidecar watches for `unhealthy` on containers labelled `autoheal=true` and restarts them. `restart:` alone cannot catch a hang. |
| Memory | `mem_limit: 512m` — ~2.7× measured steady state (192 MB), and it fits the worst upload the pixel guard admits |
| Disk | `json-file` logging capped at 3 × 10 MB. Docker's default is **unbounded**, and a full root volume is the most common way a small instance dies at 3 am |
| Errors | Sentry, with a correlation id in every 500 response |
| Poller death | Sentry Cron check-in each ingest cycle — a *missed* check-in alerts, because a dead poller looks perfectly healthy otherwise |
| Uptime | UptimeRobot pings `/health` every 5 minutes |

The memory limit deserves the reasoning: the EC2 is a t3.micro with 916 MB total, ~250 MB of it host
OS + Docker + nginx, and **no swap**. Without a limit the container can allocate until the kernel's
OOM killer fires, and what it kills is whichever process looks worst at that moment — often nginx or
dockerd, i.e. the whole box goes down and nothing restarts it. The limit turns a host-wide outage into
a container restart.

## 11.6 Environment variables

*Skip if:* it is a lookup table — read the five bolded warnings and move on.

### Required

| Var | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | long random string. **Production refuses to boot without it.** |

### Required for real login

`authoriseURL`, `token_URL`, `get_user_data_url`, `client_id`, `client_secret_id`, `redirectURL`,
`FRONTEND_REDIRECT_URL`.

> **Warning.** In production `redirectURL` must be `https://<domain>/api/oauth/token/` — **the `/api` prefix
> matters.** Getting this wrong breaks login with an error that points nowhere useful.

### Play Store guest login (Android build only)

| Var | Notes |
|---|---|
| `GUEST_LOGIN_ENABLED` | `true` to switch the tester door on. Anything else and `POST /oauth/guest-login` **does not exist** (404). |
| `GUEST_LOGIN_USERNAME` | e.g. `playstore-tester`. An identifier, not a secret. |
| `GUEST_LOGIN_PASSWORD_HASH` | the `scrypt.…` string from `node scripts/generate-guest-credential.js`. Note the **dot** delimiter — a `$` would be eaten by docker-compose's `env_file` interpolation, which corrupted the credential on the first deploy. |
| `GUEST_SESSION_TTL_HOURS` | optional, default 168 (7 days). Shorter than a student's 30 because one credential is shared by every tester. |

> **Warning.** All three of the first three are required together. A half-configured server — flag on,
> hash missing — **disables** guest login rather than opening it. That is deliberate and tested.

> **Never put the passphrase in an env var, a commit, or a ticket.** Only the hash is stored anywhere.
> If you lose the passphrase, generate a new pair; there is no recovery, by design.

### Server / CORS

`PORT` (8081) · `NODE_ENV` · `FRONTEND_URL` · `CORS_ALLOWED_ORIGINS` · `CORS_ALLOWED_ORIGIN_REGEX` ·
`ALLOW_VERCEL_PREVIEWS` (**set to `false` in production**) · `TRUST_PROXY_HOPS` (2 behind CloudFront,
1 for plain nginx) · `SESSION_TTL_HOURS`

### Database tuning

`DB_STATEMENT_TIMEOUT_MS` · `DB_IDLE_TXN_TIMEOUT_MS` · `DB_POOL_MAX`

### Ingestion

`GMAIL_CLIENT_ID` · `GMAIL_CLIENT_SECRET` · `GMAIL_REFRESH_TOKEN` · `GMAIL_USER` · `INGEST_QUERY` ·
`INGEST_POLL_MINUTES` / `INGEST_POLL_SECONDS` · `INGEST_PACE_MS`

### AI

`LLM_PROVIDER` · `GROQ_API_KEY` · `GROQ_MODEL` · `GROQ_BODY_CHARS` · `GROQ_MAX_TOKENS` ·
`GEMINI_API_KEY` · `GEMINI_MODEL`

### Storage / observability

`POSTER_S3_BUCKET` · `POSTER_PUBLIC_BASE` · `AWS_REGION` · `INGEST_PUBLIC_BASE` · `SENTRY_DSN` ·
`SENTRY_ENV` · `LOG_LEVEL`

### Dev only — never in production

`DEV_LOGIN` (boot fails if true in production) · `RESET_DB` (**hard-disabled** in production
regardless of value) · `ACAL_DEBUG` · `TEST_DATABASE_URL`

### What is *not* configuration any more

Permission ids used to live in six `*_PERMISSION_ID` env vars. They are gone. Ids do not vary between
deploys, so they were never deployment config — and an environment could silently contradict the code.
Migration `20260805000000` seeds the rows with fixed ids and `utils/permissions.js` resolves them by
**name** at boot.

## 11.7 Logs and debugging in production

*Skip if:* until the first time someone reports a 500.

```bash
docker compose logs --tail=200 backend       # on the EC2
docker compose ps                            # container + health status
curl -fsS http://localhost:8081/health
```

Logs are structured JSON from pino, shipped to CloudWatch by the awslogs agent. We deliberately keep
the `json-file` driver rather than switching to the `awslogs` *driver*, because that driver **replaces**
json-file and `docker logs` stops working on the instance — a bad trade when you are debugging live.

Every 500 response carries an `errorId`. Ask the reporting user for it, grep the logs.

---

## 11.8 The Android app (Play Store)

*Skip if:* you are not shipping to the Play Store.

The Android app is the same React code wrapped by **Capacitor**, in `mobile/`. It is a genuinely
different build from the website, not the website in a frame:

| | Web (`npm run build` → `dist/`) | Android (`npm run build:mobile` → `dist-mobile/`) |
|---|---|---|
| Served from | CloudFront, under `/app/` | Capacitor's local server, at `/` |
| `base` / router basename | `/app/` | `/` |
| API | `/api`, same origin | `https://campus-dashboard.iitr.ac.in/api`, **cross-origin** |
| Session | httpOnly cookie | `Authorization: Bearer`, token in `localStorage` |
| Service worker | yes | **no** — Capacitor already serves the shell locally |
| Login | Channel-i | guest credential only |

**Why the session differs.** Capacitor serves the bundle from `https://localhost`, so every API call is
cross-*site* and a `SameSite=Lax` cookie is — correctly — not attached. The alternative was relaxing
the cookie to `SameSite=None` for every student on the web to suit one client, paying a real CSRF cost
for everyone. Instead the native build carries its token explicitly, and `middlewares/userAuth.js`
accepts a bearer token when there is no cookie. A bearer header is the safer half of the pair: a
browser attaches cookies to cross-site requests by itself, but no page can set an `Authorization`
header cross-origin without our CORS policy agreeing first.

**Why there is no Channel-i button in the app.** Channel-i only knows IITR students, so Google's
reviewer cannot pass it and the app would be un-reviewable. Its flow also leaves for `channeli.in` and
returns by setting a cookie on our domain — a round trip that does not land back inside a WebView
served from `https://localhost`. Shipping a button that cannot work is worse than shipping none.

### The guest door

`POST /oauth/guest-login` takes a username and a 125-bit passphrase and returns a session token. The
account is user `999000002`, holds no permissions, and is **read-only against shared data**:
`middlewares/guestGuard.js` refuses every write except the personal-scope routes (`/todos`,
`/reminders`, `/notice-reminders`, `/notifications`, `/user/preferences`, `/oauth/logout`). That is an
allowlist, so a route added next month is refused to guests by default rather than accidentally
exposed.

Mint the credential — this prints the passphrase **once** and never stores it:

```bash
cd temp_backend && node scripts/generate-guest-credential.js
```

To kill every tester session in flight without changing the passphrase:

```sql
UPDATE "user" SET token_version = token_version + 1 WHERE user_id = 999000002;
```

**None of this reaches the website.** `__MOBILE_BUILD__` is substituted with a literal boolean at build
time, so rollup deletes the branches and the guest panel is loaded through a dynamic import that the
web build never follows. `./scripts/verify-web-bundle-clean.sh` asserts it after every web build — run
it, because this is exactly the kind of separation that regresses silently when someone hoists an
import.

### Building the release bundle

```bash
npm run build:mobile                      # repo root -> dist-mobile/
cd mobile && npx cap sync android         # copy into the Android project
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew bundleRelease                 # -> app/build/outputs/bundle/release/app-release.aab
```

Bump `versionCode` (and `versionName`) in `mobile/android/app/build.gradle` before every upload — Play
rejects a repeated `versionCode`.

> **The signing key is unrecoverable.** `mobile/android/keystore.properties` points at a keystore
> outside the repo. Lose that file or its passwords and you can never publish an update to this
> listing again. Back both up somewhere that is not this machine.

> **`appId` is permanent.** `com.campus.dashboard` cannot change after the first upload.

### Order of operations

The app talks to production, so **deploy the backend first**. Until `GUEST_LOGIN_ENABLED=true` and the
hash are set on the server and it has restarted, the app's guest sign-in answers *"Guest access is not
enabled on this server."* — which looks like a broken app but is the server telling the truth.

# Part 12 — Recipes: how to make common changes

**Level:** Reference · **Time:** look up · **Skip if:** you have nothing to change right now.

> **The short version**
> - **Add a column:** migration → model → **both** API allowlists → the handler's destructuring → the frontend. Skipping any one of the five fails silently.
> - **Add an endpoint:** router file → mount in `app.js` → Joi schemas → permission middleware → a service module on the frontend.
> - **Add an admin tab:** a new component under `components/Admin/`, not more lines in `Admin.jsx`.
> - **Add an event category:** it is configuration in *three* places plus the database — the seed, `iitr.config.js` (`categories` **and** `categoryRules`), and the Groq prompt.
> - **Change how an email is classified:** prefer a super-admin override rule (no deploy, with a blast-radius preview) over editing regexes. If you do edit them, anchor with word boundaries and score the change.
> - Rollback differs per artefact — code, migration, data, calendar and frontend each have their own path, listed in [§12.10](#1210-roll-back).

## 12.1 Add a column to an existing table

*Read this one* — five steps, and skipping any one of them fails **silently**.

Five steps, and **skipping any one of them fails silently**.

**1. Write a migration.** Never edit `initializeSchema.js`.

```bash
cd temp_backend
npx sequelize-cli migration:generate --name event-add-speaker
```

```js
// migrations/2026…-event-add-speaker.js
module.exports = {
  async up(qi, Sequelize) {
    await qi.addColumn('event', 'speaker', { type: Sequelize.TEXT, allowNull: true });
  },
  async down(qi) {
    await qi.removeColumn('event', 'speaker');
  },
};
```

**2. Add it to the model** — `database/schemas/event.js`.

**3. Add it to BOTH API allowlists in `routes/event.js`:**
- `standardFlatAttributes` (feeds the list endpoints)
- the explicit `attributes: [...]` array inside `GET /:eventId`

**4. Add it to the Joi schema *and* the handler's destructuring** in `POST /add` and `PATCH /:eventId`.
Declaring it in Joi is not enough — the handlers destructure an explicit list, so a field absent there
is silently dropped even though validation accepted it.

**5. Use it on the frontend** — the service normaliser if the shape needs it, then the component.

**Test it:** create an event with the new field via the admin panel, reload the feed, confirm the
value survives the round trip. If it comes back `undefined`, you missed step 3 or 4.

## 12.2 Add an API endpoint

*Skip if:* you have the pattern from §8.2 — the checklist at the end is the useful bit.

```js
// temp_backend/routes/thing.js
const express = require('express');
const router = express.Router();
const { Thing } = require('../database/schemas');
const { userData } = require('../middlewares/userAuth');
const { Joi, validateBody, validateParams, id } = require('../middlewares/validate');

const createBody = Joi.object({ name: Joi.string().trim().max(200).required() });
const idParam    = Joi.object({ id: id.required() });

router.get('/', userData, async (req, res) => {
  try {
    res.json({ things: await Thing.findAll({ raw: true }) });
  } catch (e) {
    console.error('Error fetching things:', e);
    res.status(500).json({ error: 'Internal server error', message: 'Could not fetch things' });
  }
});

module.exports = router;
```

Mount it in `app.js`: `app.use('/things', require('./routes/thing.js'));`

Add a service on the frontend — `src/services/things.js` — and call it from a component. **Never call
axios from a component.**

Checklist: right permission middleware? Joi on every body and param? errors caught and returned as
clean JSON? if it is a write, does it need `cache.del(...)`?

## 12.3 Add a page

*Skip if:* until you add one. Three steps.

1. Create `src/pages/Thing.jsx` and `Thing.css`.
2. Import both in `App.jsx` and add a `<Route>`. Wrap it in `<RequireAuth><AppShell>…` unless it is
   genuinely public.
3. If it needs a nav entry, add it to `src/components/Layout/BottomNav.jsx` — but note the bottom nav
   holds five items comfortably and is already full.

## 12.4 Add an admin panel tab

*Skip if:* until you add one — but read it before opening `Admin.jsx`.

Do **not** grow `Admin.jsx`. Create `src/components/Admin/ThingManager.jsx`, then in `Admin.jsx`:

1. add a `canManageThing` check derived from `user`;
2. add the tab button next to the others (~line 967);
3. add `{activeTab === 'thing' && canManageThing && <ThingManager />}`;
4. add the key to `availableTabs` so the fallback logic knows about it.

## 12.5 Add an admin permission

*Skip if:* until you add one. Six steps, three of them on the frontend.

1. Migration: insert the row into `admin_permission` with an explicit id.
2. Add the name to `PERM` in `utils/permissions.js` — `loadPermissionIds()` will then require it at
   boot, which is what you want.
3. Write a middleware in `middlewares/permissions/`, copying an existing one.
4. Apply it to routes.
5. Add the derived `canManageX` boolean in `src/services/auth.js`.
6. Use it to gate UI in `Admin.jsx`.

## 12.6 Add an event category

*Read this one* — before touching categories. It is configuration in three places, not a database row.

The category list is **configuration in three places** plus the database. All four must agree or the
category exists but nothing can ever assign it.

1. `temp_backend/database/seedEventIngestion.js` → the `CATEGORIES` array
2. `services/eventIngestion/institutions/iitr.config.js` → `categories`
3. the same file → a matching rule in `categoryRules` (the regex that assigns it)
4. `services/eventIngestion/review/groq.js` → the classifier prompt's category list

Then restart the backend so the seed runs. Do **not** just add a row through the admin Category tab.

## 12.7 Change how an email is classified

*Read this one* — the first option needs no deploy, and most people reach for code instead.

Do not reach for code first.

**Option A — a super-admin override rule (no deploy).** Admin → Review → Overrides. Enter the sender,
optionally a subject pattern, and the target type. Use the **preview** first — it retro-matches the
last 90 days of real mail and tells you the blast radius. Rules are logged with a `hit_count`, so you
can see later whether one is earning its keep.

**Option B — teach the sender map.** If the problem is attribution rather than type, promote the
sender to a club in the review UI. Only do this for a **content-homogeneous** sender; a mixed sender
should keep falling through to Institute.

**Option C — change the rules (a deploy).** Edit
`services/eventIngestion/institutions/iitr.config.js`. Then:

```bash
node services/eventIngestion/__tests__/pipeline.test.js
```

and bump `RULE_VERSION` in `services/eventIngestion/index.js` **only if** classify/kind/extract logic
changed. It is hand-maintained on purpose — it is stamped into every proposal's evidence so `/drift`
can compare precision across rule changes, and a content hash would churn on unrelated edits and
defeat that.

> When you add a regex alternative, anchor it with `\b`. Unanchored substrings silently mis-tag: "drama"
> fired inside "dramatic", and the same shape gives "cup" in "occupied", "band" in "bandwidth", "match"
> in "rematch".

> And **score every addition** before adding it. The existing rules record their scores as
> (events rescued : already-categorised events also hit). Terms with zero gain were rejected rather
> than added "for completeness", because a rule with no upside can only misfire.

## 12.8 Debug a bad proposal

*Skip if:* you are not on ingestion — this is the procedure when a proposal is wrong.

1. Find the proposal id in the Review tab.
2. `SELECT payload, evidence FROM event_proposal WHERE id = …;` — `evidence` records the attribution
   route (`via`), the deterministic type, the LLM type, whether they agreed, the rule version, and
   whether the sender was unverified.
3. Find the source email: `SELECT subject, body_text FROM ingested_email WHERE id = <ingested_email_id>;`
4. Reproduce it in isolation:

```js
const { runPipeline } = require('./services/eventIngestion');
console.log(JSON.stringify(runPipeline({
  from: 'x@iitr.ac.in', to: 'students-notices@iitr.ac.in',
  subject: '…', body_text: '…', internal_date: '2026-08-20T10:00:00Z',
}, { senderMap: {}, clubIndex: null }), null, 2));
```

> **Measure through `runPipeline` + `reviewProposals`, never through the regex path alone.** The
> production path is LLM-primary; auditing accuracy against the deterministic fallback measures
> something the app does not actually do.

## 12.9 Take a database backup

*Skip if:* you are not doing ops. Two commands.

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
```

In production, `deploy.sh` snapshots RDS automatically whenever a deploy brings a new migration. To
take one by hand:

```bash
aws rds create-db-snapshot --region ap-south-1 --profile campus \
  --db-instance-identifier campus-db --db-snapshot-identifier manual-$(date +%Y%m%d%H%M)
```

## 12.10 Roll back

*Read this one* — five artefacts, five different rollback paths. Know this before you need it.

| What | How |
|---|---|
| Backend code | check out the previous commit, run `./deploy.sh` |
| A migration | `npm run migrate:undo` — but check that the migration's `down()` is real. The baseline's is deliberately irreversible. |
| Data | restore the RDS snapshot taken before the deploy |
| Academic calendar | Admin → Academic Calendar → import history → **Rollback**. Built-in, no ops needed. |
| Frontend | rebuild from the previous commit and re-run `./scripts/deploy-frontend.sh` |

---

# Part 13 — Traps that will cost you an afternoon

**Level:** **Everyone, early** · **Time:** 10 min · **Skip if:** nothing. This is the highest value per minute in the book.

> **The short version**
> - *“My change isn't showing up”* is the service worker — on `localhost` too — or you changed `src/` and only ran `deploy.sh`.
> - The **`/app/` prefix** must agree in four places or deep links 404 on reload.
> - **`toISOString()` is wrong in IST** between midnight and 05:30 — it hands back yesterday.
> - **The two event allowlists**, the **1-hour clubs cache** and **`trust proxy` hop count** each produce a silent, confusing failure.
> - Also here: the Groq daily quota that degrades classification with no error anywhere, the stale root `.env.example`, the dead components, the two conflicting definitions of “super admin”, and why `uuid` must never be bumped past 11.x.

Ordered by how likely you are to hit them.

## 13.1 "My change isn't showing up"

*Read this one* — the single most common lost afternoon in this project.

Almost always the **service worker**, and it happens on `localhost` too. The worker serves a cached
bundle.

Fix: DevTools → Application → Service Workers → **Unregister**, then hard reload. Or use a private
window while iterating.

Second most likely: you changed `src/` and only ran `deploy.sh`. That script does not deploy the
frontend. Run `./scripts/deploy-frontend.sh`.

## 13.2 The `/app/` prefix

*Read this one* — four settings must agree; when they do not, only hard reloads break.

Four things must agree, or the app 404s on a hard reload of any deep link:

| Setting | Value | File |
|---|---|---|
| Vite `base` | `/app/` | `vite.config.js` |
| Router `basename` | `/app` | `src/App.jsx` |
| PWA `scope` / `start_url` | `/app/` | `vite.config.js` |
| `navigateFallback` | `/app/index.html` | `vite.config.js` |

Locally this means opening `http://127.0.0.1:5173/app/`, not the bare root.

## 13.3 Timezone

*Read this one* — applies to every date you will ever touch in this codebase.

Anything using `toISOString().slice(0,10)` to get "today" is **wrong in IST** between 00:00 and 05:30.
Use the `localDay()` / `istToday()` helpers. The database stores `TIMESTAMPTZ` for event times
(correct) and `DATEONLY` for deadlines and calendar dates (deliberately timezone-free — a deadline of
"15 August" is 15 August everywhere).

Naive `YYYY-MM-DDTHH:MM` input to the event API is interpreted as **IST**, for backward compatibility.

## 13.4 The two API allowlists

*Read this one* — has silently swallowed real, shipped columns.

Repeated because it has bitten more than once: a new column on `event` needs adding to
`standardFlatAttributes` **and** the `GET /:eventId` attribute array in `routes/event.js`, or the API
silently never returns it. `registration_link` was written by the publisher for months and no student
ever saw a registration link.

## 13.5 The clubs cache

*Skip if:* you never edit the database directly. If you ever do, this is the one.

`GET /clubs` is cached in the Node process for **one hour**. Change a club row directly in the
database and the app will not notice. Save any club through the admin panel to clear it, or restart
the backend.

## 13.6 `--force-recreate` on deploy

*Skip if:* you are not deploying.

Editing `temp_backend/.env` and running `docker compose up -d` without `--force-recreate` leaves the
old process running with the old values. Compose compares the image and the compose config, not the
contents of `env_file`.

## 13.7 `trust proxy`

*Skip if:* you are not touching infrastructure — the failure mode is genuinely interesting.

Wrong hop count ⇒ `req.ip` is a proxy address ⇒ the per-IP rate limiter becomes one global bucket.
2 behind CloudFront, 1 behind plain nginx.

## 13.8 Groq's daily quota

*Skip if:* you are not on ingestion. It degrades quality with no error anywhere.

~100,000 tokens **per day per account**. When exhausted, every call 429s → `null` → the regex fallback,
**silently**, for the rest of the day. Classification quality drops with no error anywhere. The key
pool in `review/groq.js` mitigates it; check `GET /ingestion/status` and the drift report if quality
suddenly falls off.

## 13.9 The stale root `.env.example`

*Read this one* — ten seconds, and it stops you configuring the wrong thing on day one.

It advertises `VITE_API_URL` pointing at a dead Render host and `VITE_IMGBB_API_KEY` for a service we
no longer use. Ignore it. `VITE_API_URL` is deliberately ignored in production builds; use
`VITE_PROXY_TARGET` if you need a different backend behind the dev proxy.

## 13.10 Dead code

*Read this one* — ten seconds. Four files that look live and are not.

`src/pages/Clubs.jsx`, `src/pages/Map.jsx`, `src/components/Layout/Navbar.jsx` and
`src/components/Widgets/TodoList.jsx` are imported by nothing. `Navbar` still links to `/map`, a route
that does not exist. Do not use them as a reference for current patterns.

## 13.11 `is_super_admin` has two definitions

*Skip if:* you are not touching auth — do not add a third.

`middlewares/permissions/superAdmin.js` reads the `user.is_super_admin` **column** — this is correct.
`routes/eventIngestion.js` defines a local `requireSuperAdmin` that checks the `manage_club_admins`
**permission** — this is a leftover. They usually agree in practice; do not add a third.

## 13.12 Notices used to be write-once

*Skip if:* you have not read the older docs (which say the opposite of the code).

Older documentation says notices cannot be edited or deleted. That is **out of date**: `PATCH` and
`DELETE /ingestion/notices/:id` exist, and the admin panel has a Notices tab
(`components/Admin/NoticeManager.jsx`). Club-scoped admins can edit their own club's notices; an
office notice (`club_id` NULL) is global-admin only.

## 13.13 Sequelize associations must be declared both ways

*Skip if:* you are not adding a model relationship.

Declaring only `belongsTo` and then trying to `include` in the other direction throws
*"X is not associated to Y!"* at runtime — as a 500, not a startup error. Four endpoints once returned
500 for exactly this.

## 13.14 Do not bump `uuid` past 11.x

*Read this one* — ten seconds, and it prevents a boot failure with an obscure message.

`temp_backend/package.json` pins it with an `overrides` block and a long comment. Sequelize 6 does
`require("uuid")`; uuid 12+ is ESM-only, so a higher version kills the backend at boot with
`ERR_REQUIRE_ESM`. 11.1.1 is the newest release that ships CommonJS *and* carries the
`GHSA-w5hq-g745-h8pq` fix.

## 13.15 Chrome-for-Testing quirks

*Skip if:* you are not driving the app with Playwright or CDP.

If you drive the app with Playwright or a CDP-attached Chrome:
- pass `--use-mock-keychain`, or a fresh profile pops a modal keychain dialog nobody can answer;
- `window.confirm()` is blocked, so admin **delete** buttons silently no-op — use real Chrome for
  those;
- the debug browser has no WebGL, so it cannot judge anything visual.

`scripts/chrome-debug.sh` sets this up. Playwright MCP **attaches** to a browser on port 9222; it
never launches one, so without that script every browser tool `ECONNREFUSE`s.

---

# Part 14 — Glossary

**Level:** Reference · **Time:** look up · **Skip if:** the words already mean something to you.

| Term | Meaning here |
|---|---|
| **Attribution** | working out which club an ingested email belongs to |
| **Backfill** | the first ingestion run, or a manual `?days=N` pull of older mail |
| **Broadcast list** | `students-notices@iitr.ac.in` and friends. Being addressed to one is the privacy gate. |
| **Channel-i** | IIT Roorkee's student portal — our OAuth identity provider |
| **Club admin** | a student coordinator with rights over one club, via the `club_admin` table |
| **CORS** | Cross-Origin Resource Sharing — the browser rules for cross-site requests |
| **CSRF** | Cross-Site Request Forgery — another site making your browser act as you. Blocked three ways here. |
| **DATEONLY** | a Sequelize type stored as a bare `'YYYY-MM-DD'` with no timezone conversion |
| **Deadline vs event_date** | on a notice: apply-by vs when-it-happens. Different columns, different meanings. |
| **De-thread** | separating the top message from quoted/forwarded content |
| **Drift** | the divergence between what the classifier proposed and what humans approved |
| **Gate** | a check in the ingestion pipeline that can drop an email before its body is stored |
| **IDOR** | Insecure Direct Object Reference — passing an id you should not be allowed to touch |
| **Ingestion** | the whole email → proposal pipeline |
| **JWT** | JSON Web Token — the signed session token in the `auth_token` cookie |
| **Lifecycle mutation** | a follow-up email that changes an existing item (cancel, reschedule, extend) |
| **Middleware** | an Express function that runs before a handler and may stop the chain |
| **Migration** | a versioned schema change file in `temp_backend/migrations/` |
| **Monotonic merge** | an LLM value may only *fill a gap*, never overwrite a deterministic one |
| **Notice** | something you do not attend — an announcement, a deadline, an opportunity |
| **Opportunity** | a notice with an apply-by deadline |
| **ORM** | Object-Relational Mapper — Sequelize |
| **Proposal** | a typed change suggestion from the pipeline, awaiting human approval |
| **PWA** | Progressive Web App — installable, offline-capable web app |
| **Relay sender** | an address that forwards for many clubs (`gensec.cult@`). Never identifies a club. |
| **Review scope** | which proposals and notices an admin may act on |
| **Service worker** | a background browser script that caches assets. Cause of many "why isn't my change showing" moments. |
| **SPA** | Single-Page Application |
| **Super admin** | `user.is_super_admin = true`. The only tier that may grant rights. |
| **SWR** | "stale-while-revalidate" — the React data-fetching library used throughout the frontend |
| **`token_version`** | the per-user counter that makes logout actually revoke sessions |
| **`venue_mode`** | `online` / `physical` / `tba` / null — four distinct states that must not collapse |

---

# Appendix A — Cheat sheet

**Level:** Reference · **Time:** keep it open · **Skip if:** nothing — this page is why the appendix exists.

## Commands

```bash
# ── run it ──────────────────────────────────────────────────────────────────
cd temp_backend && npm run dev          # API on :8081 (node --watch)
npm run dev                             # SPA on :5173  → open /app/
docker compose up --build               # both, plus autoheal

# ── log in locally ──────────────────────────────────────────────────────────
open http://127.0.0.1:8081/oauth/dev-login      # needs DEV_LOGIN=true

# ── tests (plain node scripts — there is no runner) ─────────────────────────
cd temp_backend
node services/eventIngestion/__tests__/pipeline.test.js
node services/eventIngestion/source/__tests__/gmail.test.js
node services/academicCalendar/__tests__/parser.test.js
node ../src/utils/notice.test.mjs && node ../src/utils/updateDraft.test.mjs

# ── database ────────────────────────────────────────────────────────────────
cd temp_backend
npx sequelize-cli migration:generate --name my-change
npm run migrate            # apply
npm run migrate:status     # what is applied
npm run migrate:undo       # roll one back
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql

# ── deploy ──────────────────────────────────────────────────────────────────
./deploy.sh                              # ON the EC2 — backend only
./scripts/deploy-frontend.sh             # LOCALLY  — build, verify, S3, invalidate
./scripts/deploy-frontend.sh --check-only
./scripts/smoke-test.sh                  # read-only, safe against production

# ── docs ────────────────────────────────────────────────────────────────────
./scripts/build-handbook.sh              # regenerate this book's PDF
```

## Ports and URLs

| | Local | Production |
|---|---|---|
| SPA | `http://127.0.0.1:5173/app/` | `https://campus-dashboard.iitr.ac.in/app/` |
| API | `http://127.0.0.1:8081` (proxied as `/api`) | `…/api` |
| Landing page | — | `https://campus-dashboard.iitr.ac.in/` |
| Health | `http://127.0.0.1:8081/health` | `…/api/health` |

## The files you will open most

| Purpose | Path |
|---|---|
| Server entry, middleware stack, route mounts | `temp_backend/app.js` |
| An HTTP endpoint | `temp_backend/routes/<prefix>.js` |
| A table | `temp_backend/database/schemas/<model>.js` |
| **All** table relationships | `temp_backend/database/schemas/index.js` |
| A schema change | a new file in `temp_backend/migrations/` |
| A permission gate | `temp_backend/middlewares/permissions/` |
| Request validation helpers | `temp_backend/middlewares/validate.js` |
| Permission name→id resolution | `temp_backend/utils/permissions.js` |
| Ingestion rules (all IITR knowledge) | `temp_backend/services/eventIngestion/institutions/iitr.config.js` |
| The pure ingestion pipeline | `temp_backend/services/eventIngestion/index.js` |
| Route table + providers | `src/App.jsx` |
| The session | `src/context/AuthContext.jsx` |
| Axios instance + interceptors | `src/services/api.js` |
| The feed | `src/pages/Home.jsx` |
| The card, and `locationLabel()` | `src/components/Event/EventCard.jsx` |
| The admin panel | `src/pages/Admin.jsx` |

## Environment variables that actually matter

| Var | Why |
|---|---|
| `DATABASE_URL` | required |
| `JWT_SECRET` | required; **production refuses to boot without it** |
| `DEV_LOGIN` | local login backdoor; **production refuses to boot with it** |
| `redirectURL` | in production must end `/api/oauth/token/` — the `/api` matters |
| `TRUST_PROXY_HOPS` | **2** behind CloudFront, **1** behind plain nginx |
| `ALLOW_VERCEL_PREVIEWS` | set `false` in production |
| `POSTER_S3_BUCKET` | unset in production makes uploads **throw**, by design |
| `SESSION_TTL_HOURS` | JWT lifetime; default 720 (30 days) |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | optional; without them the pipeline is 100% deterministic |
| `RESET_DB` | **hard-disabled in production** regardless of value |

## Vocabulary you need on day one

| | |
|---|---|
| **Proposal** | a machine-extracted change awaiting human approval (`event_proposal`) |
| **Notice** | something you do not attend — an announcement, a deadline |
| **Opportunity** | a notice with an apply-by deadline |
| **Attribution** | working out which club an email came from |
| **Gate** | an ingestion check that can drop a mail before its body is stored |
| **Review scope** | which proposals and notices a given admin may act on |
| **Relay sender** | an address that forwards for many clubs; never identifies one |

---

# Appendix B — "I need to…" index

**Level:** Reference · **Time:** look up · **Skip if:** you know where you are going.

Find your task; go to the section; open the files.

| I need to… | Read | Touch |
|---|---|---|
| **get it running** | [Part 2](#part-2--running-it-on-your-laptop) | `temp_backend/.env` |
| **understand the whole system fast** | [The fast path](#the-fast-path--thirty-minutes-to-your-first-change), then [Part 4](#part-4--system-design-the-life-of-a-request) | — |
| **add a field to an event** | [§12.1](#121-add-a-column-to-an-existing-table), [§13.4](#134-the-two-api-allowlists) | migration, `schemas/event.js`, `routes/event.js` (**two** allowlists + handlers), `src/services/events.js` |
| **add a new API endpoint** | [§12.2](#122-add-an-api-endpoint) | `routes/`, `app.js`, `src/services/` |
| **add a screen** | [§12.3](#123-add-a-page) | `src/pages/`, `src/App.jsx`, maybe `BottomNav.jsx` |
| **add an admin tab** | [§12.4](#124-add-an-admin-panel-tab) | `src/components/Admin/`, `src/pages/Admin.jsx` |
| **add or change a permission** | [§12.5](#125-add-an-admin-permission), [Part 6](#part-6--who-is-allowed-to-do-what) | migration, `utils/permissions.js`, `middlewares/permissions/`, `src/services/auth.js` |
| **add an event category** | [§12.6](#126-add-an-event-category) | seed, `iitr.config.js` (**twice**), `review/groq.js` |
| **fix an email being classified wrong** | [§12.7](#127-change-how-an-email-is-classified) | prefer an override rule in the UI; else `iitr.config.js` |
| **work out why a proposal is wrong** | [§12.8](#128-debug-a-bad-proposal) | `event_proposal.evidence`, then `runPipeline()` in isolation |
| **change the feed's sorting or filtering** | [§10.1](#101-the-events-feed), [§9.5](#95-the-pages) | `src/pages/Home.jsx` |
| **change how a card looks** | [§9.6](#96-components) | `src/components/Event/EventCard.jsx` + `.css` |
| **change notice ordering or expiry** | [§10.2](#102-the-notices-tab), [§8.4](#84-utils) | `temp_backend/utils/noticeOrder.js` (pure, testable) |
| **touch reminders or notifications** | [§10.5](#105-reminders-and-notifications) | `src/services/eventReminders.js`, `routes/reminder.js` |
| **change the academic-calendar parser** | [§10.3](#103-the-academic-calendar), [§8.6](#86-servicesacademiccalendar) | `services/academicCalendar/`, then run the snapshot test |
| **understand who can do what** | [Part 6](#part-6--who-is-allowed-to-do-what) | `middlewares/permissions/` |
| **deploy the backend** | [§11.2](#112-deploying-the-backend) | `./deploy.sh` on the EC2 |
| **deploy a frontend change** | [§11.3](#113-deploying-the-frontend) | `./scripts/deploy-frontend.sh` locally |
| **check a deploy actually worked** | [§11.4](#114-verifying-a-deploy) | `./scripts/smoke-test.sh` |
| **roll something back** | [§12.10](#1210-roll-back) | depends on the artefact |
| **debug a 500 in production** | [§11.7](#117-logs-and-debugging-in-production) | the `errorId` from the response, then the logs |
| **work out why my change isn't visible** | [§13.1](#131-my-change-isnt-showing-up) | the service worker, or the frontend deploy you skipped |
| **take a backup** | [§12.9](#129-take-a-database-backup) | `pg_dump`, or an RDS snapshot |

---

# Appendix C — Endpoint index

**Level:** Reference · **Time:** look up · **Skip if:** you want the request/response shapes instead — those are in [Part 7](#part-7--the-complete-api-reference).

Every endpoint in the app, grouped by prefix. Base URL is **`/api`**.
Auth key: `—` none · `user` any session · a permission name · `super` = `is_super_admin` ·
`review scope` = the caller's scope must cover the target.


**`/academic-calendar`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/academic-calendar` | — | current semester's calendar entries + teaching-day totals |
| GET | `/academic-calendar/:id` | — | one calendar entry |
| GET | `/academic-calendar/current` | manage_admins | the published calendar in editable form |
| POST | `/academic-calendar/import/:id/rollback` | manage_admins | restore a previous import from its snapshot |
| POST | `/academic-calendar/import/commit` | manage_admins | publish the reviewed entries |
| POST | `/academic-calendar/import/preview` | manage_admins | parse an uploaded PDF; writes nothing |
| GET | `/academic-calendar/imports` | manage_admins | import history, for the rollback UI |
| GET | `/academic-calendar/semesters` | — | the semester picker list |

**`/admin-permissions`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin-permissions/:permissionId` | manage_admins | one permission definition |
| PATCH | `/admin-permissions/:permissionId` | super | rename a permission |
| DELETE | `/admin-permissions/:permissionId` | super | delete it — **cascades**, stripping it from every holder |
| GET | `/admin-permissions/all` | manage_admins | the six permission definitions |

**`/admins`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admins/:userId` | manage_admins | one admin |
| PATCH | `/admins/:userId` | super | replace permissions; optionally set `is_super_admin` |
| DELETE | `/admins/:userId` | super | strip all permissions from a user |
| POST | `/admins/add` | super | grant admin, by `user_id` or `enrolment_number` |
| GET | `/admins/all` | manage_admins | every institute admin and their permissions |

**`/club-admins`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/club-admins/club/:clubId` | manage_club_admins / club admin | who admins this club |
| GET | `/club-admins/club/:clubId/:userId` | manage_club_admins / club admin | one club-admin record |
| DELETE | `/club-admins/club/:clubId/:userId` | super | remove a coordinator |
| POST | `/club-admins/club/:clubId/add` | super | make a student a coordinator of this club |

**`/clubs`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/clubs` | user | all clubs — **cached in-process for 1 hour** |
| GET | `/clubs/:id` | user | one club |
| POST | `/clubs/create` | manage_clubs | create a club; invalidates the cache |
| DELETE | `/clubs/delete/:id` | manage_clubs | delete a club — **cascades to its events** |
| PATCH | `/clubs/update/:id` | manage_clubs / that club's admin | edit a club; invalidates the cache |

**`/event-categories`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/event-categories/:categoryId` | user | one category |
| PATCH | `/event-categories/:categoryId` | event_category_crud / club admin | rename |
| DELETE | `/event-categories/:categoryId` | event_category_crud / club admin | delete |
| POST | `/event-categories/add` | event_category_crud / club admin | create — but see §12.6 first |
| GET | `/event-categories/all` | user | the six categories |

**`/events`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/events/:eventId` | user | one event, with club, location and categories |
| PATCH | `/events/:eventId` | event_crud / that club's admin | partial update; `''` clears a field |
| DELETE | `/events/:eventId` | event_crud / that club's admin | delete an event |
| POST | `/events/add` | event_crud / club admin | create an event |
| GET | `/events/admin/all` | user | admin listing, scoped to the caller's clubs |
| GET | `/events/all` | user | **the feed.** `?page&limit&from&to`. Cached 30 s |
| GET | `/events/categories/not-preferred` | user | the inverse |
| GET | `/events/categories/preferred` | user | events in your preferred categories |
| GET | `/events/clubs/not-preferred` | user | events from clubs you hid |
| GET | `/events/clubs/preferred` | user | events from clubs you follow |
| GET | `/events/count` | user | total event count |
| GET | `/events/date/:date` | user | events on one IST day (`YYYY-MM-DD`) |
| GET | `/events/venue/:venue_id` | user | upcoming events at a curated location |

**`/ingestion`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/ingestion/dev-seed` | super | seed sample proposals for UI work |
| GET | `/ingestion/drift` | super | proposed-vs-approved agreement statistics |
| GET | `/ingestion/notices` | user | **the notices tab**, sorted important → soonest → expired last |
| GET | `/ingestion/notices/:id` | user | one notice |
| PATCH | `/ingestion/notices/:id` | review scope | correct a live notice |
| DELETE | `/ingestion/notices/:id` | review scope | remove a live notice |
| GET | `/ingestion/overrides` | reviewer | list classification override rules |
| POST | `/ingestion/overrides` | super | create a classification rule |
| DELETE | `/ingestion/overrides/:id` | super | delete a rule |
| GET | `/ingestion/overrides/preview` | super | blast-radius check before saving a rule |
| GET | `/ingestion/proposals` | review scope | **the review queue** (`state='proposed'`) |
| GET | `/ingestion/proposals/:id/calendar-candidates` | review scope | calendar entries an amend might target |
| POST | `/ingestion/proposals/:id/dismiss` | review scope | reject a proposal |
| GET | `/ingestion/proposals/:id/event-candidates` | review scope | live events a PATCH/CANCEL might target |
| GET | `/ingestion/proposals/:id/notice-candidates` | review scope | live notices a deadline extension might target |
| POST | `/ingestion/proposals/:id/publish` | review scope | publish, with the reviewer's edits merged in |
| POST | `/ingestion/run` | global admin | pull mail now. `?days` clamped to 365 |
| GET | `/ingestion/status` | user | is Gmail wired, auth status, last-sync heartbeat |
| POST | `/ingestion/verify` | global admin | prove the Gmail credentials still work |

**`/locations`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/locations/:locationId` | user | one venue |
| PATCH | `/locations/:locationId` | location_crud / club admin | edit a venue |
| DELETE | `/locations/:locationId` | location_crud / club admin | delete a venue |
| POST | `/locations/add` | location_crud / club admin | create a venue |
| GET | `/locations/all` | user | all curated venues |

**`/oauth`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/oauth/dev-login` | — (dev only) | **not registered in production.** Log in as a local admin |
| GET | `/oauth/login` | — | mint `state`, redirect to Channel-i |
| POST | `/oauth/logout` | user | bump `token_version` (revokes every token) and clear the cookie |
| GET | `/oauth/token` | — | OAuth callback: upsert the user, set `auth_token`, redirect in |
| GET | `/oauth/user` | user | profile + `authContext` — drives the whole frontend permission model |

**`/reminders`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/reminders` | user | your reminders, grouped by event |
| DELETE | `/reminders` | user | bulk delete by `eventIds` |
| PUT | `/reminders/:eventId` | user | replace the offsets for one event |
| DELETE | `/reminders/:eventId` | user | drop all reminders for an event |

**`/todos`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/todos` | user | your to-dos, newest first |
| POST | `/todos` | user | create a to-do |
| PATCH | `/todos/:id` | user | update one of your to-dos |
| DELETE | `/todos/:id` | user | delete one of your to-dos |

**`/upload`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/upload/logo` | upload perm / club admin | **multipart**, field `image`. 5 MB, →512 px webp |
| POST | `/upload/poster` | upload perm / club admin | **multipart**, field `image`. 20 MB, →1600 px webp |

**`/user`**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PATCH | `/user/preferences` | user | replace all four preference sets; re-issues the JWT |

---

## Where to go next

| You want to… | Read |
|---|---|
| know what to build next | `docs/FEATURE_ROADMAP.md` |
| understand ingestion in more depth | `docs/EVENT_INGESTION_ARCHITECTURE.md` |
| debug something weird | `docs/DEBUGGING.md` — organised by symptom |
| deploy to a fresh AWS account | `docs/DEPLOY_RUNBOOK.md` |
| understand the data model formally | `docs/DATABASE_DOCUMENTATION.md` |
| know the security posture | `docs/SECURITY_AUDIT_REPORT.md`, `SECURITY_AUDIT_FULL.md` |
| see how the app performs under load | `docs/STRESS_TEST.md` |
| understand launch readiness | `docs/LAUNCH_CHECKLIST.md` |

### The four rules of this codebase

1. **Deterministic first, AI second.** Every AI call is optional, guarded, and fails safe to a
   deterministic answer. An LLM may never overwrite something the rules read correctly.
2. **A human publishes.** Nothing the machine extracts reaches students without someone approving it.
3. **Fail closed, fail loud.** A misconfiguration should refuse to start, not run insecurely. A broken
   upload should 500, not silently write a dead URL.
4. **Write down why.** The comments in this codebase are unusually long because most of them record a
   real failure and the measurement that settled it. Keep doing that — it is the reason you were able
   to read this document instead of rediscovering all of it.

---

*Written against the codebase as of 2026-08-26. If something here contradicts the code, the code is
right — please fix this document.*
