# Debugging & Gotchas

Things that are **non-obvious from reading the code**, written down so the next person (or you in six
months) doesn't have to rediscover them.

Organised by **symptom** — search for what you're seeing, not for what you think the cause is.

> Living document. Add to it whenever something costs you more than ten minutes to work out.

---

## The server won't start

### `admin_permission is missing: <name>`

**The app refuses to boot if any of the six permission rows are absent.** This is deliberate.

```
admin_permission is missing: manage_clubs.
Run migrations (20260805000000-seed-admin-permissions) before starting.
```

**Fix:** `npx sequelize-cli db:migrate`

**Why it fails loudly instead of continuing:** permission checks resolve names → ids at boot
(`utils/permissions.js`). If a row were missing, every check against it would quietly return 403 —
an admin who genuinely holds the permission gets "access denied", with no error in any log and
nothing to grep for. That is *much* harder to diagnose than a server that won't start. Loud failure
over silent misbehaviour.

The six rows are seeded by migration `20260805000000` with fixed ids, so a fresh database and
production converge on the same numbers. Verified identical in both.

### nginx: `host not found in upstream "backend"`

Only in the docker-compose setup. nginx resolves upstream hostnames **once, at startup** — if the
`backend` container isn't up yet, nginx exits rather than retrying.

`depends_on: backend` normally prevents this. If it recurs, start the backend first, or add a
`resolver` directive (see the note in `nginx.conf`).

---

## Something returns 401 / 403 unexpectedly

### Every request 401s right after a deploy

Tokens now **require a `tv` claim** (token version). Any token minted without one is rejected.

If you add a new place that signs a JWT, **it must include `tv`** or every request with that token
fails. Read the current value from `user.token_version`. See `routes/auth.js` for the pattern.

Rotating `JWT_SECRET` also invalidates every session at once — by design, it's the emergency
"log everyone out" lever.

### An admin gets 403 on something they should be able to do

Check what they actually hold:

```sql
SELECT ap.name FROM admin_permission_alloted apa
JOIN admin_permission ap ON ap.id = apa.admin_permission_id
WHERE apa.user_id = <id>;
```

The six permissions are: `event_crud`, `location_crud`, `event_category_crud`, `manage_admins`,
`manage_club_admins`, `manage_clubs`.

**`manage_admins` is not a superset.** A user with only `manage_admins` cannot create clubs — that
needs `manage_clubs`. This surprises people because "super admin" sounds all-encompassing.

The ingestion override routes need **`manage_club_admins`**, despite being called "super admin only"
in the code.

### A logged-out user gets 500 instead of being sent to login

Should be fixed — `SessionRevokedError` is handled in `clubAdminAuth.js` and returns 401. If you see
a 500 again, some new error handler is missing that case. The SPA only redirects to login on **401**,
so anything else leaves the user staring at a generic error.

### Everyone hits "Too many requests" at once

Fixed, but worth understanding. The write limiter is **keyed on the logged-in user**, not the IP.

Per-IP does not work here: the whole campus shares one public address behind the institute's NAT, so
100 writes / 15 min was a budget for all 8,000 students *combined*. About a dozen people signing up
simultaneously would lock out everyone else.

If you add a limiter, key it on the user for anything post-login.

**Related:** `TRUST_PROXY_HOPS` must match the deployment or `req.ip` resolves to a proxy rather than
the client:

| Environment | Chain | Value |
|---|---|---|
| EC2 / production | CloudFront → nginx → node | **2** |
| docker-compose | nginx → node | **1** (default) |

Get it wrong and every request appears to come from one address again.

---

## Image uploads

### Upload returns 413, or an HTML error the app can't parse

nginx rejected it before the app saw it. **`client_max_body_size` must be higher than the app's
limit** (currently 20 MB app / 21 MB nginx) in *both*:

- `nginx/ec2-backend.conf` — production
- `nginx.conf` — self-hosted compose

If nginx rejects first you get an HTML error page; the SPA expects JSON and shows something useless.
The app's own limit returns a clean `{"error": "File too large"}`.

### Upload returns 415 Unsupported Media Type

`app.js` blocks non-JSON writes as a CSRF layer. Multipart is allowed **only** on paths in
`MULTIPART_ALLOWED`. Adding a new upload endpoint means adding it there too.

### Upload returns 400 "Invalid image" for a real image

`sharp` throws on anything it can't decode — **that is the file-type check.** The client's
`Content-Type` and filename are never trusted. SVG is rejected on purpose (script-bearing).

If a genuine image fails, check the sharp error in the logs before touching the limits.

