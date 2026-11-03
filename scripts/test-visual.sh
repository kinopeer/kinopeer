#!/bin/sh
# Runs the screenshot tests (e2e/) in the Playwright Docker image, where the baselines are rendered,
# so they match CI on any machine. Arguments go to `playwright test`, e.g. --update-snapshots.
set -eu
cd "$(dirname "$0")/.."
. scripts/playwright-docker.sh
exec docker run --rm --init --ipc=host \
  -v "$PWD":/work -v "$NODE_MODULES_VOLUME":/work/node_modules -w /work \
  -e CI="${CI:-}" -e PLAYWRIGHT_IMAGE \
  "$PLAYWRIGHT_IMAGE" sh -c 'scripts/install-node-modules.sh && npx playwright test "$@"' playwright "$@"
