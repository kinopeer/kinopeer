#!/bin/sh
# Runs the screenshot tests (e2e/) in the Playwright Docker image, where the baselines are rendered,
# so they match CI on any machine. Arguments go to `playwright test`, e.g. --update-snapshots.
# The image tag must match @playwright/test in package.json, scripts/readme-screenshots.sh and the
# visual job in ci.yml.
set -eu
IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
cd "$(dirname "$0")/.."
# node_modules lives in a volume: the host's may be built for another OS.
exec docker run --rm --init --ipc=host \
  -v "$PWD":/work -v kinoseed-visual-node-modules:/work/node_modules -w /work \
  -e CI="${CI:-}" \
  "$IMAGE" sh -c 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"' playwright "$@"