### Images upload fine but don't display

**CloudFront serves exactly one path from the posters bucket: `/posters/*`.**

That's why logos are stored as `posters/logos-<uuid>.webp` rather than `logos/<uuid>.webp`. A key
outside that prefix returns 403 — and because CloudFront rewrites errors to `index.html`, an `<img>`
receives **HTML with a 200 status**. Silent, invisible breakage with a dead URL saved to Postgres.

**Never introduce a new top-level key prefix without adding a matching CloudFront behaviour first.**

### Uploads succeed in production but images vanish after a deploy

Shouldn't happen any more — the app refuses to fall back to local disk when `NODE_ENV=production`.
If you see it, `POSTER_S3_BUCKET` is unset and something removed that guard. Container disk is
ephemeral; the next deploy destroys it, and the dead URL is already in the database.

---

## Builds and deploys

### The built site points at localhost

**Vite loads `.env` in every mode, including production builds.** A `VITE_API_URL=http://localhost:8081`
in your local `.env` will be baked into a production bundle.

This is now prevented — the API base is **pinned in code** (`src/services/api.js`), not read from
config:

```js
const API_URL = import.meta.env.DEV ? (import.meta.env.VITE_API_URL || '/api') : '/api';
```

`import.meta.env.DEV` is replaced at build time, so the dev branch is removed entirely from the
production bundle. No env file can override it.

**`/api` is an architectural fact, not configuration** — every environment is same-origin:

| Environment | How `/api` resolves |
|---|---|
| `npm run dev` | Vite proxy (`vite.config.js`) |
| docker-compose | nginx proxies to the backend container |
| Production | CloudFront routes `/api/*` to EC2 |

### Verifying a build before uploading

The frontend is deployed by a **manual local build + upload**, so nothing catches a bad build for
you. Check before you upload:

```sh
npm run build
grep -c '"/api"' dist/assets/*.js        # want 1
grep -c 'localhost:8081' dist/assets/*.js # want 0
```

### No env files in git

Only `.env.example` and `temp_backend/.env.example` are tracked. `.gitignore` blocks everything else
with **no exceptions** — an earlier `!.env.production` exception was removed, since exceptions are
what let a real `.env.local` with live credentials get committed in Feb 2026.

Anything prefixed `VITE_` is **compiled into the public JS bundle**. It is never a secret. That's how
an ImgBB API key ended up publicly readable on the live site.

---

## Local development

### dev-login fails with `UniqueConstraintError` on a brand-new database

Known, harmless. A `findOrCreate` race during first-boot schema seeding. **Retry — it works the
second time.**

### dev-login doesn't exist in production

Correct and intentional. The route is **not registered** when `NODE_ENV=production` — it returns 404
rather than being guarded by a runtime check that could be bypassed by a misconfigured env.

### Login works locally but cookies don't stick

`localhost` and `127.0.0.1` are **different sites** to a browser, so a `SameSite=Lax` cookie set on
one is not sent to the other. The repo has historically mixed both. Pick one spelling and use it
everywhere — the code's dev fallback is `127.0.0.1:8081`.

---

## Reading the logs

Logs go to CloudWatch Logs group **`/campus/backend`**, 30-day retention. Console → Logs Insights.

### The one thing to know: the JSON is double-wrapped

The app logs pino JSON to stdout; Docker wraps *that* in its own JSON before the agent ships it. So a
stored line looks like:

```json
{"log":"{\"level\":30,\"time\":...,\"msg\":\"ingest cycle\"}\n","stream":"stdout","time":"..."}
```

**Consequence: `fields level, msg` returns nothing.** Those aren't top-level fields — they're text
inside the `log` string. This looks like "logging is broken" and isn't.

`log` *is* queryable as a string, so filter on it:

```
fields @timestamp, log | filter log like /"level":50/        # errors only
fields @timestamp, log | filter log like /statusCode":5/     # 5xx responses
fields @timestamp, log | filter log like /Session revoked/   # a specific message
fields @timestamp, log | filter log like /"user_id":12345/   # one user's activity
fields @timestamp, log | sort @timestamp desc | limit 50     # just tail it
```

To pull fields out properly, `parse` the inner string first:

```
parse log /"level":(?<lvl>\d+)/
| parse log /"msg":"(?<message>[^"]*)"/
| filter lvl >= 50
| fields @timestamp, lvl, message
```

pino levels: **10** trace · **20** debug · **30** info · **40** warn · **50** error · **60** fatal.

### Why it isn't "fixed"

