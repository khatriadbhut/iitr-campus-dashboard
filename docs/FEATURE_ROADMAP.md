# 🗺️ IITR Campus Dashboard — Feature Roadmap & Discussion Doc

**Purpose:** This is the single "what to build next" document. If you're maintaining or contributing to this app and don't know what to pick up, start here. Each feature below has: the problem, the goal, what's decided, what still needs discussion, robustness requirements, and acceptance criteria.

**How to use it:**
- Features are ordered by priority. Pick the highest-priority one marked `🟢 Ready to build`.
- Anything marked `🟡 Needs discussion` has open questions listed — resolve those first (with whoever owns product direction), then it becomes ready.
- Update the **Status** and **Decision log** of a feature as you make progress, so the next person inherits your context.

**Status legend:** 🟢 Ready to build · 🟡 Needs discussion · 🔵 Vision / future · ✅ Done

---

## 📌 Context you need first

**What the app is:** a campus-life app for IIT Roorkee — unified event feed, RSVPs, reminders, campus map, academic calendar, per-club admin. React 19 + Vite frontend (`/src`, Vercel), Node/Express 5 + PostgreSQL/Sequelize backend (`/temp_backend`, Render), auth via IITR Channel-i OAuth.

**Reality check — the "aggregation" is not built.** The marketing says the app "unifies scattered updates from Slack/WhatsApp/email." Today that is **not true**: events exist only because a club admin manually types them in (`POST /event/add`). The academic calendar is a hardcoded static file. This roadmap is largely about *actually building* that ingestion vision.

**The product ambition:** make this adaptable to *any* campus so it can be pitched as a product, not just an IITR tool. Several features below are designed with that in mind (multi-tenancy, pluggable extraction, per-institution config).

---

## 🧭 The shared architectural spine (read before any ingestion feature)

