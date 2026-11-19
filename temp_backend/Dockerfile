# Node 26 — the current release line, and the latest that will become LTS (2026-10-28, EOL
# 2029-04-30). Even-numbered Node releases become LTS each October; odd ones (25, 27) never do and
# get ~6 months, so "latest" for Node means the latest EVEN version. v25 is already dead.
#
# Was node:20, which reached END-OF-LIFE 2026-04-30 and has had no security patches since. Chose 26
# over the current LTS (24, EOL 2028) for the extra year of runway — this project is meant to outlive
# its author's time on campus, so every avoided forced upgrade counts. The trade: for ~3 months until
# October it is a Current rather than LTS release.
#
# Verified in a container: npm ci resolves cleanly and sharp's musl prebuilt loads and encodes
# (libvips 8.18.3).
FROM node:26-alpine

WORKDIR /app

# Set node environment to production
ENV NODE_ENV=production

# Leverage Docker layer caching for dependencies
COPY package.json package-lock.json* ./

# Install only production dependencies. NO `|| npm install` fallback: npm ci's entire job is to fail
# loudly when the lockfile is stale or missing, and catching that failure to run a resolving install
# silently discards the reproducibility guarantee — the image could then be built from versions
# nobody reviewed. If this line fails, the lockfile needs regenerating; that is the correct outcome.
# (--only=production is also the deprecated spelling of --omit=dev.)
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

# Change ownership to the built-in non-root 'node' user
RUN chown -R node:node /app

# Switch to the non-root user for security
USER node

# Expose the internal port
EXPOSE 8081

# Container healthcheck → hits /health (cheap DB ping). "unhealthy" is what autoheal watches to auto-restart
# a HUNG app (a crash is caught by restart:unless-stopped; a hang isn't). start-period gives a slow boot room.
# Node one-liner so we need no curl/wget in the alpine image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8081/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Run DB migrations first (idempotent — no-op when nothing's pending; on a fresh RDS it applies the
# baseline), THEN start the app. `exec` hands signals straight to node for a clean graceful shutdown.
# sequelize-cli reads DATABASE_URL + NODE_ENV from the injected env.
CMD ["sh", "-c", "npx sequelize-cli db:migrate && exec node app.js"]
