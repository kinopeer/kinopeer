#!/bin/sh
# Renders the README screenshots (docs/screenshots/) in the Playwright Docker image, like the
# screenshot tests, with the dev server inside the container: TMDB is real, qBittorrent and Prowlarr
# are mocked. Only TMDB_API_KEY goes into the container, from the environment or .env.local.
set -eu
cd "$(dirname "$0")/.."
. scripts/playwright-docker.sh
if [ -z "${TMDB_API_KEY:-}" ] && [ -f .env.local ]; then
  TMDB_API_KEY=$(sed -n 's/^TMDB_API_KEY=//p' .env.local | tr -d '"'"'"'')
fi
if [ -z "${TMDB_API_KEY:-}" ]; then
  echo "TMDB_API_KEY is not set (environment or .env.local)" >&2
  exit 1
fi
export TMDB_API_KEY
prepare_node_modules_volume
exec docker run --rm --init --ipc=host \
  -v "$PWD":/work -v "$NODE_MODULES_VOLUME":/work/node_modules -w /work \
  -e TMDB_API_KEY -e PLAYWRIGHT_IMAGE \
  "$PLAYWRIGHT_IMAGE" sh -c 'scripts/install-node-modules.sh && npx playwright test -c playwright.readme.config.ts "$@"' playwright "$@"