Unwrapping would mean either switching to Docker's `awslogs` driver — which **replaces** json-file, so
`docker logs` stops working on the instance, a bad trade when debugging live — or having the app write
a second log file purely for shipping. Both cost more than the filter syntax above. Revisit if log
volume ever makes Insights queries slow.

### All containers share one stream

`i-<instance-id>/docker` carries backend *and* autoheal. The CloudWatch agent can't template a stream
name per container (it supports `{instance_id}`, `{hostname}`, `{date}` — not container name), and
container IDs change on recreate so they can't be hardcoded. In practice autoheal is nearly silent, so
this is noise-free enough. Filter on `campus-dashboard-api` if it ever isn't.

### Database maintenance and failure events

RDS notifications go to the **`campus-alerts`** SNS topic (subscription `campus-db-events`) — the same
email as the CloudWatch alarms. Categories: availability, maintenance, failure, low storage,
configuration change. So a maintenance restart or a storage warning arrives by email rather than being
discovered from user reports.

**Windows are set to genuinely dead hours** (they were not, by default):

| | UTC | IST | Was |
|---|---|---|---|
| Maintenance | `sat:21:30-22:00` | **Sunday 03:00–03:30** | Wednesday 18:33 — peak campus evening |
| Backup | `22:30-23:00` daily | **daily 04:00–04:30** | 23:41 — student hours |

AWS assigns a random window at creation if you don't pick one, with no idea what timezone your users
are in. On single-AZ RDS both operations cause a brief I/O pause, so both belong overnight.

---

## Disaster recovery — measured, not assumed

**A restore was performed for real on 2026-08-05.** These numbers come from that drill, not from
documentation.

| | Measured |
|---|---|
| Snapshot → running database | **4m 05s** |
| Data integrity | **Exact match** with production on every table |
| App against restored DB | health 200, auth gate 401, public calendar 200 with 44 real entries |
| **Realistic RTO** | **~5–10 min** (restore + repoint + verify) |
| **RPO** | Up to 24h from a daily snapshot; ~5 min if PITR is available — see caveat |

Database is **11 MB**, which is why the restore is fast. Expect this to grow slowly.

### How to actually do it

```sh
# 1. newest automated snapshot
aws rds describe-db-snapshots --db-instance-identifier campus-db --snapshot-type automated \
  --profile campus --region ap-south-1 \
  --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].DBSnapshotIdentifier' --output text

# 2. restore to a NEW instance — never over the top of production
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier campus-db-restore-test \
  --db-snapshot-identifier "<id from above>" \
  --db-instance-class db.t3.micro \
  --db-subnet-group-name default \
  --vpc-security-group-ids <SECURITY_GROUP_ID> \
  --no-publicly-accessible --no-multi-az --no-deletion-protection \
  --backup-retention-period 0 \
  --profile campus --region ap-south-1

# 3. verify from the EC2 (RDS is private — you cannot reach it from a laptop).
#    Take the prod DATABASE_URL and swap the host:
#      campus-db.  ->  campus-db-restore-test.

# 4. delete when done
aws rds delete-db-instance --db-instance-identifier campus-db-restore-test \
  --skip-final-snapshot --delete-automated-backups --profile campus --region ap-south-1
```

Restoring always creates a **new** instance — RDS will not overwrite an existing one, so the drill
cannot damage production. Cost of a drill is a few cents.

### Point-in-time recovery — verified working

**RPO is ~5 minutes, not 24 hours.** Confirmed on 2026-08-05 by actually attempting a PITR restore;
AWS accepted it.

Two ways to check, and the first one lies:

```sh
# QUICK — but can give a false negative
aws rds describe-db-instances --db-instance-identifier campus-db --profile campus \
  --region ap-south-1 --query 'DBInstances[0].{e:EarliestRestorableTime,l:LatestRestorableTime}'
```

`EarliestRestorableTime` read **null** here despite PITR working fine. It goes null while the PITR
baseline re-establishes after a backup-window change, and stays that way until the first backup in
the new window completes. **Do not conclude PITR is broken from this alone.**

The reliable signal in that same output is **`LatestRestorableTime`**: if it sits ~5 minutes behind
the current time, transaction logs are being captured continuously — which IS the PITR mechanism.
A stale or missing `latest` is the real warning sign.

```sh
# DEFINITIVE — AWS rejects this outright if PITR is unavailable, before creating anything
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier campus-db \
  --target-db-instance-identifier campus-pitr-check \
  --use-latest-restorable-time \
  --db-instance-class db.t3.micro --db-subnet-group-name default \
  --vpc-security-group-ids <SECURITY_GROUP_ID> \
  --no-publicly-accessible --no-multi-az --no-deletion-protection \
  --profile campus --region ap-south-1

# then immediately:
aws rds delete-db-instance --db-instance-identifier campus-pitr-check \
  --skip-final-snapshot --delete-automated-backups --profile campus --region ap-south-1
```

