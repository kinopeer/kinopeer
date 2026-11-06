#!/bin/sh
# Renders the README screenshots (docs/screenshots/) in the Playwright Docker image, like the
# screenshot tests, with the dev server inside the container: TMDB is real, qBittorrent and Prowlarr
# are mocked. TMDB goes through the dev server's default, Kinopeer's edge TMDB proxy (vite.config.ts),
# so no key is needed; a TMDB_API_KEY in the environment or .env.local goes to TMDB directly instead.
set -eu
cd "$(dirname "$0")/.."
. scripts/playwright-docker.sh
prepare_node_modules_volume
exec docker run --rm --init --ipc=host \
  -v "$PWD":/work -v "$NODE_MODULES_VOLUME":/work/node_modules -w /work \
  -e TMDB_API_KEY -e PLAYWRIGHT_IMAGE \
  "$PLAYWRIGHT_IMAGE" sh -c 'scripts/install-node-modules.sh && npx playwright test -c playwright.readme.config.ts "$@"' playwright "$@"
