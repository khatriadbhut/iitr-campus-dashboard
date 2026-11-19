#!/usr/bin/env bash
#
# Build the SPA, REFUSE to upload it if the bundle is wrong, then sync to S3 and invalidate.
#
# Why this exists: the frontend is deployed by a manual local build + upload. There is no CI in that
# path, so nothing catches a bad build — and a bad build here is total: every visitor gets a site that
# cannot reach the API. This nearly shipped once, when a local .env with VITE_API_URL=localhost:8081
# was baked into a production bundle (Vite loads .env in EVERY mode, including production builds).
#
# DESIGN RULE: these checks must never fail a working build. A gate with false positives gets
# bypassed, and a bypassed gate is worse than no gate. Every assertion below is about a string that
# is either guaranteed present or guaranteed absent by src/services/api.js, not a heuristic.
#
# Usage:
#   ./scripts/deploy-frontend.sh                 # build, verify, upload, invalidate
#   ./scripts/deploy-frontend.sh --check-only    # build + verify, no upload (safe to run anytime)
#
set -euo pipefail

BUCKET="${FRONTEND_BUCKET:-campus-frontend-<AWS_ACCOUNT_ID>}"
# The SPA lives under a key prefix, NOT at the bucket root. CloudFront routes /app/* to this
# bucket with an empty origin path, so /app/index.html resolves to s3://<bucket>/app/index.html.
# The root of this bucket is unreachable — the distribution's DEFAULT behaviour points at the
# separate landing bucket. Uploading to the root therefore deploys nothing and, with --delete,
# quietly prunes whatever is up there.
PREFIX="${FRONTEND_PREFIX:-app}"
DISTRIBUTION="${CLOUDFRONT_DIST_ID:-<CLOUDFRONT_DISTRIBUTION_ID>}"
PROFILE="${AWS_PROFILE_NAME:-campus}"
CHECK_ONLY=0
[[ "${1:-}" == "--check-only" ]] && CHECK_ONLY=1

cd "$(dirname "$0")/.."

fail() { printf '\n\033[31m✗ REFUSING TO DEPLOY\033[0m — %s\n\n' "$1" >&2; exit 1; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
echo "▸ Building"
npm run build >/dev/null || fail "the build itself failed"
ok "build completed"

JS_FILES=$(find dist/assets -name '*.js' 2>/dev/null || true)
[[ -n "$JS_FILES" ]] || fail "no JS emitted in dist/assets — the build produced nothing"

# ─────────────────────────────────────────────────────────────────────────────
echo "▸ Verifying the bundle"

# 1. The API base must be the same-origin path. api.js pins this for production builds, so its
#    absence means either the pin was removed or the build didn't run in production mode.
grep -qF '"/api"' $JS_FILES || fail \
  "the bundle does not contain \"/api\".
   The API base is pinned in src/services/api.js for production builds. If that pin was removed or
   made configurable again, a stray VITE_API_URL can redirect every request — including session
   cookies. Check src/services/api.js."
ok 'API base is "/api"'

# 2. No dev URL may survive. import.meta.env.DEV is statically replaced, so the dev branch is
#    eliminated at build time — if these strings appear, something reintroduced runtime config.
if grep -qE '(localhost|127\.0\.0\.1):8081' $JS_FILES; then
  fail "a DEV API URL is baked into the production bundle.
   Every visitor's browser would try to reach a server on the deployer's machine.
   Cause is almost always a local .env — Vite loads .env in EVERY mode, production included."
fi
ok "no dev URL in the bundle"

# 3. The old third-party image host is gone. Its API key used to ship inside this bundle, publicly
#    readable. Uploads now go through our own backend to S3.
if grep -qF 'api.imgbb.com' $JS_FILES; then
  fail "the bundle still calls api.imgbb.com.
   Image uploads must go through POST /api/upload/poster. A VITE_-prefixed key is compiled into
   the public bundle and is not a secret."
fi
ok "no third-party image host"

# 4. The entry point must exist and be non-trivial, and must reference a hashed asset — catches a
#    truncated or half-written dist.
[[ -s dist/index.html ]] || fail "dist/index.html is missing or empty"
grep -qE '"/'"$PREFIX"'/assets/index-[A-Za-z0-9_-]+\.js"' dist/index.html || fail \
  "dist/index.html does not reference /$PREFIX/assets/index-<hash>.js.
   Either dist is incomplete, or vite.config.js no longer builds with base:'/$PREFIX/'. A bundle
   built for the wrong base uploads fine and then 404s every asset, because CloudFront serves this
   bucket only under /$PREFIX/*."
ok "index.html references a hashed bundle under /$PREFIX/"

# 5. Link previews. The app spreads by people pasting URLs into WhatsApp; a missing og:image renders
#    a blank card, and WhatsApp caches that for ~72h with no purge. Warn, don't block — this is a
#    marketing regression, not a broken site, and blocking a working deploy over it breaks the rule.
if ! grep -qF 'og:image' dist/index.html; then
  printf '  \033[33m!\033[0m no og:image in index.html — links will preview blank in WhatsApp\n'
fi

BUNDLE_KB=$(cat $JS_FILES | wc -c | awk '{printf "%.0f", $1/1024}')
ok "bundle ${BUNDLE_KB}KB raw"

if [[ $CHECK_ONLY -eq 1 ]]; then
  printf '\n\033[32m✓ Bundle passed all checks\033[0m (--check-only, nothing uploaded)\n\n'
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
echo "▸ Uploading to s3://$BUCKET/$PREFIX/"

# Hashed assets first, with a long immutable cache. Safe because the filename changes on every build.
aws s3 sync dist/assets/ "s3://$BUCKET/$PREFIX/assets/" --profile "$PROFILE" \
  --cache-control 'public, max-age=31536000, immutable' --only-show-errors
ok "hashed assets uploaded (immutable)"

# Everything else last, no-cache, so a client never sees a new index.html pointing at assets that
# aren't up yet. --delete prunes old builds.
aws s3 sync dist/ "s3://$BUCKET/$PREFIX/" --profile "$PROFILE" --delete --exclude 'assets/*' \
  --cache-control 'no-cache' --only-show-errors
ok "index.html + service worker uploaded (no-cache)"

# Only the always-revalidated files need invalidating; hashed assets are immutable by filename.
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --profile "$PROFILE" \
  --paths "/$PREFIX/index.html" "/$PREFIX/sw.js" "/$PREFIX/manifest.webmanifest" \
          "/$PREFIX/registerSW.js" "/$PREFIX/" \
  --query 'Invalidation.Id' --output text >/dev/null
ok "CloudFront invalidation created"

printf '\n\033[32m✓ Frontend deployed\033[0m\n'
echo "  Now run: ./scripts/smoke-test.sh"
