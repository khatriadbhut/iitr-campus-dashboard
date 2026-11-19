#!/usr/bin/env bash
#
# Post-deploy smoke test. Read-only, safe to run against production at any time.
#
# Answers one question: "the deploy reported success — is the app actually working?"
# It is NOT a test suite. Each check is something that, if it fails, means users are affected right
# now. Nothing here writes data or needs a login.
#
# Usage:
#   ./scripts/smoke-test.sh                    # production
#   BASE=http://127.0.0.1:5173 ./scripts/smoke-test.sh   # local docker-compose
#
set -uo pipefail

BASE="${BASE:-https://campus-dashboard.iitr.ac.in}"
# The marketing landing page owns / ; the SPA is mounted under /app/. Anything that inspects the
# app shell (entry bundle, index.html caching, PWA headers) must ask for $APP, not $BASE.
APP="$BASE/app"
PASS=0; FAIL=0

check() { # name  expected  actual  [detail]
  if [[ "$2" == "$3" ]]; then
    printf '  \033[32m✓\033[0m %-46s %s\n' "$1" "$3"; PASS=$((PASS+1))
  else
    printf '  \033[31m✗\033[0m %-46s got %s, want %s\n' "$1" "$3" "$2"; FAIL=$((FAIL+1))
    [[ -n "${4:-}" ]] && printf '      %s\n' "$4"
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null || echo "000"; }

echo "▸ Smoke test: $BASE  (app at $APP/)"
echo

# ── Is anything serving at all? ──────────────────────────────────────────────
check "Landing root loads" 200 "$(code "$BASE/")" \
  "Nothing is being served at the root. Check the s3-landing origin and its bucket policy."

check "SPA loads at /app/" 200 "$(code "$APP/")" \
  "The app is not being served. Check the /app/* cache behaviour and the app/ key prefix in S3."

check "Bare /app redirects to /app/" 301 "$(code "$BASE/app")" \
  "campus-spa-router lost its trailing-slash redirect; /app falls through to the landing bucket and 403s."

# The health endpoint does a real DB ping, so 200 means "can actually serve", not "process alive".
check "API health (real DB ping)" 200 "$(code "$BASE/api/health")" \
  "503 = DB unreachable. 502/504 = backend down. 403 = origin-verify header mismatch."

# ── Is the auth layer up? ────────────────────────────────────────────────────
# 401 is the CORRECT answer here — it proves the route exists, auth middleware ran, and the DB was
# reachable enough to reject cleanly. A 500 means auth is throwing; a 200 means the gate is OPEN.
check "Gated endpoint rejects anonymous" 401 "$(code "$BASE/api/events/all")" \
  "500 = auth is erroring. 200 = THE GATE IS OPEN, every student's data is public."

# The dev backdoor must never exist in production.
check "dev-login is absent" 404 "$(code "$BASE/api/oauth/dev-login")" \
  "Anything but 404 means an auth bypass is live. Take the site down."

# Login must at least start — this only proves the redirect is built, not that the exchange works.
check "OAuth login redirects" 302 "$(code "$BASE/api/oauth/login")" \
  "Students cannot begin logging in."

