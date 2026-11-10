# syntax=docker/dockerfile:1

# Both stages pin Node's image by the digest of its multi-platform index, which Dependabot moves
# (.github/dependabot.yml); a new major moves by hand, with @types/node.

# Build stage: runs on the build machine's own platform, because the output (static files and
# TypeScript sources) is the same for every target platform.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Edge builds pass the short commit, which Settings → About shows after the version (vite.config.ts).
ARG KINOPEER_COMMIT=""
RUN npm run build && rm server/*.test.ts
# The data folder is made here and copied below, so the runtime stage runs nothing: a RUN there would
# run on the target platform, emulated when arm64 is built on amd64, and the workflows set up no QEMU.
RUN mkdir /data

# Runtime: Node runs server/*.ts directly (type stripping), so no node_modules are needed.
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
# Edge builds pass the edge worker of Kinopeer's TMDB proxy; empty, the server uses the released
# versions' (server/main.ts → tmdbProxy). TMDB_PROXY_URL at run time replaces either.
ARG KINOPEER_TMDB_PROXY=""
ENV KINOPEER_TMDB_PROXY=$KINOPEER_TMDB_PROXY
ENV NODE_ENV=production \
    PORT=8080 \
    KINOPEER_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
# Settings saved from the app (the TMDB key). Mount a volume here to keep them across updates.
COPY --from=build --chown=node:node /data /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/main.ts"]
