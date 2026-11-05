#!/bin/sh
# Runs inside the Playwright Docker image (test-visual.sh, readme-screenshots.sh) before Playwright:
# installs node_modules into the checkout's volume only when it wasn't installed from this
# package-lock.json, in this image, for this architecture. A stamp in node_modules records that once
# npm ci succeeds, so later runs skip the install and runs in one checkout don't reinstall under each
# other. The architecture matters because esbuild and rollup install binaries for one platform.
set -eu
stamp="$PLAYWRIGHT_IMAGE $(uname -m) $(sha1sum package-lock.json)"
if [ "$(cat node_modules/.kinopeer-installed 2>/dev/null)" != "$stamp" ]; then
  rm -f node_modules/.kinopeer-installed
  npm ci --no-audit --no-fund --loglevel=error
  printf '%s\n' "$stamp" > node_modules/.kinopeer-installed
fi