The API accepting the call is the proof — no need to wait for the instance to finish creating. Costs
a few cents.

**Why this matters:** without PITR you can only rewind to the last daily snapshot (04:00 IST), so a
2pm failure loses ten hours of RSVPs and posted events. With it, the same failure loses five minutes.

### Worth doing later

Retention is **7 days**; the maximum is 35. At 11 MB it is free to raise. Seven days does not cover
"someone deleted a batch of events and nobody noticed for ten days" — a realistic scenario during
exams when nobody is looking.

---

## Reading production safely

RDS is in a private subnet — you cannot connect from a laptop. Go through SSM:

```sh
aws ssm send-command --instance-ids <EC2_INSTANCE_ID> \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["docker exec campus_dashboard_backend node -e \"...\""]' \
  --profile campus --region ap-south-1
```

Then `aws ssm get-command-invocation --command-id <id> --instance-id <id>` for the output.

**Never point a test at production.** Every test in this repo's history has used a throwaway
Postgres container:

```sh
docker run -d --name scratch-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=t -p 55432:5432 postgres:16-alpine
```

---

## Deploying

### There is no staging environment — this is deliberate

A staging stack on the EC2 would cost nothing in money but the box has **1 GB of RAM** already
running backend + nginx + autoheal. A second stack does not fit.

**Local docker-compose is the staging environment.** Same image, same nginx config, same Postgres
version. It covers "does this code work against a real database", which is most of what staging
buys. It does *not* cover CloudFront routing, the origin-verify header, real RDS, or the EC2 itself
— those exist only in production.

The trade taken instead: **if you can't prevent a bad deploy, make recovery fast.**

| Instead of staging | What it does |
|---|---|
| `scripts/deploy-frontend.sh` | Refuses to upload a broken bundle |
| `scripts/smoke-test.sh` | Confirms the deploy actually serves, after the fact |
| Rehearsed rollback | Still TODO — see `docs/LAUNCH_CHECKLIST.md` §1.4 |

### Deploying the frontend

```sh
./scripts/deploy-frontend.sh --check-only   # build + verify, upload nothing
./scripts/deploy-frontend.sh                # build, verify, upload, invalidate
./scripts/smoke-test.sh                     # confirm it's actually serving
```

