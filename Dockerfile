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
# Edge builds pass the edge worker of Kinoseed's TMDB proxy; empty, the server uses the released
# versions' (server/main.ts → tmdbProxy). TMDB_PROXY_URL at run time replaces either.
ARG KINOSEED_TMDB_PROXY=""
ENV KINOSEED_TMDB_PROXY=$KINOSEED_TMDB_PROXY
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
