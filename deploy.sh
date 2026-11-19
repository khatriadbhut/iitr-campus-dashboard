#!/usr/bin/env bash
# Deploy script — run ON the EC2, from the repo directory. Pulls latest, snapshots RDS if the pull
# brought a migration, rebuilds the backend image, restarts backend + autoheal. DB migrations run
# automatically via the container entrypoint (`sequelize-cli db:migrate`). The frontend is NOT here —
# it's on S3/CloudFront (see docs/DEPLOY_RUNBOOK.md).
#
# Prereqs on the EC2:
#   - a locked-down temp_backend/.env with PROD values (NODE_ENV=production, DATABASE_URL=<RDS>, JWT_SECRET,
#     Channel-i creds, redirectURL=<CloudFront>/api/oauth/token/ (the /api matters — see runbook P6), POSTER_S3_BUCKET/POSTER_PUBLIC_BASE, SENTRY_DSN…)
#   - /etc/campus-deploy.env (root-only, 0600) with SENTRY_AUTH_TOKEN/ORG/PROJECT. Deliberately NOT in
#     the container's .env — only this script needs it, so the app process can never read it.
#   - Docker + docker compose installed; Docker enabled on boot (systemctl enable docker)
#   - sentry-cli on PATH, and the instance role allowed rds:CreateDBSnapshot on campus-db
set -euo pipefail
cd "$(dirname "$0")"

DB_INSTANCE=campus-db
AWS_REGION=ap-south-1
KEEP_SNAPSHOTS=5
# Name the profile explicitly WHEN ONE IS ASKED FOR. On a dev machine an unnamed call
# falls through to [default] — a different account entirely, and on one machine the root
# user. On the EC2 box there is no named profile at all: credentials come from the
# instance role, and passing --profile campus there fails with "config profile could not
# be found", which aborts the deploy at the snapshot step. So: opt-in, not defaulted.
PROFILE_ARG=""
[ -n "${AWS_PROFILE_NAME:-}" ] && PROFILE_ARG="--profile ${AWS_PROFILE_NAME}"

echo "==> [1/6] pull latest"
# BEFORE is the last sha we deployed SUCCESSFULLY, not simply HEAD-before-pull. If a deploy dies after
# the pull (failed snapshot, failed build, Ctrl-C), the next run would otherwise see BEFORE == AFTER,
# conclude "no new commits", skip the snapshot, and let the entrypoint migrate an unprotected DB — the
# reflexive re-run walking straight through the guard that just fired.
LAST_DEPLOYED_FILE=/opt/campus/.last-deployed-sha
MARKER_MISSING=0
if [ -r "$LAST_DEPLOYED_FILE" ]; then BEFORE=$(cat "$LAST_DEPLOYED_FILE"); else BEFORE=$(git rev-parse HEAD); MARKER_MISSING=1; fi
git rev-parse --verify --quiet "$BEFORE^{commit}" >/dev/null || { BEFORE=$(git rev-parse HEAD); MARKER_MISSING=1; }
HEAD_BEFORE_PULL=$(git rev-parse HEAD)
git pull --ff-only

# The pull may have just replaced THIS FILE, but bash is still executing the inode it opened at
# startup — so a deploy that changes deploy.sh runs the OLD logic and the new steps only take effect
# one deploy later. (Git unlinks and recreates rather than rewriting in place, so the old script runs
# cleanly to completion; it is never partially executed. Corollary: never `cp` over deploy.sh while a
# deploy is running — same-inode rewrite IS the corrupting case.)
#
# Re-exec once, only when deploy.sh actually changed, so the ordinary deploy is untouched. Safe here
# and nowhere later: no side effects have happened yet — no snapshot, no .release.env, no Sentry
# release. Must stay BELOW the `cd "$(dirname "$0")"` above, since $0 is relative under `sudo ./deploy.sh`.
if [ -z "${DEPLOY_REEXEC:-}" ] && ! git diff --quiet "$HEAD_BEFORE_PULL" HEAD -- deploy.sh; then
  echo "    deploy.sh changed in this pull — re-executing the new version"
  DEPLOY_REEXEC=1 exec "$0" "$@"
fi
AFTER=$(git rev-parse HEAD)

# ── Snapshot, but only when it's actually needed ─────────────────────────────
# This used to be an echo saying "REMINDER: take a manual snapshot", which is only as reliable as
# whoever is reading the output at 2am. Snapshotting on EVERY deploy would be wasteful, so gate it on
# whether the pull actually brought a new migration — the only thing that can't be rolled back by
# redeploying the previous image.
echo "==> [2/6] check for new migrations"
# Keep the two failure domains apart: "git diff says no migrations" must never be indistinguishable
# from "git diff itself failed". Masking the latter would skip the snapshot silently — the one
# direction this step must never fail in.
CHANGED_MIGRATIONS=$(git diff --name-only "$BEFORE" "$AFTER" -- temp_backend/migrations/) \
  || { echo "!! git diff failed — cannot prove there are no migrations; aborting" >&2; exit 1; }
NEW_MIGRATIONS=$(printf '%s' "$CHANGED_MIGRATIONS" | grep -c . || true)
if [ "$MARKER_MISSING" = "1" ]; then
  # No record of the last SUCCESSFUL deploy, so BEFORE is a guess and the diff proves nothing — an
  # earlier run may have pulled a migration and died before applying it. Snapshot rather than assume.
  # One-time: the marker is written on the next green deploy.
  echo "    no $LAST_DEPLOYED_FILE — cannot prove the DB is unchanged, snapshotting to be safe"
  NEW_MIGRATIONS=1