The frontend is **not** deployed by `deploy.sh` (that's backend only) and not by CI. It is a manual
local build and upload, which is exactly the path with no safety net — hence the gate.

**The gate is designed never to fail a working build.** Every assertion is about a string guaranteed
present or absent by `src/services/api.js`, not a heuristic. If it ever fires on a good build, fix
the check — a gate with false positives gets bypassed, and a bypassed gate is worse than none.

It blocks on: missing `"/api"`, a dev URL in the bundle, a call to `api.imgbb.com`, a missing or
truncated `index.html`. It **warns without blocking** on a missing `og:image`, since that's a
marketing regression rather than a broken site.

### Smoke test: what a failure means

`smoke-test.sh` is read-only and safe against production at any time.

| Check | A failure means |
|---|---|
| SPA root 200 | Nothing is serving — CloudFront or the S3 bucket |
| `/api/health` 200 | 503 = DB unreachable · 502/504 = backend down · 403 = origin-verify mismatch |
| `/api/events/all` **401** | 500 = auth is erroring · **200 = the gate is OPEN and student data is public** |
| `dev-login` **404** | Anything else = an auth bypass is live. Take the site down |
| Live bundle has no dev URL | A broken build reached production |
| `index.html` revalidated | A cached `index.html` strands installed PWAs on an old build |

`/api/events/all` returning **401 is the pass condition** — it proves the route exists, auth ran, and
the database was reachable enough to reject cleanly.

---

## Design decisions that look odd but aren't

| Looks odd | Why |
|---|---|
| Permissions resolved by **name**, stored by **id** | Ids come from insertion order and differ between databases; names don't. Ids stay in the DB for foreign keys |
| No `*_PERMISSION_ID` env vars | Ids don't vary between deploys, so they were never config — they're domain constants |
| Logos stored under the `posters/` prefix | CloudFront only serves `/posters/*` |
| `sharp` re-encodes even small images | It's the file-type check *and* strips EXIF (GPS in phone photos) *and* kills polyglots |
| A second encode pass at lower quality | Only fires if the first output is *bigger* than the input — re-encoding a tiny already-compressed image can grow it |
| Upload auth isn't tied to a specific event/club | The image is chosen before the row exists. Object-level checks still happen on the write itself |
| `/uploads` static mount exists at all | Dev-only fallback. Production refuses to use it |

---

## Candidate: a browser smoke test

**Not done. Logged because a real near-miss made the case for it.**

### Why

During the React Router 7 → 8 upgrade, `npm run build` succeeded **while the app was completely
broken** — a blank white page on every route. React Router 8 is ESM-only, Vite's dep optimizer handed
it a different React instance than the app got, and every render died with `Cannot read properties of
null (reading 'useRef')` inside `<BrowserRouter>`.

Nothing in the toolchain caught it:
- The build was green.
- All four backend suites passed (they don't touch the frontend).
- `scripts/deploy-frontend.sh` passed — it greps the bundle for `/api`, not for *does React render*.

It was caught by opening a browser and looking at a screenshot. **That is the only reason it didn't
ship.** The same failure mode is waiting on every remaining upgrade — `pdfjs-dist` 4→6,
`lucide-react` 0→1, Vite 7→8 — each of which can compile perfectly and still white-screen.

### What it should do

Deliberately small. Four routes, does it render, is the console clean. Not a test suite, not clicking
every button — the goal is catching *catastrophic* breakage, which is the failure mode that actually
occurs.

```js
// tests/smoke.spec.js — playwright is already a devDependency
import { test, expect } from '@playwright/test';

const ROUTES = ['/home', '/calendar', '/todo', '/admin', '/event/1'];

test('app renders every route with no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(e.message));

  // dev-login sets the session cookie and redirects to /home
  await page.goto('http://localhost:5173/api/oauth/dev-login');
  await expect(page).toHaveURL(/\/home/);

  for (const route of ROUTES) {
    await page.goto(`http://localhost:5173${route}`);
    // #root having children is the actual assertion — a white screen is an EMPTY #root,
    // which is exactly what a green build plus a broken router produces.
    await expect(page.locator('#root')).not.toBeEmpty();
  }

  expect(errors, `console errors:\n${errors.join('\n')}`).toHaveLength(0);
});
```

The load-bearing assertion is `#root` not being empty. HTTP 200 proves nothing here — the server
happily serves `index.html` while React fails to mount inside it.

### What it needs to run

The full stack, which is why this is an hour rather than ten minutes:

1. Throwaway Postgres — `docker run -d -e POSTGRES_PASSWORD=test -e POSTGRES_DB=t -p 55432:5432 postgres:16-alpine`
2. Migrations — `DATABASE_URL=... npx sequelize-cli db:migrate`
3. Backend with `DEV_LOGIN=true`
4. `npx vite` on 5173
5. `npx playwright test`

**dev-login is what makes this possible at all** — the app is entirely login-gated, and Channel-i
can't be automated. Note dev-login throws a `UniqueConstraintError` on first boot against a fresh
database; hit it twice.

### Gotchas found the hard way

- **Use one hostname throughout.** `localhost` and `127.0.0.1` are different *sites* to a browser, so
  a session cookie set on one is not sent to the other. Mixing them makes the test look like an auth
  failure. Pick `localhost` and stay there.
- **Clear `node_modules/.vite` after any dependency change** before testing, or you may be testing a
  stale pre-bundle rather than the code you changed.
- **A production-mode check is worth adding too** (`npm run build && npx vite preview`), because dev
  and prod resolve dependencies differently — the React Router bug existed *only* in dev.

### Where it belongs

In `scripts/deploy-frontend.sh`, between the bundle check and the S3 upload — so a broken build
cannot reach production. Until then, run it manually after any dependency upgrade.

---

## Still open

Known issues not yet fixed — see `docs/LAUNCH_CHECKLIST.md` for the full list.

- **Node 20 is EOL** (April 2026). Both Dockerfiles still on `node:20-alpine`
- **No SIGTERM handler** — in-flight requests are dropped on every deploy
- **No Docker log rotation** — unbounded logs on a small root volume is the classic way a t3.micro dies
- `POST /clubs/create` without `email` returns **500** (DB constraint) instead of 400 (validation)
- `.env.example` still points `VITE_API_URL` at the dead Render backend
- `/uploads` static is mounted **before** helmet, so those responses carry no security headers
- Email ingestion stores raw attachment bytes — no `sharp`, EXIF intact
- Existing ImgBB image URLs in the database are not migrated
- Two paste-a-URL fields in `Admin.jsx` write arbitrary external URLs, bypassing upload validation
