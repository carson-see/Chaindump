# Container for the Chaindump research desk — a Cloud Run JOB (runs one pass to
# completion, no server/port). Multi-stage: build TypeScript, then a slim prod
# image. ANTHROPIC_API_KEY + DESK_TOKEN are injected as Cloud Run secrets.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Run as the non-root `node` user (uid 1000, present in node images). The Claude
# Agent SDK's CLI refuses `--dangerously-skip-permissions` when running as root
# (a safety guard) — Cloud Run runs containers as root by default, so we drop to
# non-root here. Give it a writable HOME for the CLI's config/cache.
ENV HOME=/home/node
RUN chown -R node:node /app
USER node
# A job: run the pass and exit. Config comes from env/secrets (DESK_TASK etc.).
CMD ["node", "dist/index.js"]