Almost every ingestion feature (#1 academic calendar, #2 events) shares ONE engine. Build it once; reuse it.

```
unstructured input (PDF / email / Slack msg / pasted text)
      │
      ▼
 [ ExtractionStrategy ]  ← deterministic parser OR LLM, swappable per source/institution
      │  normalized rows + confidence + flags
      ▼
 [ Validation + Sanity gate ]  ← schema check, anchors, plausibility; fail LOUD
      │
      ▼
 [ Review / tentative handling ]  ← weird rows flagged, never guessed
      │
      ▼
 [ Atomic upsert-by-key ]  ← transactional replace, versioned, audited
      │
      ▼
 your existing Postgres tables → feed / calendar
```

**Cross-cutting principles (apply to every feature):**
- **Deterministic-first, LLM-as-backstop.** Prefer free rule-based parsing. An LLM only fills fields the deterministic pass left `null`, behind whitelist validation. It must be *structurally incapable* of overriding good data. See #1 for the enforced pattern.
- **No paid LLM dependency.** Decision: we do **not** use the Claude API here (budget reserved for another project). Any LLM assist uses **Groq free tier**, behind a pluggable `LLM_PROVIDER` env var, so it can be swapped/removed without a rewrite.
- **Fail loud, never fail into data.** On any ambiguity or breakage, flag for review or abort the import — never write a wrong/silent value.
- **Tenant-aware from day one.** Even where we build IITR-only, tag data with `campus`/`program` and route config through an abstraction, so multi-campus is additive later, not a rewrite.

---

## Feature #1 — Academic Calendar PDF Parser  ✅ Done (v1 shipped)

**Status:** Built and **verified end-to-end** — parser smoke test 8/8, DB integration, and full browser UI. Committed on branch `feat/academic-calendar-parser`. Gated to **super admins** (`manage_admins`). Rides on the existing Channel-i session (no changes to the login flow). Two optional nice-to-haves remain — see "Future enhancements" at the end of this section.

### In plain words
Today, the app's academic calendar (exam dates, holidays, fests, deadlines) lives in a **hand-typed code file** that someone on the team re-writes from the official IITR PDF every single semester. This feature replaces that chore with a simple flow: **an admin uploads the official PDF, the app reads it automatically, shows a preview of how it will look, and the admin clicks "Publish."** No code editing, ever. It's built to be reliable enough that a junior who inherits the project years later can run it with zero training — just upload, glance, publish.

### The problem it solves
- The calendar is a 406-line file (`temp_backend/data/academicCalendar.js`) re-typed by a developer twice a year. Tedious, error-prone, and it dies the moment no one on the team wants to do it.
- It should be **operable by a non-developer** and **survive team turnover**.

### What it does, step by step
1. **Admin uploads** the official academic-calendar PDF in the admin panel.
2. The app **figures out what kind of document it is** (see "Three-way check" below).
3. If it's the supported calendar, it **reads (parses) all the events** — titles, dates, holidays, exams, fests.
4. It shows a **preview that looks exactly like the real in-app calendar**, filled with the new events, so the admin sees what students will see.
5. The admin **reviews, fixes anything uncertain, and clicks Publish.**
6. The new calendar **goes live** for students. The old one is safely archived so it can be restored with one click if needed.

### Scope — what's included now
- **In:** the **IITR general (non-MBA / undergraduate) calendar** — this covers essentially the entire user base. Both pages of the PDF are read: the main event table and the holidays / time-table-change sections.
- **Not built now (but handled gracefully):** the **MBA calendar** and **other colleges' calendars**. If someone uploads one of these, the app *recognizes* it and shows a friendly **"support for this calendar is coming soon"** message — it doesn't break or mis-import.

### The admin experience (the heart of the feature)
When a PDF is uploaded, a **preview window** opens. Key points:

- **The preview is the app's actual calendar**, using the same look and theme students see — not a boring text list. The admin flips through the semester's months and sees the real thing.
- **A summary line at the top:** e.g. *"Autumn 2026-27 · 35 events · 2 need attention."*
- **Anything uncertain is clearly marked** — both on the calendar dates themselves and in a short "needs attention" side-list you can click to jump to.
- **Colour-coded flags on the calendar:**
  - 🟡 **Tentative / TBD** — a date the official PDF left vague (e.g. *"Convocation — first week of September"*). Marked, not guessed.
  - *(Planned — see Future enhancements)* 🟢 **Added** / 🔴 **Removed** / 🟠 **Moved** highlighting on revisions, to show *what changed* at a glance. Not in v1.
- **Click any event to edit it inline** — e.g. type the real Convocation date before publishing. Fixes take seconds.
- **Buttons:** *Cancel* (nothing is saved) or *Publish* (goes live).
- **Revert button:** the admin panel keeps a history of past uploads with a one-click **"Revert to previous version."**

### The three-way check (what kind of PDF is this?)
Before anything is imported, the app classifies the upload into exactly one of three outcomes:

| What was uploaded | What happens | Message |
|---|---|---|
| **General (non-MBA) IITR calendar** | Parsed → preview → publish | — |
| **A calendar it recognizes but can't handle yet** (MBA, another college) | Politely stopped | *"Support for this calendar is coming soon…"* |
| **Not a calendar at all** (a marksheet, random file, or a scan with no readable text) | Rejected | *"Unrecognized document. No changes have been made."* |

This check is **primarily automatic and rule-based** (fast, free, always works). A free AI (Groq) is used **only as a tie-breaker** when the automatic check is unsure (e.g. IITR changed the wording of the header) — and if that AI is unavailable, it safely defaults to "please verify" rather than guessing.

### How it reads the PDF (reliably)
- It extracts the **text layer** of the PDF directly (no image scanning / OCR needed for these files).
- It cleans up the text (PDFs split dates into fragments like `0 8 .01.2026`) and reconstructs each row using the calendar's numbered list (1, 2, 3…) as a guide. This was **validated on the real PDFs — every row and every date came out correct.**
- It figures out each event's **category** (Exam, Holiday, Fest, Timetable Change, or general Academic) from the wording, since the PDF has no category column.
- The **~1-2 genuinely ambiguous rows per calendar** (vague dates, "date A OR date B", split ranges) are **flagged as tentative and shown to the admin — never silently guessed.**

### Why it's trustworthy (robustness, in plain terms)
- **Nothing goes live until the admin clicks Publish.** Reading and previewing never touch the live data.
- **Publishing is all-or-nothing.** If anything fails mid-way, the whole update is undone and the old calendar stays intact — you can never end up with a half-broken calendar.
- **A bad or wrong PDF can't overwrite a good calendar** — the MBA/other/unrecognized checks and the "publish is all-or-nothing" rule protect it.
- **Warnings, not false rejections.** If something is odd-but-possibly-fine (e.g. an unusually high event count), the app *warns* in the preview and lets the admin decide — it doesn't wrongly reject a valid calendar.
- **Every upload is versioned**, so a mistake is one click to undo, and there's an audit trail of who uploaded what and when.
- **A built-in self-test** ("smoke test") runs the parser against the 5 sample calendars and checks the results are still correct. If a future developer accidentally breaks the parser, this test catches it immediately — the safety net that makes future changes safe.

### Where AI (Groq) fits — and where it doesn't
The core parser is **plain, deterministic code** (free, exact, reproducible) and is the source of truth. A **free Groq AI is an optional assistant**, sandboxed so it can *never* damage the reliable path. It only helps in four spots: (a) the classifier tie-break above, (b) suggesting a value for a flagged tentative row, (c) classifying an unfamiliar event category, (d) raising "this looks off" warnings in the preview. Every AI suggestion is validated and shown to the admin for approval; if the AI is down, everything still works. **No paid AI (no Claude API) is used.**

### It keeps the exact current data format
The events are stored and served in the **identical shape** the app already uses — `{ id, title, category, startDate, endDate, description, isHoliday }`. So the existing calendar screen, home feed, and reminders need **no changes**. (Behind the scenes, each record also carries a few internal fields for versioning/tentative-marking, which are hidden from the public feed.)

### History & future viewing
One calendar is "current" and shown by default, but **past and upcoming semesters are kept and viewable in-app** — so instead of hunting for an old PDF, students can just look them up.

### Built to extend to other colleges later
The reading logic sits behind **one clean "swap point"** in the code. When the team later wants to support the MBA calendar or another college, a new developer knows exactly where to plug in — **without rewriting the existing system.** (The heavier "any college" framework is intentionally deferred until a second calendar actually exists.)

### Acceptance criteria (all met ✅)
- [x] Uploading each of the 5 non-MBA sample PDFs produces correct events, correct dates, with the known tentative rows flagged (not dropped).
- [x] Re-uploading a semester (or its "Revised" version) cleanly replaces it — **no duplicates**.
- [x] Uploading an MBA PDF → "coming soon"; a random/scanned file → "unrecognized"; a broken PDF → clear error. In every case the live calendar is untouched.
- [x] The student calendar, home feed, and reminders look and work exactly as before.
- [x] The admin can **edit / add / delete** rows in the preview, publish, and revert to a previous version.
- [x] The self-test passes on all sample PDFs; no paid AI is required for the app to work.

### Decision log (key choices made)
- **Deterministic parser, no OCR, no paid AI** — validated on 5 non-MBA + 2 MBA real PDFs.
- **Always preview-then-confirm** (never silent auto-publish); the preview is the real app calendar.
- **Three-way detection** with a friendly "coming soon" for MBA/other calendars.
- **Guards warn, not over-block**; hard-stop only when no preview can be produced.
- **Groq is a sandboxed, optional assistant** (4 narrow spots), never on the critical path.
- **Program is part of the storage identity** so an MBA upload can never overwrite the general calendar.
- **History kept + versioned rollback** (per-semester retention: keep 5 recent, each semester's final kept forever); **self-test suite** is a required deliverable.
- **Super admins only** (`manage_admins`) can manage the calendar — regular admins & club admins are excluded.
- **Multi-range events** (e.g. Orientation on two weekends) are split into separate entries; entry ids are scoped by semester+program so semesters never collide.

### What shipped in v1 (implemented characteristics)
- Deterministic `pdfjs-dist` parser + glyph normalization + sequential-row anchoring; page-2 holidays & time-table reschedules; category inference; tentative flagging of the ~1-2 genuinely ambiguous rows.
- Three-way document classifier (general / coming-soon / unrecognized) — deterministic-first, Groq only as an unsure-case tie-breaker.
- **Full-screen preview modal** reusing the app calendar: **Calendar/List toggle** (month grid on desktop, agenda list on mobile), day-cell tints matching the live calendar (holidays/weekends green, exams red; working Saturdays respected), **inline edit / add event / delete event**, soft-warnings banner, "needs attention" list, one-click revert.
- Atomic upsert-by-{semester, program}; versioned imports with rollback + per-semester retention; served in the **exact legacy shape** (no frontend changes to the student calendar).
- Super-admin permission gate; optional sandboxed Groq assist (off by default, `LLM_PROVIDER=groq`); idempotent seed migration from the legacy file; **snapshot smoke test** (`npm test`, 8/8); dev-only `/oauth/dev-login` for local testing.
- Also polished the student Calendar page: selected day = border (not a black fill), today = purple circle.
- **Edit the live calendar in-place** — an **"Edit current"** button loads the currently-published calendar (including any undated/TBD rows the public feed hides) into the same editor, so an admin can fix a date, add/remove an event, or correct a typo **without re-uploading a PDF**. Publishes as a new version, fully rollback-able. Backed by `GET /academic-calendar/current` (admin-only).

### Future enhancements (nice-to-have, not blocking — deferred by choice)
1. **Diff view on re-upload** — when re-uploading a *revised* calendar for an already-published semester, highlight 🟢 added / 🔴 removed / 🟠 moved (old→new) vs the currently-live version, plus a one-line summary ("3 changes: Mid-Term moved Sep 10 → 12, …"). Lets an admin review a revision at a glance instead of re-reading ~50 rows. Frontend-only: fetch the live semester (`GET /academic-calendar?semester=`) + compare against the parsed entries; no backend change. Does nothing for brand-new semesters (nothing to diff).

---

## Feature #2 — Event Ingestion Layer  🟡 Needs discussion

**Status:** Vision agreed; source strategy and publish model need locking.

### Problem
Events only enter via manual admin typing. The core product promise (unify Slack/WhatsApp/email chatter into one feed) is unbuilt.

### Goal
Let event info flow in from where clubs already announce it, converted into structured draft events, with minimal human effort and no garbage reaching students.

### Approach (reuses the shared spine)
Every source is a thin **adapter** feeding the same `ExtractionStrategy → validate → review → upsert` pipeline. Sources ranked by feasibility:
- **Paste + parse** (admin pastes a raw WhatsApp/Slack/email blob → parsed to a draft event): zero auth/ToS pain, works for every source, best MVP.
- **Email (primary):** a dedicated inbox (e.g. `events@…`) clubs forward/CC to; IMAP poller → parse → draft. Clean protocol, no ToS gray zone.
- **Slack:** official bot API reads designated channels. Clean but only covers Slack-using clubs. Add after email.
- **WhatsApp (deferred / risky):** no clean official API; unofficial libs (whatsapp-web.js) are ToS-gray and fragile on a server. Cover its value via **paste** instead of a live integration.

### ⚠️ LLM cost note
Unlike the calendar (parsed ~2×/year), email/chat ingestion is **high volume** — this is where a free tier's rate limits actually bite, and where deterministic parsing is hardest (messages are unstructured prose). Expect the `ExtractionStrategy` here to lean on an LLM (Groq free, behind the pluggable provider). Budgeting/rate-limit handling is a real design point.

### Things we still need to discuss / decide
1. **Which sources for v1?** (Recommendation: paste + email first; Slack next; WhatsApp = paste-only.)
2. **Publish model:** review queue (admin approves drafts) vs auto-publish. Strongly lean **review queue** — it doubles as quality control and abuse prevention.
3. **Extraction for prose:** deterministic is weak on freeform messages → how much do we lean on Groq, and what's the rate-limit/fallback plan?
4. **Dedup across sources** — the same event posted to Slack *and* email shouldn't create two events. Keying strategy?
5. **Trust/spam** — who's allowed to feed the pipeline (only club-linked sources)? Ties into Feature #3.
6. **Mapping to the `events` schema** — required fields (name, time, location, club, category); how to handle partial info (message with no venue)?

### Acceptance criteria (draft)
- [ ] Paste a real WhatsApp announcement → a correctly structured draft event appears in a review queue.
- [ ] Approving a draft creates a normal event indistinguishable from a manually-entered one.
- [ ] Duplicate announcements don't create duplicate events.
- [ ] Nothing auto-publishes to students without passing the chosen gate.

---

## Feature #3 — Per-Club Workspaces & Publish Gate  🟡 Needs discussion

**Status:** Strong structural idea; merges with #2. Needs data-model discussion.

### Problem
Clubs have no self-serve space to manage themselves; and there's no natural, quality-gated path from "club's internal chatter" to "public campus feed."

### Goal
Each club gets a **workspace**: its own members, internal todos, its own configured ingestion source(s) (email alias / Slack channel / paste box), and a **draft queue**. Ingested items land in *that club's* queue; a club admin promotes only the public-worthy ones to the campus feed via a **"publish to public" gate.**

### Why this matters
It turns ingestion from a global firehose into **per-club, self-served, quality-gated** flow — owned by the people who own the info. It's the natural *home* for Feature #2, and it nests cleanly under campuses (Feature #4). Existing pieces to build on: clubs, club-admins, permissions, and todos already exist as DB tables/routes.

### Things we still need to discuss / decide
1. **Workspace scope** — what exactly lives in a club workspace (members, drafts, todos, source config, analytics)?
2. **Roles** — reuse the existing `admin_permission` system, or add workspace-scoped roles?
3. **Draft → public promotion UX** — one-click publish? edit-before-publish? multi-approver?
4. **Per-club source config** — how a club registers its email alias / Slack channel (verification to prevent spoofing?).
5. **Visibility** — are draft/internal items ever visible to members vs only admins?
6. Relationship to the existing global Admin dashboard — does this replace or complement it?

### Acceptance criteria (draft)
- [ ] A club admin can configure their club's ingestion source and see a private draft queue.
- [ ] Promoting a draft publishes it to the public feed, attributed to the club.
- [ ] Internal club data (drafts, todos) is not publicly visible.

---

## Feature #4 — Multi-Campus / Multi-Tenancy  🔵 Vision / future (seed now)

**Status:** The big product-enabler. Don't build the full rewrite now, but seed it while building #1–#3.

### Problem / Goal
"Adaptable to any campus" = every core entity (events, clubs, locations, academic calendar, users) is scoped to a **campus/tenant**, and campus-specific config (SSO, calendar source, branding, taxonomy) is **data, not code**.

### Two hard truths
1. **Auth is campus-specific.** Channel-i OAuth is IITR-only. Other campuses use Google Workspace / their own portal / email OTP. Auth must become **pluggable** — campus config picks the login provider.
2. **Config becomes per-campus data** — academic calendar, club taxonomy, locations, branding move into a `campus` config object.

### Strategy
Build #1–#3 **tenant-aware from day one** (add `campus_id` + a config abstraction) so multi-campus is additive, not a painful retrofit. The "same-header-different-scope" collision solved in #1 (program in the upsert key) is the same pattern tenancy needs.

### Things we still need to discuss / decide
1. **How ambitious now?** Seed `campus_id` + config layer during #1–#3, or hard-defer everything to a dedicated phase?
2. **Pluggable auth design** — interface for SSO providers; what's the fallback (email OTP) for campuses without an IITR-style portal?
3. **Onboarding a new campus** — this config bundle IS the real "product SDK" (see #5).
4. Data migration plan for existing IITR data into a tenant-scoped model.

---

## Feature #5 — MCP Server + AI Assistant  🔵 Vision / future

**Status:** Aspirational (see `docs/MCP_AI_INTEGRATION_GUIDE.md`). Split into two distinct things.

### The two things hiding in "SDK/MCP"
1. **MCP server exposing this app's data** (events, calendar, clubs) to AI assistants — a *thin read layer* over the existing DB. Genuinely useful + demo-friendly. Build **after** the data layer is solid. Keep it focused on *our own* data first; the guide's broader "federated cafeteria/library MCPs" is scope-creep for later.
2. **The "product SDK" for adaptability** — this is really the **per-campus onboarding config** from #4 (define SSO, calendar source, taxonomy, branding). Frame the SDK as that config/adapter contract, not a published npm package.

### Correction to the existing guide
`MCP_AI_INTEGRATION_GUIDE.md` suggests OpenAI/Gemini. Per our decision, this app avoids the paid Claude API and defaults to **Groq free tier behind a pluggable provider** for any LLM/assistant feature. Update the guide when this is built.

### Things we still need to discuss / decide
1. Scope of v1 MCP — read-only over events/calendar/clubs?
2. Assistant UX — floating chat, rich card renderers?
3. Auth context — how the assistant safely acts as the logged-in user.
4. Which free/cheap LLM powers it, and rate-limit strategy.

---

## 📋 Priority summary

| # | Feature | Status | Priority | Notes |
|---|---------|--------|----------|-------|
| 1 | Academic Calendar PDF Parser | ✅ Done | **P0** | Shipped & verified E2E (branch `feat/academic-calendar-parser`). 2 optional nice-to-haves deferred (diff view, edit-live-anytime). |
| 2 | Event Ingestion Layer | 🟡 Discuss | P1 | Lock sources + publish model. Reuses #1's engine. |
| 3 | Per-Club Workspaces & Publish Gate | 🟡 Discuss | P1 | Natural home for #2. Data-model discussion needed. |
| 4 | Multi-Campus / Tenancy | 🔵 Seed now | P2 | Don't rewrite; seed `campus_id` + config during #1–#3. |
| 5 | MCP Server + AI Assistant | 🔵 Future | P3 | Build after data layer is solid. Groq, not paid Claude. |

---

## 🧾 Global decisions already locked
- **No paid LLM (Claude API) in this app.** Any LLM assist = Groq free tier, behind a pluggable `LLM_PROVIDER` env var.
- **Deterministic-first, LLM-as-sandboxed-backstop.** LLM may only fill `null` fields behind whitelist validation; never overrides deterministic output; fails open to human/flag.
- **Fail loud, never fail into data.**
- **Tenant-aware seeding** (`campus`/`program` tags) even in IITR-only builds.
- **Primary userbase = IITR UG (non-MBA).** Build for them first; extend via the pluggable `ExtractionStrategy` + per-institution config.

---

*Keep this doc alive: when you finish or advance a feature, update its Status, check off acceptance criteria, and append to its Decision log so the next contributor inherits your reasoning.*
