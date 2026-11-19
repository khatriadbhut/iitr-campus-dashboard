# Stage 1: Build
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
FROM node:26-alpine AS builder

WORKDIR /app

# No build-time config. The API base is pinned to /api in src/services/api.js (nginx proxies it to
# the backend container), and image uploads go through our own backend to S3 rather than a
# third-party host — so there is no key to inject. Anything VITE_-prefixed lands in the public
# bundle, so a build arg is never the right home for a secret.

# Leverage Docker layer caching for dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the source code and build
COPY . .
RUN npm run build

# Stage 2: Production Nginx
FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy build artifacts from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose Nginx port
EXPOSE 80

# Run Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
