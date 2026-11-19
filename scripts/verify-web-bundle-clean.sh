#!/usr/bin/env bash
#
# Asserts that the guest-login door for Play Store reviewers is absent from the WEB build.
#
# The separation is enforced by `__MOBILE_BUILD__` being substituted with a literal boolean at build
# time, so rollup deletes the dead branches. That works, but it is the kind of thing that regresses
# silently: one `import` moved to the top of a file, one helper promoted into a shared object literal,
# and the guest code is back in dist/ with nothing to say so. This script is the thing that says so.
#
# Run after `npm run build`:
#     ./scripts/verify-web-bundle-clean.sh
#
# Exits non-zero — and names the offending file — if anything guest-shaped survived.

set -euo pipefail

DIST="${1:-dist}"

if [ ! -d "$DIST" ]; then
    echo "verify-web-bundle-clean: '$DIST' does not exist. Run 'npm run build' first." >&2
    exit 2
fi

# Everything here is either the guest door itself or the native-session machinery that only the
# Android build has any use for. index.html is excluded from the domain check because its canonical
# and og: tags legitimately name the production origin.
FORBIDDEN=(
    'guest-login'          # the endpoint path
    'guestLogin'           # the client function
    'GuestLoginPanel'      # the component
    'Continue as Guest'    # the button
    'cd_session_token'     # the native bearer-token storage key
    'playstore-tester'     # the default username
)

failed=0

for needle in "${FORBIDDEN[@]}"; do
    if hits=$(grep -ril -- "$needle" "$DIST" 2>/dev/null); then
        echo "FAIL: '$needle' found in the web bundle:" >&2
        echo "$hits" | sed 's/^/        /' >&2
        failed=1
    fi
done

# The web app is same-origin at /api in every environment. An absolute API URL in this bundle means
# the mobile branch leaked in — the exact class of bug that once baked localhost:8081 into production.
if hits=$(grep -rl -- 'campus-dashboard.iitr.ac.in/api' "$DIST" 2>/dev/null); then
    echo "FAIL: an absolute API origin is baked into the web bundle:" >&2
    echo "$hits" | sed 's/^/        /' >&2
    failed=1
fi

if [ "$failed" -ne 0 ]; then
    echo "" >&2
    echo "The web build must not contain the Play Store tester login. Check that every reference is" >&2
    echo "behind __MOBILE_BUILD__ and reached only through a dynamic import (see src/services/guestAuth.js)." >&2
    exit 1
fi

echo "verify-web-bundle-clean: OK — no guest-login or native-session code in $DIST/"
