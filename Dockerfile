# syntax=docker/dockerfile:1

# Build stage: runs on the build machine's own platform, because the output (static files and
# TypeScript sources) is the same for every target platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Edge builds pass the short commit, which Settings → About shows after the version (vite.config.ts).
ARG KINOSEED_COMMIT=""
RUN npm run build && rm server/*.test.ts

# Runtime: Node runs server/*.ts directly (type stripping), so no node_modules are needed.
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    KINOSEED_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
# Settings saved from the app (the TMDB key). Mount a volume here to keep them across updates.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/main.ts"]
