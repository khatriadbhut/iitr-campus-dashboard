#!/usr/bin/env bash
# Put Chrome into a state the Playwright MCP server can attach to.
#
# The MCP server is configured with `--cdp-endpoint http://localhost:9222`, which means it does NOT
# launch a browser — it attaches to one already listening there. That is deliberate: attaching to YOUR
# Chrome, with your real profile, is the only way to drive the app as a genuinely logged-in user.
# Channel-i sign-in cannot be scripted, so a fresh browser can only ever reach dev-login on localhost,
# never production as a real student.
#
# The catch, and the reason this script exists: Chrome only opens the debugging port if the flag is
# present AT LAUNCH. Passing it to an already-running Chrome does nothing, silently — which surfaces
# later as `ECONNREFUSED ::1:9222` from a browser tool and looks like the MCP server is broken.
#
#   ./scripts/chrome-debug.sh            # your real profile — logged-in session, for production
#   ./scripts/chrome-debug.sh --scratch  # throwaway profile — for anything you would rather isolate
set -euo pipefail

PORT=9222
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
REAL_PROFILE="$HOME/Library/Application Support/Google/Chrome"
SCRATCH_PROFILE="${TMPDIR:-/tmp}/campus-chrome-debug"

if curl -s --max-time 3 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
    echo "✓ Chrome is already listening on $PORT — nothing to do."
    curl -s "http://localhost:$PORT/json/version" | sed -n 's/.*"Browser": "\([^"]*\)".*/  \1/p'
    exit 0
fi

if [ ! -x "$CHROME" ]; then
    echo "✗ Chrome not found at: $CHROME" >&2
    exit 1
fi

if [ "${1:-}" = "--scratch" ]; then
    PROFILE="$SCRATCH_PROFILE"
    # A brand-new profile pops a modal keychain prompt on macOS that nothing can answer from a script,
    # and Chrome sits there blocked. Mock keychain avoids it. NOT used for the real profile, where it
    # would break decryption of everything already saved.
    EXTRA=(--use-mock-keychain)
    echo "→ scratch profile: $PROFILE"
else
    PROFILE="$REAL_PROFILE"
    EXTRA=()
    # Chrome will not open the port for a profile that another Chrome already holds.
    if pgrep -f "Google Chrome" >/dev/null 2>&1; then
        echo "✗ Chrome is already running WITHOUT the debugging port." >&2
        echo "  Quit it fully (Cmd-Q, not just closing windows) and re-run this." >&2
        echo "  Or use --scratch to launch a separate profile alongside it." >&2
        exit 1
    fi
    echo "→ your real profile (logged-in session available)"
fi

"$CHROME" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE" \
    --no-first-run \
    --no-default-browser-check \
    ${EXTRA[@]+"${EXTRA[@]}"} \
    about:blank >/dev/null 2>&1 &

for _ in $(seq 1 20); do
    sleep 0.5
    if curl -s --max-time 2 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
        echo "✓ listening on $PORT — Playwright MCP can attach now."
        exit 0
    fi
done

echo "✗ Chrome did not open the port within 10s." >&2
exit 1