# ── Did the frontend actually update? ────────────────────────────────────────
ASSET=$(curl -s --max-time 15 "$APP/" 2>/dev/null | grep -oE '/app/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
if [[ -n "$ASSET" ]]; then
  check "Entry bundle is fetchable" 200 "$(code "$BASE$ASSET")" \
    "index.html points at an asset that isn't uploaded — a partial deploy."
  BODY=$(curl -s --max-time 15 "$BASE$ASSET" 2>/dev/null)
  if grep -qE '(localhost|127\.0\.0\.1):8081' <<<"$BODY"; then
    printf '  \033[31m✗\033[0m %-46s dev URL in LIVE bundle\n' "Live bundle has no dev URL"; FAIL=$((FAIL+1))
  else
    printf '  \033[32m✓\033[0m %-46s clean\n' "Live bundle has no dev URL"; PASS=$((PASS+1))
  fi
else
  printf '  \033[31m✗\033[0m %-46s could not find it in index.html\n' "Entry bundle reference"; FAIL=$((FAIL+1))
fi

# ── SEO: the things that silently stop the site being findable ───────────────
check "robots.txt is served" 200 "$(code "$BASE/robots.txt")" \
  "A missing robots.txt also means the Sitemap: line is gone, so Google never discovers the sitemap."

check "sitemap.xml is served" 200 "$(code "$BASE/sitemap.xml")" \
  "Search Console will report the submitted sitemap as unreadable."

# Every unknown path used to return the landing page with a 200. Google calls that a soft 404 and
# it turns one broken link into an unbounded set of duplicate indexed URLs.
check "unknown path is a real 404" 404 "$(code "$BASE/this-page-does-not-exist")" \
  "Soft 404 regression — the CloudFront router is serving the landing shell for junk paths again."

# The SPA used to live at the root. Those URLs are in Google's index and in shared WhatsApp links.
check "legacy /home 301s into the app" 301 "$(code "$BASE/home")" \
  "Old shared links are landing on the marketing page instead of the app."

# All of /app/* is served the same shell, so the canonical is the only thing collapsing them.
if curl -s --max-time 15 "$APP/" 2>/dev/null | grep -q 'rel="canonical"'; then
  printf '  \033[32m✓\033[0m %-46s present\n' "app shell has a canonical"; PASS=$((PASS+1))
else
  printf '  \033[31m✗\033[0m %-46s MISSING\n' "app shell has a canonical"; FAIL=$((FAIL+1))
  printf '      Every /app/ route will be indexed as a separate duplicate page.\n'
fi

# The mocked demo is a second full copy of the app; without noindex it competes with the real one.
if curl -s --max-time 15 "$BASE/demo/index.html" 2>/dev/null | grep -qi 'name="robots" content="noindex'; then
  printf '  \033[32m✓\033[0m %-46s noindex\n' "mock demo is excluded"; PASS=$((PASS+1))
else
  printf '  \033[31m✗\033[0m %-46s NOT excluded\n' "mock demo is excluded"; FAIL=$((FAIL+1))
fi

# Search Console ownership hangs on this one file. Delete it and the property silently
# de-verifies: the sitemap stops being read and Request Indexing disappears, with no email
# and no visible change to the site. Google re-checks it periodically, not just once.
if curl -s --max-time 15 "$BASE/google24365df491692a0e.html" 2>/dev/null | grep -q 'google-site-verification'; then
  printf '  \033[32m✓\033[0m %-46s present\n' "Search Console verification file"; PASS=$((PASS+1))
else
  printf '  \033[31m✗\033[0m %-46s MISSING — property will de-verify\n' "Search Console verification file"; FAIL=$((FAIL+1))
fi

# ── Caching, the silent breaker ──────────────────────────────────────────────
# A long-cached index.html or service worker strands installed PWAs on an old build permanently.
IDX_CC=$(curl -sI --max-time 15 "$APP/" 2>/dev/null | grep -i '^cache-control' | tr -d '\r' | cut -d' ' -f2-)
if grep -qiE 'no-cache|no-store|max-age=0' <<<"$IDX_CC"; then
  printf '  \033[32m✓\033[0m %-46s %s\n' "index.html is revalidated" "$IDX_CC"; PASS=$((PASS+1))
else
  printf '  \033[31m✗\033[0m %-46s %s\n' "index.html is revalidated" "${IDX_CC:-none}"; FAIL=$((FAIL+1))
  printf '      A cached index.html strands users on an old build.\n'
fi

# ── Security headers that are cheap to lose ──────────────────────────────────
HDRS=$(curl -sI --max-time 15 "$APP/" 2>/dev/null | tr -d '\r')
for h in strict-transport-security content-security-policy x-content-type-options; do
  if grep -qi "^$h:" <<<"$HDRS"; then
    printf '  \033[32m✓\033[0m %-46s present\n' "$h"; PASS=$((PASS+1))
  else
    printf '  \033[31m✗\033[0m %-46s MISSING\n' "$h"; FAIL=$((FAIL+1))
  fi
done

echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32m✓ %d/%d passed — the deploy is serving correctly\033[0m\n\n' "$PASS" "$((PASS+FAIL))"
  exit 0
fi
printf '\033[31m✗ %d failed, %d passed\033[0m\n' "$FAIL" "$((PASS+FAIL))"
printf 'Roll back rather than debug forward:  see docs/DEPLOY_RUNBOOK.md\n\n'
exit 1