fi
if [ "$MARKER_MISSING" = "0" ] && [ "$BEFORE" = "$AFTER" ]; then
  echo "    already at $AFTER — nothing new to deploy, skipping snapshot"
elif [ "${NEW_MIGRATIONS:-0}" -gt 0 ]; then
  SNAP="campus-db-deploy-$(date +%Y%m%d-%H%M%S)"
  echo "    $NEW_MIGRATIONS migration file(s) incoming → snapshotting $DB_INSTANCE as $SNAP"
  # A snapshot is consistent as of its CREATION time, so we don't block on it reaching 'available';
  # we only insist that it was accepted, since proceeding without a restore point is the real risk.
  if ! aws rds create-db-snapshot --region "$AWS_REGION" $PROFILE_ARG \
        --db-instance-identifier "$DB_INSTANCE" --db-snapshot-identifier "$SNAP" \
        --query 'DBSnapshot.DBSnapshotIdentifier' --output text; then
    echo "!! snapshot FAILED — refusing to run migrations without a restore point" >&2
    exit 1
  fi
  # Keep the last N deploy snapshots. Scoped to the campus-db-deploy-* prefix by both this filter and
  # the IAM policy, so a manual snapshot can never be pruned by an automated run.
  #
  # Sort by IDENTIFIER, not SnapshotCreateTime: the snapshot created seconds ago is still 'creating',
  # and RDS omits SnapshotCreateTime until it completes — sort_by then hard-errors on the null. The
  # identifier embeds a zero-padded timestamp, so it sorts identically and is never null.
  # Assigned first (not piped into `while`) so an empty result cannot kill the script under pipefail,
  # and so the loop body doesn't run in a subshell.
  PRUNE=$(aws rds describe-db-snapshots --region "$AWS_REGION" $PROFILE_ARG --snapshot-type manual \
      --db-instance-identifier "$DB_INSTANCE" \
      --query "sort_by(DBSnapshots[?starts_with(DBSnapshotIdentifier,'campus-db-deploy-')],&DBSnapshotIdentifier)[:-${KEEP_SNAPSHOTS}].DBSnapshotIdentifier" \
      --output text 2>/dev/null) || PRUNE=""
  for old in $PRUNE; do
    [ -z "$old" ] || [ "$old" = "None" ] && continue      # --output text prints None for a null result
    echo "    pruning old deploy snapshot: $old"
    aws rds delete-db-snapshot --region "$AWS_REGION" $PROFILE_ARG --db-snapshot-identifier "$old" >/dev/null || true
  done
else
  echo "    no migration files changed — skipping snapshot"
fi

echo "==> [3/6] build backend image"
docker compose build backend

# ── Sentry release ───────────────────────────────────────────────────────────
# Ties every error to the exact commit running. set-commits --auto needs the GitHub integration
# connected, and gives suspect commits ("this deploy introduced this error").
echo "==> [4/6] register Sentry release"
export SENTRY_RELEASE="$AFTER"
# Persist it so a MANUAL `docker compose up -d backend` computes the same config hash as this script.
# Otherwise the bare variable is empty in an operator's shell, compose sees changed config, silently
# recreates the container, and the running app loses its release until the next scripted deploy.
printf 'SENTRY_RELEASE=%s\n' "$AFTER" > /opt/campus/.release.env
if [ -r /etc/campus-deploy.env ] && command -v sentry-cli >/dev/null 2>&1; then
  # Subshell: the auth token must not outlive the commands that need it, and must never still be
  # exported when `docker compose up` runs a few lines below.
  (
    set -a; . /etc/campus-deploy.env; set +a
    # Never let telemetry bookkeeping fail a deploy — the app shipping matters more than the annotation.
    sentry-cli releases new "$SENTRY_RELEASE" \
      && (sentry-cli releases set-commits --auto "$SENTRY_RELEASE" || echo "    (set-commits skipped)") \
      && sentry-cli releases finalize "$SENTRY_RELEASE" \
      && echo "    release $SENTRY_RELEASE registered"
  ) || echo "    !! Sentry release step failed (continuing)"
else
  echo "    skipped (no /etc/campus-deploy.env or sentry-cli)"
fi

# --force-recreate is REQUIRED, not cosmetic: compose compares the image and the compose config, NOT
# the CONTENTS of env_file. Without it, editing temp_backend/.env and redeploying leaves the old
# process running with the old values — which is exactly how production once served a two-day-old
# Channel-i client_id, and why a freshly-set SENTRY_DSN appeared to do nothing.
echo "==> [5/6] restart backend + autoheal (external RDS — no local postgres service)"
docker compose up -d --force-recreate backend autoheal

echo "==> [6/6] wait for health"
for i in $(seq 1 40); do
  if curl -fsS http://localhost:8081/health >/dev/null 2>&1; then
    # ONLY on success — this is what makes the migration gate idempotent across a failed run.
    echo "$AFTER" > "$LAST_DEPLOYED_FILE"
    echo "healthy ✓  deploy complete  (release ${SENTRY_RELEASE:0:8})"; exit 0
  fi
  sleep 3
done
echo "!! backend did not become healthy — check: docker compose logs --tail=120 backend" >&2
exit 1
