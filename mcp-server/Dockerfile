# Container for the chaindump-mcp server (Cloud Run / any container host).
# Multi-stage: build TypeScript, then run a slim prod image.
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
# Cloud Run injects PORT (default 8080); the server reads process.env.PORT.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
