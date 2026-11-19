#!/usr/bin/env bash
#
# Regenerate docs/IITR-Campus-Dashboard-Developer-Handbook.pdf from docs/ONBOARDING.md.
#
# The markdown is the source of truth — edit that, then run this. Two steps:
#   1. handbook-html.mjs  markdown -> a print-tuned HTML (A4 styling, per-block code sizing,
#                         GitHub-compatible heading anchors so the in-document TOC links work)
#   2. handbook-pdf.mjs   that HTML -> PDF via Playwright's Chromium, tagged and with a
#                         bookmark outline built from the heading tree
#
# Needs `marked` (not a project dependency — this is a docs tool, not app code) and the
# Chromium that `npm install` already put in node_modules/playwright.
#
#   npm install marked            # once, if it complains
#   ./scripts/build-handbook.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

node -e "require.resolve('marked')" 2>/dev/null || {
  echo "marked is not installed. Run:  npm install marked" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

node scripts/handbook-html.mjs "$TMP/handbook.html"
node scripts/handbook-pdf.mjs  "$TMP/handbook.html" \
     "docs/IITR-Campus-Dashboard-Developer-Handbook.pdf"

echo "✓ docs/IITR-Campus-Dashboard-Developer-Handbook.pdf"
