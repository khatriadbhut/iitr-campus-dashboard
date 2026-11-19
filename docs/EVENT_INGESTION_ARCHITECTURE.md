# Event Ingestion — Build & Architecture Doc

**Status:** Pre-build blueprint. Product rationale + all locked decisions live in `docs/FEATURE_ROADMAP.md` → *Feature #2 — Email Ingestion*. **This doc is the engineering plan**: module layout, exact data model, per-phase file manifest, seed data, and test strategy. It deliberately mirrors the shipped **academic-calendar** feature (`temp_backend/services/academicCalendar/`) — same shapes, same idioms, so it drops into the codebase cleanly.

**Guiding constraints (from the roadmap):** deterministic-first (optional Groq assist, off by default, never overrides parsed data); one centralized mailbox (the dev's IITR account), parsed once for all; human-in-the-loop via **pre-filled create-event form** (no separate moderation queue); minimal UI (an `Events | Notices` tab + a date filter — nothing else); tenant-aware config (IITR-first). MVP = Phases 1–6; lifecycle = Phase 7 fast-follow; server-side push = a separate later feature.

---

## 1. Data flow (one email → zero or more proposals → human publish)

```
 IITR mailbox (Gmail API, incremental history)
        │  raw message
        ▼
 [ ingested_email ]  ← persist normalized top-message + metadata (Inbox Replay net)
        │
        ▼
 services/eventIngestion/index.js  (pure, deterministic, snapshot-tested)
   gates(domain/list/deny) → dethread(+split) → attribute(sender-map+subject) → classify(intent) → extract(fields)
        │  EventProposal[]  (CREATE_EVENT | CREATE_NOTICE | … )
        ▼
 [ event_proposal ] / [ notice ]   ← idempotent upsert (message-id + content hash)
        │
        ▼
 Admin dashboard: "Drafts from email (N)"  →  existing create-event form, PRE-FILLED
        │  admin glances, fixes flagged fields, Publish
        ▼
 [ event ] (source='email')  →  existing feed        [ notice ] (published) → Notices tab
```

Phase 7 adds the dashed branch: a follow-up email resolves to an existing event → `PATCH_*`/`CANCEL_EVENT` proposal → admin confirms a diff.

---

## 2. Directory & file layout (mirrors `services/academicCalendar/`)

```
temp_backend/
  services/eventIngestion/
    index.js                     # orchestrator: rawEmail → EventProposal[]
    gates.js                     # Gate 0 domain · Gate 1 broadcast-list · Gate 2 deny
    dethread.js                  # strip quoted history; split multi-item bodies
    attribute.js                 # sender→club/fest map + gensec relay subject-convention parse
    classify.js                  # intent → event | opportunity | notice
    extract.js                   # pull {title,dates,time,venue,links,confidence,tentative,...}
    resolveIdentity.js           # (Phase 7) evidence-accumulation matcher vs existing events
    store.js                     # DB layer: persist ingested_email, upsert proposals/notices (idempotent)
    llmAssist.js                 # optional Groq tie-breaker, env-gated, fail-open (copy calendar's)
    source/gmail.js              # (Phase 3) Gmail API incremental-history fetch + normalize
    runner.js                    # (Phase 3) poll loop, last-sync heartbeat, dead-letter
    institutions/iitr.config.js  # TENANT SEAM: lists, deny senders, subject conventions, category map, sender map
    __tests__/pipeline.test.js   # snapshot smoke test over the corpus
    __tests__/snapshots.json     # expected classification/attribution/extraction per fixture
    fixtures/*.json              # the ~150 saved real emails (Inbox-Replay corpus)
    __dev__/                     # throwaway inspection/db-integration scripts (git-ignored spirit)
  database/
    schemas/{ingestedEmail,eventProposal,notice,senderEntityMap}.js   # new
    schemas/{event,club}.js                                           # edited (new columns)
    schemas/index.js                                                  # register + associations
    seedEventIngestion.js                                             # idempotent seed (categories/fests/Institute/sender-map)
  routes/eventIngestion.js                                            # proposals list/publish/dismiss/promote-sender + notices
  middlewares/permissions/eventIngestion.js                          # gate (reuse event perms + super-admin for Institute/notices)
```

Frontend touchpoints (Phase 4–6): the existing create-event form (pre-fill from a proposal), a "Drafts from email" entry in `src/pages/Admin.jsx`, the `Events | Notices` tab + date filter in `src/pages/Home.jsx`, and a small notices list component.

---

## 3. Data model (exact)

**Tables are created by `initializeSchema()` at boot; seeds run in `startServer` after it (idempotent), same as `seedAcademicCalendar`.** **Resolved:** `initializeSchema.js` runs `sequelize.sync({ alter: false })`, so new *tables* auto-create once registered in `index.js`, but new *columns* do **not**. Add the `event`/`club` columns exactly how the file already adds `is_all_day` / `user_todo` / `reminder.offset_minutes` — idempotent raw `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` blocks appended in `initializeSchema.js`.

### 3.1 `event` — add columns (keep `club_id` as the single attribution for v1)
| column | type | notes |
|---|---|---|
| `source` | STRING(16) NOT NULL default `'manual'` | `'manual'` \| `'email'` — drives the master toggle |
| `status` | STRING(16) NOT NULL default `'scheduled'` | scheduled·updated·cancelled·rescheduled·completed (Phase 7 uses the rest) |
| `source_sender` | TEXT null | provenance |
| `source_message_id` | STRING(255) null | provenance + identity resolution; **not** the event's identity |
| `registration_link` | TEXT null | for events that carry a form/registration |
| `audience` | STRING(24) null | **display-only** badge (`Freshers`/`PG`/`Girls only`/`Hostel`…) parsed from subject/body — NOT a filter, NOT a preference |

*(No `deadline` column on events — opportunities route to Notices. `audience` is display-only; year-*filtering* stays dropped.)*

### 3.2 `club` — add column
| `is_fest` | BOOLEAN NOT NULL default `false` | fests are club rows shown in a "Fests" group |

### 3.3 `ingested_email` (new) — the Inbox-Replay store
`id` BIGINT PK AI · `message_id` STRING(255) **UNIQUE NOT NULL** · `thread_id` STRING(255) · `internal_date` DATE *(Gmail internalDate — mutation ordering)* · `from_addr` TEXT · `to_addrs` TEXT · `subject` TEXT · `body_text` TEXT *(normalized top message)* · `raw_snapshot` JSONB *(enough to re-run the pipeline)* · `state` STRING(16) default `'parsed'` *(received·parsed·error·dead_letter)* · `error` TEXT · `created_at` DATE.
Indexes: unique `message_id`, `internal_date`.

### 3.4 `event_proposal` (new) — typed mutations, not objects
`id` BIGINT PK AI · `ingested_email_id` BIGINT → `ingested_email` · `mutation_type` STRING(24) *(CREATE_EVENT·PATCH_TIME·PATCH_VENUE·PATCH_DEADLINE·CANCEL_EVENT·CREATE_NOTICE·DISMISS)* · `target_event_id` BIGINT null → `event` *(patches/cancels)* · `club_id` BIGINT null → `club` *(attribution; null→resolves to "Institute")* · `payload` JSONB *(extracted fields)* · `evidence` JSONB *(per-field confidence + identity evidence)* · `state` STRING(16) default `'proposed'` *(proposed·published·dismissed)* · `created_at` DATE.
Indexes: `club_id`, `state`, `ingested_email_id`.

### 3.5 `notice` (new)
`id` BIGINT PK AI · `title` TEXT NOT NULL · `body` TEXT · `priority` STRING(12) *(important·general)* · `link` TEXT *(many notices' real content is a channel-i link — body is thin)* · `deadline` DATEONLY null *(the last/relevant date — fee/registration/scholarship notices DO have these; drives expiry)* · `open_ended` BOOLEAN default `false` *("until further notice" / "revised timings applicable from…" → never auto-expire)* · `audience` STRING(24) null *(display badge)* · `source_message_id` STRING(255) · `published_at` DATE · `expires_at` DATE null *(computed archive time — see rule)* · `created_at` DATE.
Indexes: `priority`, `published_at`, `deadline`.

**Notice expiry rule (grounded in real mail):**
- Has a **deadline/last-date** (fee, registration, scholarship — e.g. Academic Registration's Jul-31 window) → archive **after the deadline passes**.
- **Single-date** facility notice ("Reduced Library Hours on 21.03") → archive **~1 day after** that date.
- **Open-ended** ("football ground closed until further notice") or **ongoing-from** ("revised pool timings applicable from 21 Jul") → `open_ended=true`, **no auto-expiry**; stays current until a *newer* notice supersedes it or an admin clears it. *(Do NOT force-expire — that would wrongly "reopen" the football ground.)*
- Dateless info/policy → age out after a long default (e.g. 30 days) or manual clear.

### 3.6 `sender_entity_map` (new) — structured, admin-taught (not regex-in-code)
`id` PK AI · `match_type` STRING(12) *(sender·subject_pattern)* · `match_value` TEXT · `club_id` BIGINT → `club` · `created_by` BIGINT null *(admin user)* · `created_at` DATE.
Index: `match_value`. Only **homogeneous** senders + fests are mapped here; mixed senders intentionally have no row → fall through to "Institute" + category.

### 3.7 Associations to add in `schemas/index.js`
```
IngestedEmail.hasMany(EventProposal, { foreignKey: 'ingested_email_id' })
EventProposal.belongsTo(IngestedEmail, { foreignKey: 'ingested_email_id' })
EventProposal.belongsTo(Club,  { foreignKey: 'club_id' })
EventProposal.belongsTo(Event, { foreignKey: 'target_event_id' })   // patches/cancels
SenderEntityMap.belongsTo(Club, { foreignKey: 'club_id' })
// Notice: standalone (no FK)
```

---

## 4. `institutions/iitr.config.js` (the tenant seam — all IITR specifics as data)
- `broadcastLists`: `['students-notices@iitr.ac.in','ug@iitr.ac.in','pg@iitr.ac.in', …year/dept lists]`
- `denySenders`: `['noreply-emailsupport@','donotreply-acad@','estba@','ar.gadm@','registrar@','safetyofficer@','cmo@','professor.incharge.ranking@','chair.dinc@','director@','ddirector@','cvo@','ceo.tih@','sonika.dsric@','so@security@','pic.safety@','noreply.finance@', …]`  *(the second group = ranking-PR / governance / greetings / condolences, from the 1-yr survey)*
- `calendarClassSenders`: `['aao-timetable@','arcurriculum@']` → these broadcast **exam schedules (MTE/ETE)** and **teaching-day / timetable-reschedule** notices that *mutate the academic calendar* (Feature #1's `Exam` / `Timetable Reschedule` categories). Route to a **calendar-entry proposal**, not the events feed. *(Cross-feature: email ingestion can feed the academic calendar incrementally.)*
- Institutional-**opportunity** senders newly mapped (not clubs, not deny): `coordinator.cec.qip@` (paid multi-date workshops), `ciso@` (webinars), `ircell@`/`alumnicell_iarc@` (study-abroad + pan-IIT comps — "institutional-adjacent", NOT deny), `coordinator@cera`/`head@pt` (prize competitions), `guptafcc@`/ICC (IT-resource notices + GIS/COMSOL workshops), plus more dept/centre heads (`head@{cfse,me,mt,pt,hre,eq}`, `metal@`).
- `denySubjects`: `[/viva-?voce/i, /open notice for ph\.?d/i, /^om:|office memorandum/i, /minutes of/i, /quarantined/i]`
- `stripSubjectPrefixes`: `[/^\[SPAM\]\s*/i, /^\[SUSPECTED SPAM\]\s*/i]`  ← never a deny signal
- `relaySenders`: `['gensec.technical@iitr.ac.in','gensec.cult@iitr.ac.in']`  → parse entity from subject
- `subjectEntityRules`: `||`→fest, `|`/`by`→club, `at <Fest>`
- `categories`: the 6 canonical names (seeded into `event_category`)
- classification keyword/date rules (intent cues, deadline phrases, venue tokens)

**Edge cases from the 1-year survey (bake into `extract`/`classify`/dedup):**
- **Don't trust body dates blindly** — stale/wrong-year dates appear inside re-sent mails ("27th September 2024" in a 2025 mail). Prefer the email `Date` header + explicit "Today/Tomorrow" cues; treat a body date years off from the header as suspect → `tentative`.
- **Extract ALL dates and label their role** (form-close · selection-announce · event · deadline) — CEC/QIP and competition mails carry several; don't grab just the first.
- **Reminder/re-forward chains** ("Gentle Reminder", "Re:", "Fwd:") re-send the same item 3× — dedup by thread + normalized subject-stem (feeds Phase-7 identity resolution).
- **Routing target beyond event/opportunity/notice:** `calendarClassSenders` → **calendar-entry** proposal (exam/teaching-day) instead of the events feed.

---

## 5. Seed (`seedEventIngestion.js`, idempotent, hooked in `startServer`)
1. **Categories** → upsert the 6 into `event_category` (skip if present).
2. **Clubs**: `"Institute"` catch-all; fests `Cognizance`/`Srishti`/`Thomso`/`Sangram` (`is_fest=true`); optional known homogeneous clubs (`HEC`, `Cinema Club`). *(club requires unique `name` + `email` — use the real list address as `email`, e.g. `hec@iitr.ac.in`.)*
3. **`sender_entity_map`**: `hec@`→HEC, `cinemaclub@`→Cinema Club, `cognizance@`/`fa.cognizance@`→Cognizance, `sangram@`→Sangram, … (homogeneous only).
Guard each step with an existence check (mirror `seedAcademicCalendar`'s `count() > 0` pattern).

---

## 6. Test strategy (the regression net = Inbox Replay)
- `fixtures/` = a real-email corpus saved as normalized JSON (`{message_id, from, to, subject, internal_date, body_text}`). **Note:** only ~30 bodies were read in full during design; the actual fixture set must be *gathered* in Phase 2 (pull a broad, representative slice — events, opportunities, notices, calendar-class, and the junk classes — across a normal month + a fest week + exam season). Aim for ~80–150 labelled fixtures.
- `pipeline.test.js` runs each fixture through `index.js` and asserts against `snapshots.json`: gate verdict, attributed club/fest, classification, and key extracted fields (lenient on cosmetic whitespace). Same philosophy as the calendar parser's 8/8 smoke test.
- Idempotency test: run the same fixture set twice through `store.js` → no duplicate proposals/events.

---

## 7. Routes & permissions (Phase 4–5)
`routes/eventIngestion.js`:
- `GET /ingestion/proposals?scope=club|institute` — proposals for the caller's club(s) / central admin.
- `POST /ingestion/proposals/:id/publish` — proposal → create `event` (`source='email'`) or publish a notice; mark `published`.
- `POST /ingestion/proposals/:id/dismiss`.
- `POST /ingestion/senders/promote` — map an unknown sender/pattern → a club (writes `sender_entity_map`).
- `GET /notices?priority=` — public notices feed (important→general).
Permission (`middlewares/permissions/eventIngestion.js`): club admins see/act on their club's proposals (reuse `event.js` perm); `"Institute"` proposals + notices gated to super-admin (reuse the calendar feature's `manage_admins` gate).

---

## 8. Per-phase build manifest (the actionable checklist)

**Phase 1 — Data model + seeds**
- [ ] Verify `initializeSchema` alter behavior (§3); add `event` column migration if needed.
- [ ] New schema files: `ingestedEmail.js`, `eventProposal.js`, `notice.js`, `senderEntityMap.js`.
- [ ] Edit `event.js` (5 columns), `club.js` (`is_fest`).
- [ ] Register all + associations in `schemas/index.js`.
- [ ] `seedEventIngestion.js` (categories/fests/Institute/sender-map) + hook in `app.js startServer`.

**Phase 2 — Extractor + snapshot tests** *(no DB/Gmail; build & prove first)*
- [ ] `institutions/iitr.config.js`, `gates.js`, `dethread.js`, `attribute.js`, `classify.js`, `extract.js`, `index.js`.
- [ ] `fixtures/` (gather ~80–150 representative labelled emails), `__tests__/pipeline.test.js` + `snapshots.json`. `npm test` green.
- [ ] Optional `llmAssist.js` hook (copy calendar's, off by default).

**Phase 3 — Gmail source + runner** → `source/gmail.js`, `store.js`, `runner.js` (idempotent, heartbeat, dead-letter).

**Phase 4 — Admin pre-fill curation** → `routes/eventIngestion.js` + permission; frontend pre-fill of the create-event form + "Drafts from email (N)" in `Admin.jsx`.

**Phase 5 — Notices tab** → notices endpoint + `Events | Notices` tab in `Home.jsx` + notices list component.

**Phase 6 — Feed tweaks** → date filter; drop events ~1h after end (`Home.jsx`); master toggle (`event.source`); fests in club filter (`is_fest`); everything-ON defaults.

**Phase 7 (fast-follow)** → `resolveIdentity.js` + `PATCH_*`/`CANCEL` proposals + status transitions + patch-never-overwrite + field provenance + `internal_date` ordering + cancelled banner.

---

## 8b. Exhaustive email read / fixture-gathering plan (queued — run interactively, Gmail auth is session-bound)
A deliberate pass to close the coverage gaps and produce the variety-complete Phase-2 fixture corpus. Runs as fan-out subagents (each returns a distilled report + a labelled fixture slice), because Gmail volume would blow a single context.

**A. Lists beyond `students-notices@`** (the fresher/dept gap):
- `to:ug@iitr.ac.in`, `to:pg@iitr.ac.in`, dept-year lists (`to:ug-1st-year@*.iitr.ac.in`, `ug-2nd/3rd/4th-year@*`), hostel/bhawan lists, `staff-notices@`/`faculty-notices@` (to learn what to EXCLUDE).

**B. Thin seasons** (windowed, monthly to beat the 300-cap):
- **Fresher orientation / admissions** (Jul–Aug 2025 & Jul–Aug 2026), **placement season** (Aug–Nov: CDC/company mail), **Thomso** autumn cultural fest (Oct–Nov 2025), **convocation**, **exam seasons** (MTE Sep–Oct + Feb–Mar; ETE Nov–Dec + Apr–May).

**C. Poster/attachment reality check:** `has:attachment from:iitr.ac.in` — read a sample to measure how often event detail is *image-only* (drives the OCR-in-v2 priority).

**D. Deep-read volume:** ~60–100 full bodies across all types (currently only ~30 read), prioritizing unseen types; save each as a normalized labelled fixture.

**Deliverables:** (1) updated sender taxonomy + deny list; (2) any new notice/opportunity/calendar-class types; (3) poster-only frequency %; (4) `~80–150` labelled fixtures written to `services/eventIngestion/fixtures/` + expected labels for `snapshots.json`. This *is* the Phase-2 corpus.

## 8c. Consolidated deltas from the exhaustive 1-year survey (6-agent fan-out)
**Coverage scope (decided):** v1 ingests `students-notices@` **+ `ug-1st-year@`/`pg-1st-year@`** (if the mailbox is subscribed). **Out of scope (documented non-goals):** course-level dept-year mail (`ug-3rd-year@ee` batch/TA/re-exam), bhawan/mess-discipline mail, and the **incoming-fresher admission packet** (hostel allotment, medical, ID-card — sent *before* students have institute email; would need Channel-i scraping, which is ruled out). Hostel-council *events* already cc `students-notices@`, so those are covered.

**Poster/OCR (decided): OCR is NOT a v1 need.** Event mail is **~90%+ text-complete** (image-only ≈ 5–10%). v2 OCR is scoped to two offenders only: **`awards@` scholarships** (systematically one-line body → detail in a `channeli.in/media/*.png` image) and **forwarded external CFP brochures**. Also: filter recurring **signature-logo attachments** by filename (`cultiitrlogo.png`, inline `image.png`) so they aren't treated as posters.

**Calendar-class routing (refined):**
- **Exam / re-exam schedules (MTE/ETE)** are **Channel-i LINK-ONLY** — *no dates in the email* → cannot auto-populate a calendar entry; treat as a **notice + link**, flagged "detail behind link". (`aao-timetable@` and `donotreply-acad@` send the *same* schedule → dedup.)
- **Teaching-day / timetable-reschedule / one-off class-day** (`arcurriculum@`, `aao-ug@`) → **text-parseable** → `Timetable-Reschedule` calendar entries.
- **Holiday + class-shift** (`aao-ug@`, NEW) → fans out to **two** entries (`Holiday` + `Timetable-Reschedule`); GA reason PDF attached.
- **Academic-calendar publish/revise** (`donotreply-acad@`/`arcurriculum@`) → **PDF attached, parseable** → route to Feature #1's PDF parser; a "Revised" mail re-triggers it.
- Exam hall/gate/SOP/results, course add/drop → **plain notices**.

**Dedup & parsing (refined):** co-senders broadcast the same item — `gensec.cult@` + **`fa.culsoc@`** (cultural sections), `aao-timetable@` + `donotreply-acad@` (exams). Dedup by **subject-stem + date**, not message-id. **Forwarded chains** (`Fwd:` from `gensec.pgacads@`, `dean.ir@`, `adci@`) carry the real content *inside* the quoted block → parse the originating block, don't just strip quotes.

**Placement general-vs-personal split (classification rule):** **GENERAL** (in general feed) = open "register if interested" (audience self-selects; body-stated year/branch eligibility is still general). **PERSONAL** (out of scope, separate feature) = requires being already in the placement pipeline (your slot / your assessment link / roster / shortlist). Body cue: *"register here / apply"* = general vs *"your slot / log in and attempt / if already booked, ignore"* = personal. New general-feed career senders: `adci@` (Corporate/Institute Lecture Series), `cig@` (masterclasses), `prof.ic_cdc@`, `alumnicell_iarc@` (alumni talks), `ecell@`, `smp@`. **COMET** = a career fest (general).

**Audience badges (extended):** `Freshers`, `UG 1st-year`, `PG 1st-year`, `PG`, `Girls only`, `Hostel`, **`Final Year / Graduands`** (convocation: no-dues, attire, leaving-campus — useless to non-graduands). NCE (NCC/NSS/NSO) registration is **mandatory + deadline-bound** → "action required".

**Fest itineraries (Thomso):** `fa.thomso@` sends **day-bundled** "Day N Itinerary" mails (one mail → 6–10 sub-events, schedule in a PDF) → the multi-event split must handle bundles. Thomso = dual sender `thomso@`+`fa.thomso@` (+legacy `pic.thomso@`) → one Thomso fest row. Add a **Cultural sub-type** (pronite/star-night/DJ/fashion) within the Cultural category.

**Expanded sender lists (for `iitr.config.js` + seed):**
- *More institutional (allow):* `head@{bt,cs,ct,cfse,me,mt,pt,hre,eq}`, `metal@`, `aao-phd@`, `adaa-admission@` (admissions conduct), `head.icc@`, `chairman.lac@`, `librarian@`, `library@`, `convener.sac@`, `smp@`, `outreachcell@`, `deansaharanpurcampus@`.
- *More clubs/fests (exclude→attribute individually):* `ecell@`, `tic@` (Think India), `vsc@`, `alumnicell_iarc@`, `thomso@`/`fa.thomso@`, `fa.culsoc@`, `channeli.img@`, all `gensec.*`.
- *More deny/low-value:* `fc.timetable@ee`, `elect.office@`, `aao-phd@` (viva-heavy), `manager.aad@`, `liaisonofficerscst@`, `vision2047@`, `ccf@` (mostly non-event), plus the governance/PR set already listed.

## 9. Resolved decisions (were open questions)
1. **Multi-event split → YES, split into separate events when each sub-item has its own date/time.** Uncommon in practice (corpus examples: *Cinema Club* = 2 screenings; *Integral Cup* = 3 rounds). Add both as fixtures. A single multi-day span ("Orientation Week 5–8 Aug") stays one event.
2. **Fest creation → seed the 4 known fests** (Cognizance/Srishti/Thomso/Sangram); an *unknown* fest name falls to "Institute" and an admin one-click promotes it. No silent auto-creation.
3. **Notice expiry → grounded rule in §3.5** (deadline → archive after; single-date → ~1 day after; open-ended/ongoing-from → never auto-expire, supersede/clear).
4. **Audience display badge → IN**, display-only (`event.audience` / `notice.audience`), no filter/preference.
5. **Schema migration → resolved (§3):** `sync({alter:false})`, so add new columns via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `initializeSchema.js` (existing idiom).
